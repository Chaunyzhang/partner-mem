import { describe, expect, it } from "vitest";
import { hashText } from "../../src/core/hash.js";
import { RawIngestService } from "../../src/ingest/raw-ingest.js";
import { createInitializedStore } from "../helpers/db.js";

describe("RawIngestService", () => {
  it("ingests visible raw messages transactionally and preserves exact text", () => {
    const store = createInitializedStore();
    const service = new RawIngestService(store);

    const result = service.ingestTurn({
      agent_id: "agent-1",
      session_id: "session-1",
      turn_id: "turn-1",
      turn_index: 0,
      messages: [
        {
          role: "user",
          text: "  Preserve this exact user text.  ",
          observed_at: "2026-01-01T00:00:00.000Z",
          message_index: 0
        },
        {
          role: "assistant",
          text: "Assistant reply stays exact.",
          observed_at: "2026-01-01T00:00:01.000Z",
          message_index: 1
        }
      ]
    });

    expect(result.raw_node_ids).toHaveLength(2);
    expect(result.raw_near_raw_edge_ids).toHaveLength(1);
    expect(store.countRows("memory_nodes")).toBe(2);
    expect(store.countRows("raw_payloads")).toBe(2);
    expect(store.countRows("node_fts")).toBe(2);

    const firstPayload = store.getRawPayload(result.raw_node_ids[0] ?? "");
    expect(firstPayload?.text).toBe("  Preserve this exact user text.  ");
    expect(firstPayload?.source_hash).toBe(hashText("  Preserve this exact user text.  "));
    expect(store.listOutgoingEdges(result.raw_node_ids[0] ?? "", { edge_type: "RAW_NEAR_RAW" })).toHaveLength(1);
  });

  it("captures a five-step correction chain with topic sequence and bidirectional supersession", () => {
    const store = createInitializedStore();
    const service = new RawIngestService(store);
    const texts = ["定方案 A", "改方案 B", "改方案 C", "换方案 D", "不要方案 D 改方案 E"];
    const nodeIds = texts.map((text, index) => {
      const result = service.ingestTurn({
        agent_id: "agent-1",
        session_id: "session-1",
        turn_id: `turn-${index + 1}`,
        turn_index: index,
        messages: [
          {
            role: "user",
            text,
            observed_at: `2026-01-0${index + 1}T00:00:00.000Z`,
            message_index: 0
          }
        ]
      });
      return result.raw_node_ids[0] ?? "";
    });

    const nodes = nodeIds.map((nodeId) => store.getNode(nodeId));
    expect(nodes.map((node) => node?.topic_group)).toEqual([
      "topic_方案",
      "topic_方案",
      "topic_方案",
      "topic_方案",
      "topic_方案"
    ]);
    expect(nodes.map((node) => node?.sequence)).toEqual([1, 2, 3, 4, 5]);
    expect(nodes.map((node) => node?.supersedes)).toEqual([null, nodeIds[0], nodeIds[1], nodeIds[2], nodeIds[3]]);
    expect(nodes.map((node) => node?.superseded_by)).toEqual([
      nodeIds[1],
      nodeIds[2],
      nodeIds[3],
      nodeIds[4],
      null
    ]);

    for (let index = 1; index < nodeIds.length; index += 1) {
      const edges = store.listOutgoingEdges(nodeIds[index] ?? "", { edge_type: "correction" });
      expect(edges).toHaveLength(1);
      expect(edges[0]?.edge_class).toBe("semantic");
      expect(edges[0]?.to_node_id).toBe(nodeIds[index - 1]);
    }
  });

  it("records extension and contradiction edges without superseding either raw memory", () => {
    const store = createInitializedStore();
    const service = new RawIngestService(store);
    const first = service.ingestTurn({
      agent_id: "agent-1",
      session_id: "session-1",
      turn_id: "turn-1",
      turn_index: 0,
      messages: [
        {
          role: "user",
          text: "Project Quartz plan A",
          observed_at: "2026-01-01T00:00:00.000Z",
          message_index: 0
        }
      ]
    });
    const extension = service.ingestTurn({
      agent_id: "agent-1",
      session_id: "session-1",
      turn_id: "turn-2",
      turn_index: 1,
      messages: [
        {
          role: "user",
          text: "Project Quartz also needs launch checklist",
          observed_at: "2026-01-02T00:00:00.000Z",
          message_index: 0
        }
      ]
    });
    const contradiction = service.ingestTurn({
      agent_id: "agent-1",
      session_id: "session-1",
      turn_id: "turn-3",
      turn_index: 2,
      messages: [
        {
          role: "user",
          text: "Project Quartz contradiction budget conflicts",
          observed_at: "2026-01-03T00:00:00.000Z",
          message_index: 0
        }
      ]
    });

    const firstNode = store.getNode(first.raw_node_ids[0] ?? "");
    const extensionNode = store.getNode(extension.raw_node_ids[0] ?? "");
    const contradictionNode = store.getNode(contradiction.raw_node_ids[0] ?? "");
    expect(firstNode?.superseded_by).toBeNull();
    expect(extensionNode?.supersedes).toBeNull();
    expect(extensionNode?.superseded_by).toBeNull();
    expect(contradictionNode?.supersedes).toBeNull();
    expect(contradictionNode?.superseded_by).toBeNull();
    expect(extension.revision_edge_ids).toHaveLength(1);
    expect(contradiction.revision_edge_ids).toHaveLength(1);
    expect(store.listOutgoingEdges(extension.raw_node_ids[0] ?? "", { edge_type: "extension" })[0]?.edge_class).toBe(
      "semantic"
    );
    expect(
      store.listOutgoingEdges(contradiction.raw_node_ids[0] ?? "", { edge_type: "contradiction" })[0]?.edge_class
    ).toBe("semantic");
  });

  it("rejects empty message text without partial writes", () => {
    const store = createInitializedStore();
    const service = new RawIngestService(store);

    expect(() =>
      service.ingestTurn({
        agent_id: "agent-1",
        session_id: "session-1",
        turn_id: "turn-1",
        turn_index: 0,
        messages: [
          {
            role: "user",
            text: "valid",
            observed_at: "2026-01-01T00:00:00.000Z",
            message_index: 0
          },
          {
            role: "assistant",
            text: "   ",
            observed_at: "2026-01-01T00:00:01.000Z",
            message_index: 1
          }
        ]
      })
    ).toThrow(/must not be empty/);

    expect(store.countRows("memory_nodes")).toBe(0);
    expect(store.countRows("raw_payloads")).toBe(0);
  });

  it("does not create derived graph nodes during raw ingest", () => {
    const store = createInitializedStore();
    const service = new RawIngestService(store);

    service.ingestTurn({
      agent_id: "agent-1",
      session_id: "session-1",
      turn_id: "turn-1",
      turn_index: 0,
      messages: [
        {
          role: "user",
          text: "Only raw messages are allowed in PR02.",
          observed_at: "2026-01-01T00:00:00.000Z",
          message_index: 0
        }
      ]
    });

    expect(store.getNode("summary")).toBeUndefined();
    expect(store.countRows("summary_payloads")).toBe(0);
  });
});
