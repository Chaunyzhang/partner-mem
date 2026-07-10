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

  it("reads the max stored raw message_index for an agent session cursor", () => {
    const store = createInitializedStore();

    createRaw(store, "raw-1", "agent-1", "session-1", 0, 2, "agent session low");
    createRaw(store, "raw-2", "agent-1", "session-1", 1, 7, "agent session high");
    createRaw(store, "raw-3", "agent-1", "other-session", 0, 20, "other session");

    expect(store.getMaxRawMessageIndex({ agent_id: "agent-1", session_id: "session-1" })).toBe(7);
    expect(store.getMaxRawMessageIndex({ agent_id: "agent-1", session_id: "missing-session" })).toBeUndefined();
  });

  it("loads the latest raw timeline item before a turn/message cursor", () => {
    const store = createInitializedStore();

    createRaw(store, "raw-1", "agent-1", "session-1", 0, 0, "first user");
    createRaw(store, "raw-2", "agent-1", "session-1", 0, 1, "first assistant");
    createRaw(store, "raw-3", "agent-1", "session-1", 1, 2, "second user");
    createRaw(store, "raw-4", "agent-2", "session-1", 99, 99, "wrong agent");

    const previous = store.getLatestRawTimelineItemBefore({
      agent_id: "agent-1",
      session_id: "session-1",
      turn_index: 1,
      message_index: 2
    });

    expect(previous?.node.node_id).toBe("raw-2");
    expect(previous?.payload.text).toBe("first assistant");
  });

  it("uses savepoints for nested work on the same store transaction", () => {
    const store = createInitializedStore();

    expect(() =>
      store.transaction(() => {
        store.transaction(() => {
          createRaw(store, "nested-raw", "agent-1", "session-1", 0, 0, "nested transaction");
        });
        throw new Error("rollback outer transaction");
      })
    ).toThrow("rollback outer transaction");
    expect(store.getNode("nested-raw")).toBeUndefined();
  });
});

function createRaw(
  store: ReturnType<typeof createInitializedStore>,
  nodeId: string,
  agentId: string,
  sessionId: string,
  turnIndex: number,
  messageIndex: number,
  text: string
): void {
  const sourceHash = hashText(text);
  store.createNode({
    node_id: nodeId,
    agent_id: agentId,
    session_id: sessionId,
    node_type: "raw_message",
    created_at: "2026-01-01T00:00:00.000Z",
    observed_at: "2026-01-01T00:00:00.000Z",
    content_hash: sourceHash
  });
  store.createRawPayload({
    node_id: nodeId,
    role: messageIndex % 2 === 0 ? "user" : "assistant",
    text,
    normalized_text: text,
    token_count: 1,
    turn_id: `turn-${turnIndex}`,
    turn_index: turnIndex,
    message_index: messageIndex,
    source_hash: sourceHash
  });
}
