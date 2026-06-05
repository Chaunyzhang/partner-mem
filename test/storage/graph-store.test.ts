import { describe, expect, it } from "vitest";
import { hashText } from "../../src/core/hash.js";
import { createInitializedStore } from "../helpers/db.js";

describe("GraphStore", () => {
  it("creates and loads raw graph records through the single store owner", () => {
    const store = createInitializedStore();
    const sourceHash = hashText("hello graph");

    store.createNode({
      node_id: "raw-1",
      agent_id: "agent-1",
      session_id: "session-1",
      node_type: "raw_message",
      created_at: "2026-01-01T00:00:00.000Z",
      content_hash: sourceHash
    });
    store.createRawPayload({
      node_id: "raw-1",
      role: "user",
      text: "hello graph",
      normalized_text: "hello graph",
      token_count: 2,
      turn_id: "turn-1",
      turn_index: 0,
      message_index: 0,
      source_hash: sourceHash
    });
    store.insertFtsNode({
      node_id: "raw-1",
      agent_id: "agent-1",
      session_id: "session-1",
      node_type: "raw_message",
      text: "hello graph"
    });

    expect(store.getNode("raw-1")?.node_type).toBe("raw_message");
    expect(store.getRawPayload("raw-1")?.text).toBe("hello graph");
    expect(store.countRows("node_fts")).toBe(1);
  });
});
