import { afterEach, describe, expect, it } from "vitest";
import { TurnIngestService } from "../../src/ingest/turn-ingest-service.js";
import { PartnerMemStore } from "../../src/storage/partner-mem-store.js";
import { RetrievalFacade } from "../../src/tools/retrieval-facade.js";
import { createTestDatabase } from "../helpers/database.js";

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

describe("keyword retrieval", () => {
  it("orders FTS matches by BM25 and uses node_id as a stable tie-break", async () => {
    const fixture = createTestDatabase();
    cleanups.push(fixture.close);
    const store = new PartnerMemStore(fixture.db);
    const harness = store.registerHarness("bm25-test");
    const conversation = store.resolveSourceObject({
      harness_id: harness.harness_id,
      object_kind: "conversation",
      source_object_id: "bm25-conversation"
    });
    const repeated = store.insertTurnNode({
      node_id: "node-repeat",
      harness_id: harness.harness_id,
      conversation_id: conversation.formal_id,
      question_text: "stable keyword stable keyword stable keyword"
    });
    store.insertTurnNode({
      node_id: "node-z",
      harness_id: harness.harness_id,
      conversation_id: conversation.formal_id,
      question_text: "stable keyword once"
    });
    store.insertTurnNode({
      node_id: "node-a",
      harness_id: harness.harness_id,
      conversation_id: conversation.formal_id,
      question_text: "stable keyword once"
    });
    const result = await new RetrievalFacade(store).invoke(
      "partner_mem_keyword_search",
      { query: "stable keyword" },
      {
        harness_id: harness.harness_id,
        conversation_id: conversation.formal_id
      }
    );

    expect(result.evidence_items.map((item) => item.node_id)).toEqual([
      repeated.node_id,
      "node-a",
      "node-z"
    ]);
  });

  it("uses current conversation by default and returns complete original turns", async () => {
    const fixture = createTestDatabase();
    cleanups.push(fixture.close);
    const store = new PartnerMemStore(fixture.db);
    const harness = store.registerHarness("keyword-test");
    const ingest = new TurnIngestService(store);
    const question = ingest.recordQuestion({
      harness_id: harness.harness_id,
      source_conversation_id: "current",
      text: "中文关键词是火箭推进",
      role: "user",
      source_message_id: "current-question",
      source_access_agent_id: "agent-a"
    });
    const complete = ingest.recordAnswer({
      harness_id: harness.harness_id,
      source_conversation_id: "current",
      node_id: question.node_id,
      text: "Durable engine evidence in the full answer.",
      role: "assistant",
      source_message_id: "current-answer",
      source_agent_id: "generator-a",
      source_access_agent_id: "agent-a"
    });
    ingest.recordQuestion({
      harness_id: harness.harness_id,
      source_conversation_id: "other",
      text: "另一个 conversation 也有火箭推进",
      source_message_id: "other-question"
    });
    const agentId = store.findSourceObject({
      harness_id: harness.harness_id,
      object_kind: "agent",
      source_object_id: "agent-a"
    })?.formal_id;
    if (!agentId) throw new Error("missing formal agent");
    const facade = new RetrievalFacade(store);
    const identity = {
      harness_id: harness.harness_id,
      conversation_id: complete.conversation_id,
      agent_id: agentId
    };

    const chinese = await facade.invoke(
      "partner_mem_keyword_search",
      { query: "火箭推进" },
      identity
    );
    expect(chinese).toEqual({
      status: "ok",
      retrieval_type: "keyword",
      truncated: false,
      evidence_items: [
        {
          rank: 1,
          node_id: complete.node_id,
          harness_id: harness.harness_id,
          harness_type: "keyword-test",
          conversation_id: complete.conversation_id,
          thread_id: null,
          question: {
            text: "中文关键词是火箭推进",
            role: "user",
            message_id: complete.question_message_id,
            author_id: null,
            visible_at: null,
            display_order: null
          },
          answer: {
            text: "Durable engine evidence in the full answer.",
            role: "assistant",
            message_id: complete.answer_message_id,
            author_id: null,
            agent_id: complete.answer_agent_id,
            visible_at: null,
            display_order: null
          }
        }
      ]
    });

    const english = await facade.invoke(
      "partner_mem_keyword_search",
      { query: "Durable engine" },
      identity
    );
    expect(english.status).toBe("ok");
    expect(english.evidence_items[0]?.node_id).toBe(complete.node_id);
    expect(JSON.stringify(english)).not.toMatch(/score|bm25|query/);

    const shortSubstring = await facade.invoke(
      "partner_mem_keyword_search",
      { query: "火" },
      identity
    );
    expect(shortSubstring.evidence_items[0]?.node_id).toBe(complete.node_id);
  });

  it("queries only explicit Agent history and never fills an empty scope", async () => {
    const fixture = createTestDatabase();
    cleanups.push(fixture.close);
    const store = new PartnerMemStore(fixture.db);
    const harness = store.registerHarness("scope-test");
    const ingest = new TurnIngestService(store);
    const current = ingest.recordQuestion({
      harness_id: harness.harness_id,
      source_conversation_id: "current",
      text: "当前 conversation 没有目标词",
      source_access_agent_id: "agent-a"
    });
    const history = ingest.recordQuestion({
      harness_id: harness.harness_id,
      source_conversation_id: "history",
      text: "历史 conversation 包含独特检索词",
      source_access_agent_id: "agent-a"
    });
    ingest.recordQuestion({
      harness_id: harness.harness_id,
      source_conversation_id: "unauthorized",
      text: "未授权 conversation 包含绝密检索词"
    });
    const agentId = store.findSourceObject({
      harness_id: harness.harness_id,
      object_kind: "agent",
      source_object_id: "agent-a"
    })?.formal_id;
    if (!agentId) throw new Error("missing formal agent");
    const facade = new RetrievalFacade(store);
    const identity = {
      harness_id: harness.harness_id,
      conversation_id: current.conversation_id,
      agent_id: agentId
    };

    expect(
      await facade.invoke(
        "partner_mem_keyword_search",
        { query: "独特检索词" },
        identity
      )
    ).toEqual({
      status: "empty",
      retrieval_type: "keyword",
      truncated: false,
      evidence_items: []
    });
    const allowed = await facade.invoke(
      "partner_mem_keyword_search",
      {
        query: "独特检索词",
        scope: "agent_conversations"
      },
      identity
    );
    expect(allowed.evidence_items.map((item) => item.node_id)).toEqual([
      history.node_id
    ]);
    const forbidden = await facade.invoke(
      "partner_mem_keyword_search",
      {
        query: "绝密检索词",
        scope: "agent_conversations"
      },
      identity
    );
    expect(forbidden.status).toBe("empty");
  });

  it("never trusts poisoned FTS scope metadata over durable node authorization", async () => {
    const fixture = createTestDatabase();
    cleanups.push(fixture.close);
    const store = new PartnerMemStore(fixture.db);
    const harness = store.registerHarness("poisoned-fts");
    const ingest = new TurnIngestService(store);
    const current = ingest.recordQuestion({
      harness_id: harness.harness_id,
      source_conversation_id: "current",
      text: "当前对话没有机密内容",
      source_access_agent_id: "agent-a"
    });
    const hidden = ingest.recordQuestion({
      harness_id: harness.harness_id,
      source_conversation_id: "hidden",
      text: "poisoned-index-secret"
    });
    const agentId = store.findSourceObject({
      harness_id: harness.harness_id,
      object_kind: "agent",
      source_object_id: "agent-a"
    })?.formal_id;
    if (!agentId) throw new Error("missing formal agent");

    fixture.db
      .prepare(
        `INSERT INTO turn_fts(
           node_id, harness_id, conversation_id, search_text
         ) VALUES (?, ?, ?, ?)`
      )
      .run(
        hidden.node_id,
        harness.harness_id,
        current.conversation_id,
        "poisoned-index-secret"
      );

    const facade = new RetrievalFacade(store);
    for (const scope of ["current_conversation", "agent_conversations"] as const) {
      const result = await facade.invoke(
        "partner_mem_keyword_search",
        { query: "poisoned-index-secret", scope, limit: 1 },
        {
          harness_id: harness.harness_id,
          conversation_id: current.conversation_id,
          agent_id: agentId
        }
      );
      expect(result).toEqual({
        status: "empty",
        retrieval_type: "keyword",
        truncated: false,
        evidence_items: []
      });
    }

    store.insertTurnNode({
      node_id: "a-node",
      harness_id: harness.harness_id,
      conversation_id: current.conversation_id,
      question_text: "x first authorized node"
    });
    store.insertTurnNode({
      node_id: "b-node",
      harness_id: harness.harness_id,
      conversation_id: current.conversation_id,
      question_text: "x second authorized node"
    });
    const insertDuplicate = fixture.db.prepare(
      `INSERT INTO turn_fts(
         node_id, harness_id, conversation_id, search_text
       ) VALUES (?, ?, ?, ?)`
    );
    for (let duplicate = 0; duplicate < 3; duplicate += 1) {
      insertDuplicate.run(
        "a-node",
        harness.harness_id,
        current.conversation_id,
        "x first authorized node"
      );
    }
    const deduplicated = await facade.invoke(
      "partner_mem_keyword_search",
      { query: "x", limit: 1 },
      {
        harness_id: harness.harness_id,
        conversation_id: current.conversation_id,
        agent_id: agentId
      }
    );
    expect(deduplicated.evidence_items.map((item) => item.node_id)).toEqual([
      "a-node"
    ]);
    expect(deduplicated.truncated).toBe(true);
  });
});
