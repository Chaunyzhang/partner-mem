import { describe, expect, it } from "vitest";
import { hashText } from "../../src/core/hash.js";
import { EvidenceEdgeBuilder } from "../../src/evidence/evidence-edge-builder.js";
import { createInitializedStore } from "../helpers/db.js";

function createRawNode(store = createInitializedStore(), nodeId = "raw-1", text = "raw text") {
  const sourceHash = hashText(text);
  store.createNode({
    node_id: nodeId,
    agent_id: "agent-1",
    session_id: "session-1",
    node_type: "raw_message",
    created_at: "2026-01-01T00:00:00.000Z",
    content_hash: sourceHash
  });
  store.createRawPayload({
    node_id: nodeId,
    role: "user",
    text,
    normalized_text: text,
    token_count: 2,
    turn_id: "turn-1",
    turn_index: 0,
    message_index: 0,
    source_hash: sourceHash
  });
  return { store, sourceHash };
}

describe("EvidenceEdgeBuilder", () => {
  it("creates evidence edges with matching target_hash", () => {
    const { store } = createRawNode();
    const second = createRawNode(store, "raw-2", "nearby text");
    const builder = new EvidenceEdgeBuilder(store);

    const edgeId = builder.createEvidenceEdge({
      edge_id: "edge-1",
      agent_id: "agent-1",
      from_node_id: "raw-1",
      to_node_id: "raw-2",
      edge_type: "RAW_NEAR_RAW",
      target_hash: second.sourceHash
    });

    expect(edgeId).toBe("edge-1");
    expect(store.listOutgoingEdges("raw-1", { edge_class: "evidence" })).toHaveLength(1);
  });

  it("rejects evidence edges without target_hash or missing nodes", () => {
    const { store } = createRawNode();
    const builder = new EvidenceEdgeBuilder(store);

    expect(() =>
      builder.createEvidenceEdge({
        agent_id: "agent-1",
        from_node_id: "raw-1",
        to_node_id: "raw-1",
        edge_type: "RAW_NEAR_RAW",
        target_hash: ""
      })
    ).toThrow(/target_hash is required/);

    expect(() =>
      builder.createEvidenceEdge({
        agent_id: "agent-1",
        from_node_id: "raw-1",
        to_node_id: "missing",
        edge_type: "RAW_NEAR_RAW",
        target_hash: "hash"
      })
    ).toThrow(/target node does not exist/);
  });

  it("rejects evidence edges whose target_hash does not match the target", () => {
    const { store } = createRawNode();
    createRawNode(store, "raw-2", "nearby text");
    const builder = new EvidenceEdgeBuilder(store);

    expect(() =>
      builder.createEvidenceEdge({
        agent_id: "agent-1",
        from_node_id: "raw-1",
        to_node_id: "raw-2",
        edge_type: "RAW_NEAR_RAW",
        target_hash: "wrong"
      })
    ).toThrow(/must match/);
  });
});
