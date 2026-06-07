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

  it("connects adjacent persisted turns with a temporal FOLLOWS edge", () => {
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
          text: "first turn user",
          observed_at: "2026-01-01T00:00:00.000Z",
          message_index: 0
        },
        {
          role: "assistant",
          text: "first turn assistant",
          observed_at: "2026-01-01T00:00:01.000Z",
          message_index: 1
        }
      ]
    });
    const second = service.ingestTurn({
      agent_id: "agent-1",
      session_id: "session-1",
      turn_id: "turn-2",
      turn_index: 1,
      messages: [
        {
          role: "user",
          text: "second turn user",
          observed_at: "2026-01-01T00:00:02.000Z",
          message_index: 2
        },
        {
          role: "assistant",
          text: "second turn assistant",
          observed_at: "2026-01-01T00:00:03.000Z",
          message_index: 3
        }
      ]
    });

    const followsEdges = store.listOutgoingEdges(second.raw_node_ids[0] ?? "", {
      edge_class: "temporal",
      edge_type: "FOLLOWS"
    });

    expect(followsEdges).toHaveLength(1);
    expect(followsEdges[0]?.to_node_id).toBe(first.raw_node_ids[1]);
    expect(followsEdges[0]?.target_hash).toBe(store.getRawPayload(first.raw_node_ids[1] ?? "")?.source_hash);
  });
});
