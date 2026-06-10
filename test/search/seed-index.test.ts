import { describe, expect, it } from "vitest";
import { RawIngestService } from "../../src/ingest/raw-ingest.js";
import { SeedIndex } from "../../src/search/seed-index.js";
import { createInitializedStore } from "../helpers/db.js";
import {
  EXTRACTION_SCHEMA_VERSION,
  validateExtractionProposal
} from "../../src/extraction/proposal-validator.js";
import { TypedGraphWriter } from "../../src/extraction/typed-graph-writer.js";

describe("SeedIndex", () => {
  it("returns candidate routes from FTS seed rows", () => {
    const store = createInitializedStore();
    new RawIngestService(store).ingestTurn({
      agent_id: "agent-1",
      session_id: "session-1",
      turn_id: "turn-1",
      turn_index: 0,
      messages: [
        {
          role: "user",
          text: "Find graph kernel evidence later.",
          observed_at: "2026-01-01T00:00:00.000Z",
          message_index: 0
        }
      ]
    });

    const results = new SeedIndex(store).search({
      query: "kernel",
      agent_id: "agent-1",
      limit: 5
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.result_class).toBe("candidate");
  });

  it("matches Chinese substrings inside continuous Han text", () => {
    const store = createInitializedStore();
    new RawIngestService(store).ingestTurn({
      agent_id: "agent-1",
      session_id: "session-1",
      turn_id: "turn-1",
      turn_index: 0,
      messages: [
        {
          role: "user",
          text: "你再出一个绕口令",
          observed_at: "2026-01-01T00:00:00.000Z",
          message_index: 0
        }
      ]
    });

    const results = new SeedIndex(store).search({
      query: "绕口令是啥",
      agent_id: "agent-1",
      limit: 5
    });

    expect(results[0]?.seed_node_id).toBeDefined();
  });

  it("matches short Chinese keywords inside natural Chinese questions", () => {
    const store = createInitializedStore();
    new RawIngestService(store).ingestTurn({
      agent_id: "agent-1",
      session_id: "session-1",
      turn_id: "turn-1",
      turn_index: 0,
      messages: [
        {
          role: "user",
          text: "密码：柚子茶8842",
          observed_at: "2026-01-01T00:00:00.000Z",
          message_index: 0
        }
      ]
    });

    const results = new SeedIndex(store).search({
      query: "我的密码是什么",
      agent_id: "agent-1",
      limit: 5
    });

    expect(results[0]?.seed_node_id).toBeDefined();
  });

  it("matches CJK typed labels and attribute values after graph extraction indexing", () => {
    const store = createInitializedStore();
    const rawResult = new RawIngestService(store).ingestTurn({
      agent_id: "agent-1",
      session_id: "session-1",
      turn_id: "turn-1",
      turn_index: 0,
      messages: [
        {
          role: "user",
          text: "密码：柚子茶8842",
          observed_at: "2026-01-01T00:00:00.000Z",
          message_index: 0
        }
      ]
    });
    const rawNode = store.getNode(rawResult.raw_node_ids[0] ?? "");
    const rawPayload = store.getRawPayload(rawResult.raw_node_ids[0] ?? "");
    if (!rawNode || !rawPayload) throw new Error("missing raw evidence");
    const validation = validateExtractionProposal(
      {
        schema_version: EXTRACTION_SCHEMA_VERSION,
        raw_node_id: rawNode.node_id,
        items: [
          {
            provisional_id: "item-1",
            node_type: "decision",
            label: "密码",
            text: "用户密码是柚子茶8842",
            evidence_text: "柚子茶8842",
            attributes: [{ key: "password", value: "柚子茶8842", evidence_text: "柚子茶8842" }],
            temporal: { source_text: null, valid_from: null, valid_to: null, granularity: "none" },
            confidence: 0.9
          }
        ]
      },
      rawNode,
      rawPayload
    );
    new TypedGraphWriter(store).writeAcceptedItems({
      raw_node: rawNode,
      raw_payload: rawPayload,
      accepted_items: validation.accepted_items
    });

    const results = new SeedIndex(store).search({
      query: "我的密码是什么",
      agent_id: "agent-1",
      limit: 5
    });

    expect(results.some((result) => store.getNode(result.seed_node_id)?.node_type === "decision")).toBe(true);
  });

  it("expands raw FTS seeds to typed graph candidates through evidenced-by raw edges", () => {
    const store = createInitializedStore();
    const rawResult = new RawIngestService(store).ingestTurn({
      agent_id: "agent-1",
      session_id: "session-1",
      turn_id: "turn-1",
      turn_index: 0,
      messages: [
        {
          role: "user",
          text: "The release codename is nebula and it ships Monday.",
          observed_at: "2026-01-01T00:00:00.000Z",
          message_index: 0
        }
      ]
    });
    const rawNode = store.getNode(rawResult.raw_node_ids[0] ?? "");
    const rawPayload = store.getRawPayload(rawResult.raw_node_ids[0] ?? "");
    if (!rawNode || !rawPayload) throw new Error("missing raw evidence");
    const validation = validateExtractionProposal(
      {
        schema_version: EXTRACTION_SCHEMA_VERSION,
        raw_node_id: rawNode.node_id,
        items: [
          {
            provisional_id: "item-1",
            node_type: "decision",
            label: "Release schedule",
            text: "Release ships Monday",
            evidence_text: "ships Monday",
            attributes: [{ key: "ship_day", value: "Monday", evidence_text: "Monday" }],
            temporal: { source_text: null, valid_from: null, valid_to: null, granularity: "none" },
            confidence: 0.9
          }
        ]
      },
      rawNode,
      rawPayload
    );
    const written = new TypedGraphWriter(store).writeAcceptedItems({
      raw_node: rawNode,
      raw_payload: rawPayload,
      accepted_items: validation.accepted_items
    });
    const typedNodeId = written.accepted_items[0]?.typed_node_id;
    if (!typedNodeId) throw new Error("missing typed node");

    const results = new SeedIndex(store).search({
      query: "codename",
      agent_id: "agent-1",
      limit: 5
    });

    const graphCandidate = results.find((result) => result.seed_node_id === typedNodeId);
    expect(graphCandidate).toBeDefined();
    expect(graphCandidate?.route).toEqual([rawNode.node_id, typedNodeId]);
    expect(graphCandidate?.why).toContain("graph-expanded via EVIDENCED_BY_RAW");
  });

  it("does not graph-expand semantic incoming edges as normal candidates", () => {
    const store = createInitializedStore();
    const rawResult = new RawIngestService(store).ingestTurn({
      agent_id: "agent-1",
      session_id: "session-1",
      turn_id: "turn-1",
      turn_index: 0,
      messages: [
        {
          role: "user",
          text: "semantic source marker",
          observed_at: "2026-01-01T00:00:00.000Z",
          message_index: 0
        }
      ]
    });
    const rawNodeId = rawResult.raw_node_ids[0] ?? "";
    store.createNode({
      node_id: "entity-semantic",
      agent_id: "agent-1",
      session_id: null,
      node_type: "entity",
      created_at: "2026-01-01T00:00:00.000Z",
      content_hash: "semantic-hash"
    });
    store.createEdge({
      edge_id: "semantic-edge",
      agent_id: "agent-1",
      from_node_id: "entity-semantic",
      to_node_id: rawNodeId,
      edge_type: "RELATED_TO",
      edge_class: "semantic",
      created_at: "2026-01-01T00:00:00.000Z",
      target_hash: store.getRawPayload(rawNodeId)?.source_hash ?? ""
    });

    const results = new SeedIndex(store).search({
      query: "semantic source",
      agent_id: "agent-1",
      limit: 5
    });

    expect(results.map((result) => result.seed_node_id)).not.toContain("entity-semantic");
  });

  it("does not graph-expand cross-agent typed evidence edges as normal candidates", () => {
    const store = createInitializedStore();
    const rawResult = new RawIngestService(store).ingestTurn({
      agent_id: "agent-1",
      session_id: "session-1",
      turn_id: "turn-1",
      turn_index: 0,
      messages: [
        {
          role: "user",
          text: "cross agent source marker",
          observed_at: "2026-01-01T00:00:00.000Z",
          message_index: 0
        }
      ]
    });
    const rawNodeId = rawResult.raw_node_ids[0] ?? "";
    store.createNode({
      node_id: "entity-cross-agent",
      agent_id: "agent-2",
      session_id: null,
      node_type: "entity",
      created_at: "2026-01-01T00:00:00.000Z",
      content_hash: "cross-agent-hash"
    });
    store.createEdge({
      edge_id: "cross-agent-edge",
      agent_id: "agent-2",
      from_node_id: "entity-cross-agent",
      to_node_id: rawNodeId,
      edge_type: "EVIDENCED_BY_RAW",
      edge_class: "evidence",
      created_at: "2026-01-01T00:00:00.000Z",
      target_hash: store.getRawPayload(rawNodeId)?.source_hash ?? ""
    });

    const results = new SeedIndex(store).search({
      query: "cross agent source",
      agent_id: "agent-1",
      limit: 5
    });

    expect(results.map((result) => result.seed_node_id)).not.toContain("entity-cross-agent");
  });

  it("filters FTS seeds by observed time window", () => {
    const store = createInitializedStore();
    new RawIngestService(store).ingestTurn({
      agent_id: "agent-1",
      session_id: "session-1",
      turn_id: "turn-1",
      turn_index: 0,
      messages: [
        {
          role: "user",
          text: "time filter target",
          observed_at: "2026-01-01T00:00:00.000Z",
          message_index: 0
        }
      ]
    });
    new RawIngestService(store).ingestTurn({
      agent_id: "agent-1",
      session_id: "session-1",
      turn_id: "turn-2",
      turn_index: 1,
      messages: [
        {
          role: "user",
          text: "time filter target",
          observed_at: "2026-02-01T00:00:00.000Z",
          message_index: 0
        }
      ]
    });

    const results = new SeedIndex(store).search({
      query: "target",
      agent_id: "agent-1",
      time_window: {
        since: "2026-01-15T00:00:00.000Z",
        until: "2026-02-15T00:00:00.000Z"
      },
      limit: 5
    });

    expect(results).toHaveLength(1);
    expect(store.getNode(results[0]?.seed_node_id ?? "")?.observed_at).toBe("2026-02-01T00:00:00.000Z");
  });
});
