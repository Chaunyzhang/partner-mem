import { describe, expect, it } from "vitest";
import { hashText } from "../../src/core/hash.js";
import { GraphTraversal } from "../../src/graph/traversal.js";
import { createInitializedStore } from "../helpers/db.js";

describe("GraphTraversal", () => {
  it("walks bounded evidence paths and blocks cycles", () => {
    const store = createInitializedStore();
    const rawHash = hashText("raw");
    const decisionHash = hashText("decision");

    store.createNode({
      node_id: "decision-1",
      agent_id: "agent-1",
      node_type: "decision",
      created_at: "2026-01-01T00:00:00.000Z",
      content_hash: decisionHash
    });
    store.createNode({
      node_id: "raw-1",
      agent_id: "agent-1",
      node_type: "raw_message",
      created_at: "2026-01-01T00:00:00.000Z",
      content_hash: rawHash
    });
    store.createRawPayload({
      node_id: "raw-1",
      role: "user",
      text: "raw",
      normalized_text: "raw",
      token_count: 1,
      turn_id: "turn-1",
      turn_index: 0,
      message_index: 0,
      source_hash: rawHash
    });
    store.createEdge({
      edge_id: "edge-1",
      agent_id: "agent-1",
      from_node_id: "decision-1",
      to_node_id: "raw-1",
      edge_type: "EVIDENCED_BY_RAW",
      edge_class: "evidence",
      created_at: "2026-01-01T00:00:00.000Z",
      target_hash: rawHash
    });
    store.createEdge({
      edge_id: "cycle",
      agent_id: "agent-1",
      from_node_id: "decision-1",
      to_node_id: "decision-1",
      edge_type: "EVIDENCED_BY_RAW",
      edge_class: "evidence",
      created_at: "2026-01-01T00:00:00.000Z",
      target_hash: decisionHash
    });

    const result = new GraphTraversal(store).walkEvidencePaths("decision-1", { max_depth: 2 });

    expect(result.paths).toHaveLength(1);
    expect(result.blocked_paths.map((path) => path.reason)).toContain("cycle_detected");
  });
});
