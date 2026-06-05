import { describe, expect, it } from "vitest";
import { hashText } from "../../src/core/hash.js";
import { runSchemaDoctor } from "../../src/storage/doctor.js";
import { createInitializedStore } from "../helpers/db.js";

describe("deep storage doctor", () => {
  it("reports unhealthy evidence hash mismatch without repairing it", () => {
    const store = createInitializedStore();
    store.createNode({
      node_id: "decision-1",
      agent_id: "agent-1",
      node_type: "decision",
      created_at: "2026-01-01T00:00:00.000Z",
      content_hash: hashText("decision")
    });
    store.createNode({
      node_id: "raw-1",
      agent_id: "agent-1",
      node_type: "raw_message",
      created_at: "2026-01-01T00:00:00.000Z",
      content_hash: hashText("raw")
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
      source_hash: hashText("raw")
    });
    store.createEdge({
      edge_id: "bad",
      agent_id: "agent-1",
      from_node_id: "decision-1",
      to_node_id: "raw-1",
      edge_type: "EVIDENCED_BY_RAW",
      edge_class: "evidence",
      created_at: "2026-01-01T00:00:00.000Z",
      target_hash: "wrong"
    });

    const result = runSchemaDoctor(store.rawDb());

    expect(result.status).toBe("unhealthy");
    expect(result.evidence.badHashCount).toBe(1);
    expect(store.listOutgoingEdges("decision-1")[0]?.target_hash).toBe("wrong");
  });

  it("reports raw nodes missing raw payloads", () => {
    const store = createInitializedStore();
    store.createNode({
      node_id: "raw-missing",
      agent_id: "agent-1",
      node_type: "raw_message",
      created_at: "2026-01-01T00:00:00.000Z",
      content_hash: hashText("missing")
    });

    const result = runSchemaDoctor(store.rawDb());

    expect(result.status).toBe("unhealthy");
    expect(result.evidence.missingRawPayloadCount).toBe(1);
  });
});
