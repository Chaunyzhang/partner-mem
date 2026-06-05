import { describe, expect, it } from "vitest";
import { hashText } from "../../src/core/hash.js";
import { EvidenceEdgeBuilder } from "../../src/evidence/evidence-edge-builder.js";
import { EvidenceResolver } from "../../src/evidence/evidence-resolver.js";
import type { GraphStore } from "../../src/storage/graph-store.js";
import { createInitializedStore } from "../helpers/db.js";

function createRaw(store: GraphStore, nodeId: string, text: string, messageIndex = 0): string {
  const sourceHash = hashText(text);
  store.createNode({
    node_id: nodeId,
    agent_id: "agent-1",
    session_id: "session-1",
    node_type: "raw_message",
    created_at: "2026-01-01T00:00:00.000Z",
    observed_at: "2026-01-01T00:00:00.000Z",
    content_hash: sourceHash
  });
  store.createRawPayload({
    node_id: nodeId,
    role: "user",
    text,
    normalized_text: text,
    token_count: 1,
    turn_id: "turn-1",
    turn_index: 0,
    message_index: messageIndex,
    source_hash: sourceHash
  });
  return sourceHash;
}

function createDerived(store: GraphStore, nodeId: string, nodeType: "decision" | "summary" | "entity"): string {
  const contentHash = hashText(`${nodeType}:${nodeId}`);
  store.createNode({
    node_id: nodeId,
    agent_id: "agent-1",
    session_id: "session-1",
    node_type: nodeType,
    created_at: "2026-01-01T00:00:00.000Z",
    content_hash: contentHash
  });
  return contentHash;
}

describe("EvidenceResolver", () => {
  it("resolves a raw candidate directly to its exact raw payload", () => {
    const store = createInitializedStore();
    createRaw(store, "raw-1", "raw text owns truth");

    const packet = new EvidenceResolver(store).resolveEvidence({ candidate_node_id: "raw-1" });

    expect(packet.evidence_items).toHaveLength(1);
    expect(packet.evidence_items[0]?.text).toBe("raw text owns truth");
    expect(packet.evidence_items[0]?.path).toEqual([]);
  });

  it("resolves decision and summary candidates through allowed evidence edges", () => {
    const store = createInitializedStore();
    const rawHash = createRaw(store, "raw-1", "original proof");
    createDerived(store, "decision-1", "decision");
    createDerived(store, "summary-1", "summary");
    store.createSummaryPayload({
      node_id: "summary-1",
      text: "summary text is navigation only",
      source_node_count: 1,
      summary_hash: hashText("summary text is navigation only")
    });
    const builder = new EvidenceEdgeBuilder(store);
    builder.createEvidenceEdge({
      agent_id: "agent-1",
      from_node_id: "decision-1",
      to_node_id: "raw-1",
      edge_type: "EVIDENCED_BY_RAW",
      target_hash: rawHash
    });
    builder.createEvidenceEdge({
      agent_id: "agent-1",
      from_node_id: "summary-1",
      to_node_id: "raw-1",
      edge_type: "SUMMARY_COVERS_RAW",
      target_hash: rawHash
    });

    const resolver = new EvidenceResolver(store);
    expect(resolver.resolveEvidence({ candidate_node_id: "decision-1" }).evidence_items[0]?.text).toBe("original proof");
    expect(resolver.resolveEvidence({ candidate_node_id: "summary-1" }).evidence_items[0]?.text).toBe("original proof");
  });

  it("can resolve RAW_NEAR_RAW neighbor evidence when requested", () => {
    const store = createInitializedStore();
    createRaw(store, "raw-1", "first", 0);
    const secondHash = createRaw(store, "raw-2", "second", 1);
    new EvidenceEdgeBuilder(store).createEvidenceEdge({
      agent_id: "agent-1",
      from_node_id: "raw-1",
      to_node_id: "raw-2",
      edge_type: "RAW_NEAR_RAW",
      target_hash: secondHash
    });

    const packet = new EvidenceResolver(store).resolveEvidence({
      candidate_node_id: "raw-1",
      include_raw_neighbors: true
    });

    expect(packet.evidence_items.map((item) => item.text)).toEqual(["first", "second"]);
  });

  it("blocks semantic paths, hash mismatch, missing payloads, cycles, and non-raw terminals", () => {
    const store = createInitializedStore();
    const rawHash = createRaw(store, "raw-1", "raw");
    const entityHash = createDerived(store, "entity-1", "entity");
    const terminalEntityHash = createDerived(store, "entity-2", "entity");
    const decisionHash = createDerived(store, "decision-1", "decision");

    store.createEdge({
      edge_id: "semantic-1",
      agent_id: "agent-1",
      from_node_id: "entity-1",
      to_node_id: "raw-1",
      edge_type: "RELATED_TO",
      edge_class: "semantic",
      created_at: "2026-01-01T00:00:00.000Z",
      target_hash: rawHash
    });
    store.createEdge({
      edge_id: "bad-hash",
      agent_id: "agent-1",
      from_node_id: "decision-1",
      to_node_id: "raw-1",
      edge_type: "EVIDENCED_BY_RAW",
      edge_class: "evidence",
      created_at: "2026-01-01T00:00:00.000Z",
      target_hash: "wrong"
    });
    store.createNode({
      node_id: "raw-missing-payload",
      agent_id: "agent-1",
      session_id: "session-1",
      node_type: "raw_message",
      created_at: "2026-01-01T00:00:00.000Z",
      content_hash: hashText("missing")
    });
    store.createEdge({
      edge_id: "missing-payload",
      agent_id: "agent-1",
      from_node_id: "decision-1",
      to_node_id: "raw-missing-payload",
      edge_type: "EVIDENCED_BY_RAW",
      edge_class: "evidence",
      created_at: "2026-01-01T00:00:00.000Z",
      target_hash: hashText("missing")
    });
    store.createEdge({
      edge_id: "non-raw",
      agent_id: "agent-1",
      from_node_id: "decision-1",
      to_node_id: "entity-2",
      edge_type: "EVIDENCED_BY_RAW",
      edge_class: "evidence",
      created_at: "2026-01-01T00:00:00.000Z",
      target_hash: terminalEntityHash
    });
    store.createEdge({
      edge_id: "toward-cycle",
      agent_id: "agent-1",
      from_node_id: "decision-1",
      to_node_id: "entity-1",
      edge_type: "EVIDENCED_BY_RAW",
      edge_class: "evidence",
      created_at: "2026-01-01T00:00:00.000Z",
      target_hash: entityHash
    });
    store.createEdge({
      edge_id: "cycle",
      agent_id: "agent-1",
      from_node_id: "entity-1",
      to_node_id: "decision-1",
      edge_type: "EVIDENCED_BY_RAW",
      edge_class: "evidence",
      created_at: "2026-01-01T00:00:00.000Z",
      target_hash: decisionHash
    });

    const resolver = new EvidenceResolver(store);
    expect(resolver.resolveEvidence({ candidate_node_id: "entity-1" }).blocked_paths.map((path) => path.reason)).toContain("disallowed_edge_class");
    const decisionReasons = resolver.resolveEvidence({ candidate_node_id: "decision-1" }).blocked_paths.map((path) => path.reason);
    expect(decisionReasons).toContain("target_hash_mismatch");
    expect(decisionReasons).toContain("missing_raw_payload");
    expect(decisionReasons).toContain("cycle_detected");
    expect(decisionReasons).toContain("non_raw_terminal");
  });
});
