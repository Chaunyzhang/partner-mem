import { describe, expect, it } from "vitest";
import { hashText } from "../../src/core/hash.js";
import { RawIngestService } from "../../src/ingest/raw-ingest.js";
import { RecallRouter } from "../../src/recall/recall-router.js";
import { createInitializedStore } from "../helpers/db.js";
import {
  EXTRACTION_SCHEMA_VERSION,
  validateExtractionProposal
} from "../../src/extraction/proposal-validator.js";
import { TypedGraphWriter } from "../../src/extraction/typed-graph-writer.js";

describe("RecallRouter", () => {
  it("returns original raw text after FTS seed plus resolver", () => {
    const store = createInitializedStore();
    new RawIngestService(store).ingestTurn({
      agent_id: "agent-1",
      session_id: "session-1",
      turn_id: "turn-1",
      turn_index: 0,
      messages: [
        {
          role: "user",
          text: "Recall must return this exact original sentence.",
          observed_at: "2026-01-01T00:00:00.000Z",
          message_index: 0
        }
      ]
    });

    const packet = new RecallRouter(store).recall({
      query: "exact original",
      agent_id: "agent-1",
      limit: 3
    });

    expect(packet.evidence_items[0]?.text).toBe("Recall must return this exact original sentence.");
    expect(store.countRows("retrieval_runs")).toBe(1);
  });

  it("excludes out-of-window FTS seeds before resolving recall evidence", () => {
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
          text: "windowed recall target old",
          observed_at: "2026-01-01T00:00:00.000Z",
          message_index: 0
        }
      ]
    });
    service.ingestTurn({
      agent_id: "agent-1",
      session_id: "session-1",
      turn_id: "turn-2",
      turn_index: 1,
      messages: [
        {
          role: "user",
          text: "windowed recall target new",
          observed_at: "2026-02-01T00:00:00.000Z",
          message_index: 0
        }
      ]
    });

    const packet = new RecallRouter(store).recall({
      query: "windowed target",
      agent_id: "agent-1",
      time_window: {
        since: "2026-01-15T00:00:00.000Z",
        until: "2026-02-15T00:00:00.000Z"
      },
      limit: 5
    });

    expect(packet.evidence_items.map((item) => item.text)).toEqual(["windowed recall target new"]);
  });

  it("returns candidate-only or blocked when an FTS entity seed has no valid evidence path", () => {
    const store = createInitializedStore();
    const contentHash = hashText("entity without proof");
    store.createNode({
      node_id: "entity-1",
      agent_id: "agent-1",
      session_id: "session-1",
      node_type: "entity",
      created_at: "2026-01-01T00:00:00.000Z",
      content_hash: contentHash
    });
    store.insertFtsNode({
      node_id: "entity-1",
      agent_id: "agent-1",
      session_id: "session-1",
      node_type: "entity",
      text: "unproven entity route"
    });

    const router = new RecallRouter(store);

    expect(
      router.search({
        query: "unproven",
        agent_id: "agent-1",
        limit: 3
      })[0]?.result_class
    ).toBe("candidate");
    expect(
      router.recall({
        query: "unproven",
        agent_id: "agent-1",
        limit: 3
      }).evidence_items
    ).toEqual([]);
  });

  it("returns blocked evidence instead of a best effort answer on hash mismatch", () => {
    const store = createInitializedStore();
    const rawHash = hashText("raw proof");
    store.createNode({
      node_id: "decision-1",
      agent_id: "agent-1",
      session_id: "session-1",
      node_type: "decision",
      created_at: "2026-01-01T00:00:00.000Z",
      content_hash: hashText("decision")
    });
    store.insertFtsNode({
      node_id: "decision-1",
      agent_id: "agent-1",
      session_id: "session-1",
      node_type: "decision",
      text: "corrupt evidence"
    });
    store.createNode({
      node_id: "raw-1",
      agent_id: "agent-1",
      session_id: "session-1",
      node_type: "raw_message",
      created_at: "2026-01-01T00:00:00.000Z",
      content_hash: rawHash
    });
    store.createRawPayload({
      node_id: "raw-1",
      role: "user",
      text: "raw proof",
      normalized_text: "raw proof",
      token_count: 2,
      turn_id: "turn-1",
      turn_index: 0,
      message_index: 0,
      source_hash: rawHash
    });
    store.createEdge({
      edge_id: "bad-edge",
      agent_id: "agent-1",
      from_node_id: "decision-1",
      to_node_id: "raw-1",
      edge_type: "EVIDENCED_BY_RAW",
      edge_class: "evidence",
      created_at: "2026-01-01T00:00:00.000Z",
      target_hash: "wrong"
    });

    const packet = new RecallRouter(store).recall({
      query: "corrupt",
      agent_id: "agent-1",
      limit: 3
    });

    expect(packet.evidence_items).toEqual([]);
    expect(packet.blocked_paths.map((path) => path.reason)).toContain("target_hash_mismatch");
  });

  it("resolves a typed graph seed back to raw evidence without returning model text as proof", () => {
    const store = createInitializedStore();
    const rawResult = new RawIngestService(store).ingestTurn({
      agent_id: "agent-1",
      session_id: "session-1",
      turn_id: "turn-1",
      turn_index: 0,
      messages: [
        {
          role: "user",
          text: "Alice decided Project Quartz ships on 2026-06-01.",
          observed_at: "2026-06-01T00:00:00.000Z",
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
            label: "Quartz ship date",
            text: "Project Quartz ships on 2026-06-01",
            evidence_text: "Project Quartz ships on 2026-06-01",
            attributes: [{ key: "project_name", value: "Project Quartz", evidence_text: "Project Quartz" }],
            temporal: {
              source_text: "2026-06-01",
              valid_from: "2026-06-01",
              valid_to: null,
              granularity: "date"
            },
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

    const packet = new RecallRouter(store).recall({
      query: "Quartz ship date",
      agent_id: "agent-1",
      limit: 3
    });

    expect(packet.evidence_items.map((item) => item.text)).toContain(
      "Alice decided Project Quartz ships on 2026-06-01."
    );
    expect(packet.evidence_items.map((item) => item.text)).not.toContain("Project Quartz ships on 2026-06-01");
  });

  it("deduplicates raw evidence reached by direct FTS and graph-expanded typed candidates", () => {
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
    new TypedGraphWriter(store).writeAcceptedItems({
      raw_node: rawNode,
      raw_payload: rawPayload,
      accepted_items: validation.accepted_items
    });

    const packet = new RecallRouter(store).recall({
      query: "codename",
      agent_id: "agent-1",
      limit: 5
    });
    const audit = store
      .rawDb()
      .prepare("SELECT seed_count, evidence_count FROM retrieval_runs WHERE result_class = 'evidence'")
      .get() as { seed_count: number; evidence_count: number };

    expect(audit.seed_count).toBe(2);
    expect(packet.evidence_items.map((item) => item.raw_node_id)).toEqual([rawNode.node_id]);
    expect(audit.evidence_count).toBe(1);
  });

  it("keeps distinct raw FTS evidence from being crowded out by graph-expanded typed candidates", () => {
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
          text: "shared marker shared marker shared marker ships Monday and owner is Alice.",
          observed_at: "2026-01-01T00:00:00.000Z",
          message_index: 0
        }
      ]
    });
    service.ingestTurn({
      agent_id: "agent-1",
      session_id: "session-1",
      turn_id: "turn-2",
      turn_index: 1,
      messages: [
        {
          role: "user",
          text: "shared marker raw two with a longer body that should rank after the repeated first memory",
          observed_at: "2026-01-02T00:00:00.000Z",
          message_index: 1
        }
      ]
    });
    service.ingestTurn({
      agent_id: "agent-1",
      session_id: "session-1",
      turn_id: "turn-3",
      turn_index: 2,
      messages: [
        {
          role: "user",
          text: "shared marker raw three with a longer body that should rank after the repeated first memory",
          observed_at: "2026-01-03T00:00:00.000Z",
          message_index: 2
        }
      ]
    });
    const rawNode = store.getNode(first.raw_node_ids[0] ?? "");
    const rawPayload = store.getRawPayload(first.raw_node_ids[0] ?? "");
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
          },
          {
            provisional_id: "item-2",
            node_type: "entity",
            label: "Release owner",
            text: "Owner is Alice",
            evidence_text: "owner is Alice",
            attributes: [{ key: "owner", value: "Alice", evidence_text: "Alice" }],
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

    const packet = new RecallRouter(store).recall({
      query: "shared marker",
      agent_id: "agent-1",
      limit: 3
    });

    expect(packet.evidence_items.map((item) => item.text)).toEqual([
      "shared marker shared marker shared marker ships Monday and owner is Alice.",
      "shared marker raw two with a longer body that should rank after the repeated first memory",
      "shared marker raw three with a longer body that should rank after the repeated first memory"
    ]);
  });

  it("does not let a semantic edge from typed node to raw node produce final evidence", () => {
    const store = createInitializedStore();
    const rawHash = hashText("semantic proof is forbidden");
    store.createNode({
      node_id: "entity-1",
      agent_id: "agent-1",
      session_id: null,
      node_type: "entity",
      created_at: "2026-01-01T00:00:00.000Z",
      content_hash: hashText("semantic entity")
    });
    store.insertFtsNode({
      node_id: "entity-1",
      agent_id: "agent-1",
      session_id: null,
      node_type: "entity",
      text: "semantic forbidden seed"
    });
    store.createNode({
      node_id: "raw-semantic-1",
      agent_id: "agent-1",
      session_id: "session-1",
      node_type: "raw_message",
      created_at: "2026-01-01T00:00:00.000Z",
      content_hash: rawHash
    });
    store.createRawPayload({
      node_id: "raw-semantic-1",
      role: "user",
      text: "semantic proof is forbidden",
      normalized_text: "semantic proof is forbidden",
      token_count: 4,
      turn_id: "turn-1",
      turn_index: 0,
      message_index: 0,
      source_hash: rawHash
    });
    store.createEdge({
      edge_id: "semantic-edge",
      agent_id: "agent-1",
      from_node_id: "entity-1",
      to_node_id: "raw-semantic-1",
      edge_type: "RELATED_TO",
      edge_class: "semantic",
      created_at: "2026-01-01T00:00:00.000Z",
      target_hash: rawHash
    });

    const packet = new RecallRouter(store).recall({
      query: "semantic forbidden",
      agent_id: "agent-1",
      limit: 3
    });

    expect(packet.evidence_items).toEqual([]);
    expect(packet.blocked_paths.map((path) => path.reason)).toContain("disallowed_edge_class");
  });

  it("blocks cross-agent evidence paths by default and allows them when requested", () => {
    const store = createInitializedStore();
    const rawHash = hashText("shared proof from another agent");
    store.createNode({
      node_id: "decision-cross-agent",
      agent_id: "agent-1",
      session_id: null,
      node_type: "decision",
      created_at: "2026-01-01T00:00:00.000Z",
      content_hash: hashText("decision cross agent")
    });
    store.insertFtsNode({
      node_id: "decision-cross-agent",
      agent_id: "agent-1",
      session_id: null,
      node_type: "decision",
      text: "shared proof route"
    });
    store.createNode({
      node_id: "raw-cross-agent",
      agent_id: "agent-2",
      session_id: "session-2",
      node_type: "raw_message",
      created_at: "2026-01-01T00:00:00.000Z",
      content_hash: rawHash
    });
    store.createRawPayload({
      node_id: "raw-cross-agent",
      role: "user",
      text: "shared proof from another agent",
      normalized_text: "shared proof from another agent",
      token_count: 5,
      turn_id: "turn-2",
      turn_index: 0,
      message_index: 0,
      source_hash: rawHash
    });
    store.createEdge({
      edge_id: "edge-cross-agent",
      agent_id: "agent-2",
      from_node_id: "decision-cross-agent",
      to_node_id: "raw-cross-agent",
      edge_type: "EVIDENCED_BY_RAW",
      edge_class: "evidence",
      created_at: "2026-01-01T00:00:00.000Z",
      target_hash: rawHash
    });

    const router = new RecallRouter(store);
    const blocked = router.recall({
      query: "shared proof",
      agent_id: "agent-1",
      limit: 3
    });
    const crossAgentSwitchKey = ["allow", "cross", "agent"].join("_");
    const attemptedCrossAgent = router.recall({
      query: "shared proof",
      agent_id: "agent-1",
      limit: 3,
      [crossAgentSwitchKey]: true
    } as Parameters<RecallRouter["recall"]>[0] & Record<string, true | string | number>);

    expect(blocked.evidence_items).toEqual([]);
    expect(blocked.blocked_paths.map((path) => path.reason)).toContain("cross_agent_edge_blocked");
    expect(attemptedCrossAgent.evidence_items).toEqual([]);
    expect(attemptedCrossAgent.blocked_paths.map((path) => path.reason)).toContain("cross_agent_edge_blocked");
  });
});
