import { afterEach, describe, expect, it } from "vitest";
import { TurnIngestService } from "../../src/ingest/turn-ingest-service.js";
import { PartnerMemStore } from "../../src/storage/partner-mem-store.js";
import { RetrievalFacade } from "../../src/tools/retrieval-facade.js";
import { createTestDatabase } from "../helpers/database.js";

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

describe("explicit reply graph traversal", () => {
  it("supports parent, replies, and both with BFS order, paths, cycles, and truncation", async () => {
    const fixture = createTestDatabase();
    cleanups.push(fixture.close);
    const store = new PartnerMemStore(fixture.db);
    const harness = store.registerHarness("graph-test");
    const ingest = new TurnIngestService(store);
    const addNode = (
      sourceConversationId: string,
      sourceMessageId: string,
      text: string,
      displayOrder: number | null,
      grantAccess = true,
      visibleAt?: string
    ) =>
      ingest.recordQuestion({
        harness_id: harness.harness_id,
        source_conversation_id: sourceConversationId,
        text,
        source_message_id: sourceMessageId,
        ...(displayOrder === null ? {} : { display_order: displayOrder }),
        ...(visibleAt === undefined ? {} : { visible_at: visibleAt }),
        ...(grantAccess ? { source_access_agent_id: "graph-agent" } : {})
      });
    const parent = addNode("current", "parent-message", "父节点原文", 0);
    const childSlow = addNode("current", "child-slow", "第二显示回复", 2);
    const childFast = addNode("current", "child-fast", "第一显示回复", 1);
    const grandchild = addNode(
      "current",
      "grandchild-message",
      "更深一层回复",
      3
    );
    const history = addNode(
      "history",
      "history-message",
      "获授权历史回复",
      4
    );
    const timeEarly = addNode(
      "current",
      "time-early-message",
      "无顺序但显示时间较早",
      null,
      true,
      "2026-01-01T00:00:00+08:00"
    );
    const timeLate = addNode(
      "current",
      "time-late-message",
      "无顺序但显示时间较晚",
      null,
      true,
      "2025-12-31T20:00:00Z"
    );
    const sameInstantA = addNode(
      "current",
      "same-instant-a-message",
      "相同时刻 A",
      null,
      true,
      "2026-01-01T00:00:00Z"
    );
    const sameInstantB = addNode(
      "current",
      "same-instant-b-message",
      "相同时刻 B",
      null,
      true,
      "2025-12-31T19:00:00-05:00"
    );
    const unauthorized = addNode(
      "unauthorized",
      "unauthorized-message",
      "不得泄漏的回复",
      0,
      false
    );
    const invalidRelation = addNode(
      "current",
      "invalid-relation-message",
      "关系端点不真实时不得返回",
      5
    );
    const reply = (from: string, to: string) =>
      ingest.recordReply({
        harness_id: harness.harness_id,
        from_source_message_id: from,
        to_source_message_id: to
      });
    const childSlowEdge = reply("child-slow", "parent-message");
    reply("child-fast", "parent-message");
    reply("grandchild-message", "child-slow");
    reply("history-message", "parent-message");
    reply("time-early-message", "parent-message");
    reply("time-late-message", "parent-message");
    reply("same-instant-a-message", "parent-message");
    reply("same-instant-b-message", "parent-message");
    reply("unauthorized-message", "parent-message");
    reply("parent-message", "grandchild-message");
    const wrongMessage = store.resolveSourceObject({
      harness_id: harness.harness_id,
      object_kind: "message",
      source_object_id: "wrong-invalid-relation-endpoint"
    });
    if (parent.question_message_id === null) {
      throw new Error("parent message ID is required by this fixture");
    }
    fixture.db.exec("DROP TRIGGER reply_edges_validate_endpoints");
    fixture.db
      .prepare(
        `INSERT INTO explicit_reply_edges(
           edge_id, harness_id, from_node_id, from_message_id,
           to_node_id, to_message_id, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        "invalid-persisted-edge",
        harness.harness_id,
        invalidRelation.node_id,
        wrongMessage.formal_id,
        parent.node_id,
        parent.question_message_id,
        "2026-07-26T06:00:00Z"
      );

    const agentId = store.findSourceObject({
      harness_id: harness.harness_id,
      object_kind: "agent",
      source_object_id: "graph-agent"
    })?.formal_id;
    if (!agentId) throw new Error("missing formal agent");
    const identity = {
      harness_id: harness.harness_id,
      conversation_id: parent.conversation_id,
      agent_id: agentId
    };
    const facade = new RetrievalFacade(store);

    const replies = await facade.invoke(
      "partner_mem_graph_traverse",
      {
        start_node_id: parent.node_id,
        direction: "replies",
        max_depth: 1,
        limit: 2
      },
      identity
    );
    expect(replies.status).toBe("ok");
    expect(replies.truncated).toBe(true);
    expect(replies.evidence_items.map((item) => item.node_id)).toEqual([
      childFast.node_id,
      childSlow.node_id
    ]);
    expect(replies.evidence_items[0]?.question?.text).toBe("第一显示回复");
    expect(replies.evidence_items[0]).toHaveProperty("path");
    const orderedReplies = await facade.invoke(
      "partner_mem_graph_traverse",
      {
        start_node_id: parent.node_id,
        direction: "replies",
        max_depth: 1,
        limit: 20
      },
      identity
    );
    const sameInstantOrder = [sameInstantA.node_id, sameInstantB.node_id].sort();
    expect(orderedReplies.evidence_items.map((item) => item.node_id)).toEqual([
      childFast.node_id,
      childSlow.node_id,
      history.node_id,
      timeEarly.node_id,
      timeLate.node_id,
      ...sameInstantOrder
    ]);

    const parentResult = await facade.invoke(
      "partner_mem_graph_traverse",
      {
        start_node_id: childSlow.node_id,
        direction: "parent"
      },
      identity
    );
    expect(parentResult.evidence_items).toMatchObject([
      {
        node_id: parent.node_id,
        path: [
          {
            edge_id: childSlowEdge.edge_id,
            from_node_id: childSlow.node_id,
            to_node_id: parent.node_id
          }
        ]
      }
    ]);

    const both = await facade.invoke(
      "partner_mem_graph_traverse",
      {
        start_node_id: parent.node_id,
        direction: "both",
        max_depth: 3,
        limit: 20
      },
      identity
    );
    const bothIds = both.evidence_items.map((item) => item.node_id);
    expect(new Set(bothIds).size).toBe(bothIds.length);
    expect(bothIds).toEqual(
      expect.arrayContaining([
        childSlow.node_id,
        childFast.node_id,
        grandchild.node_id,
        history.node_id
      ])
    );
    expect(bothIds).not.toContain(unauthorized.node_id);
    expect(bothIds).not.toContain(invalidRelation.node_id);
    expect(both.evidence_items.every((item) => "path" in item)).toBe(true);
  });

  it("does not reveal an unauthorized start node", async () => {
    const fixture = createTestDatabase();
    cleanups.push(fixture.close);
    const store = new PartnerMemStore(fixture.db);
    const harness = store.registerHarness("graph-boundary");
    const ingest = new TurnIngestService(store);
    const current = ingest.recordQuestion({
      harness_id: harness.harness_id,
      source_conversation_id: "current",
      text: "当前节点",
      source_access_agent_id: "graph-agent"
    });
    const unauthorized = ingest.recordQuestion({
      harness_id: harness.harness_id,
      source_conversation_id: "hidden",
      text: "隐藏节点"
    });
    const agentId = store.findSourceObject({
      harness_id: harness.harness_id,
      object_kind: "agent",
      source_object_id: "graph-agent"
    })?.formal_id;
    if (!agentId) throw new Error("missing formal agent");

    expect(
      await new RetrievalFacade(store).invoke(
        "partner_mem_graph_traverse",
        {
          start_node_id: unauthorized.node_id,
          direction: "both",
          max_depth: 3
        },
        {
          harness_id: harness.harness_id,
          conversation_id: current.conversation_id,
          agent_id: agentId
        }
      )
    ).toEqual({
      status: "empty",
      retrieval_type: "graph",
      truncated: false,
      evidence_items: []
    });
  });
});
