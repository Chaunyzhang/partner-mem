import { describe, expect, it } from "vitest";
import { RawIngestService } from "../../src/ingest/raw-ingest.js";
import { RecallRouter } from "../../src/recall/recall-router.js";
import { SeedIndex } from "../../src/search/seed-index.js";
import { createInitializedStore } from "../helpers/db.js";
import {
  EXTRACTION_SCHEMA_VERSION,
  validateExtractionProposal,
  type ExtractedMemoryItem
} from "../../src/extraction/proposal-validator.js";
import { TypedGraphWriter } from "../../src/extraction/typed-graph-writer.js";

describe("TypedGraphWriter", () => {
  it("writes an agent-scoped typed node, raw evidence edge, and searchable FTS row", () => {
    const { store, rawNode, rawPayload } = ingestRaw("密码：柚子茶8842");
    const accepted = acceptedItems(rawNode, rawPayload, "decision", "密码", "用户密码是柚子茶8842", "柚子茶8842", [
      { key: "password", value: "柚子茶8842", evidence_text: "柚子茶8842" }
    ]);

    const result = new TypedGraphWriter(store).writeAcceptedItems({
      raw_node: rawNode,
      raw_payload: rawPayload,
      accepted_items: accepted
    });

    const written = result.accepted_items[0];
    expect(written?.typed_node_id).toMatch(/^typed:agent-1:decision:/u);
    const typedNode = store.getNode(written?.typed_node_id ?? "");
    expect(typedNode?.session_id).toBeNull();
    expect(typedNode?.node_type).toBe("decision");

    const edges = store.listOutgoingEdges(written?.typed_node_id ?? "", {
      edge_class: "evidence",
      edge_type: "EVIDENCED_BY_RAW"
    });
    expect(edges).toHaveLength(1);
    expect(edges[0]?.to_node_id).toBe(rawNode.node_id);
    expect(edges[0]?.target_hash).toBe(rawPayload.source_hash);

    const seeds = new SeedIndex(store).search({ query: "我的密码是什么", agent_id: "agent-1", limit: 5 });
    expect(seeds.some((seed) => seed.seed_node_id === written?.typed_node_id)).toBe(true);
  });

  it("is idempotent for repeated extraction of the same raw node", () => {
    const { store, rawNode, rawPayload } = ingestRaw("Project Quartz uses passcode QZ-8842.");
    const accepted = acceptedItems(rawNode, rawPayload, "entity", "Project Quartz", "Project Quartz passcode is QZ-8842", "QZ-8842");
    const writer = new TypedGraphWriter(store);

    const first = writer.writeAcceptedItems({ raw_node: rawNode, raw_payload: rawPayload, accepted_items: accepted });
    const second = writer.writeAcceptedItems({ raw_node: rawNode, raw_payload: rawPayload, accepted_items: accepted });

    expect(second.accepted_items[0]?.typed_node_id).toBe(first.accepted_items[0]?.typed_node_id);
    expect(store.countRows("memory_nodes")).toBe(2);
    expect(store.countRows("memory_edges")).toBe(1);
    expect(store.countRows("node_fts")).toBe(2);
  });

  it("reuses one typed node across later raw evidence while adding a second evidence edge", () => {
    const first = ingestRaw("Project Quartz password is QZ-8842.");
    const secondIngest = new RawIngestService(first.store).ingestTurn({
      agent_id: "agent-1",
      session_id: "session-2",
      turn_id: "turn-2",
      turn_index: 1,
      messages: [
        {
          role: "user",
          text: "Remember again: Project Quartz password is QZ-8842.",
          observed_at: "2026-06-02T00:00:00.000Z",
          message_index: 0
        }
      ]
    });
    const secondRawNode = first.store.getNode(secondIngest.raw_node_ids[0] ?? "");
    const secondRawPayload = first.store.getRawPayload(secondIngest.raw_node_ids[0] ?? "");
    if (!secondRawNode || !secondRawPayload) throw new Error("missing second raw evidence");

    const writer = new TypedGraphWriter(first.store);
    const firstWrite = writer.writeAcceptedItems({
      raw_node: first.rawNode,
      raw_payload: first.rawPayload,
      accepted_items: acceptedItems(first.rawNode, first.rawPayload, "entity", "Project Quartz", "Project Quartz password is QZ-8842", "Project Quartz")
    });
    const secondWrite = writer.writeAcceptedItems({
      raw_node: secondRawNode,
      raw_payload: secondRawPayload,
      accepted_items: acceptedItems(secondRawNode, secondRawPayload, "entity", "Project Quartz", "Project Quartz password is QZ-8842", "Project Quartz")
    });

    expect(secondWrite.accepted_items[0]?.typed_node_id).toBe(firstWrite.accepted_items[0]?.typed_node_id);
    expect(
      first.store.listOutgoingEdges(firstWrite.accepted_items[0]?.typed_node_id ?? "", {
        edge_class: "evidence",
        edge_type: "EVIDENCED_BY_RAW"
      })
    ).toHaveLength(2);
  });

  it("lets recall hit a typed seed while returning only original raw evidence", () => {
    const { store, rawNode, rawPayload } = ingestRaw("Alice decided Project Quartz launches on 2026-06-01.");
    new TypedGraphWriter(store).writeAcceptedItems({
      raw_node: rawNode,
      raw_payload: rawPayload,
      accepted_items: acceptedItems(rawNode, rawPayload, "decision", "Quartz launch", "Project Quartz launches on 2026-06-01", "Project Quartz")
    });

    const packet = new RecallRouter(store).recall({
      query: "Quartz launch",
      agent_id: "agent-1",
      limit: 3
    });

    expect(packet.evidence_items.map((item) => item.text)).toContain(
      "Alice decided Project Quartz launches on 2026-06-01."
    );
    expect(packet.evidence_items.map((item) => item.text)).not.toContain("Project Quartz launches on 2026-06-01");
  });
});

function ingestRaw(text: string) {
  const store = createInitializedStore();
  const result = new RawIngestService(store).ingestTurn({
    agent_id: "agent-1",
    session_id: "session-1",
    turn_id: "turn-1",
    turn_index: 0,
    messages: [{ role: "user", text, observed_at: "2026-06-01T00:00:00.000Z", message_index: 0 }]
  });
  const rawNode = store.getNode(result.raw_node_ids[0] ?? "");
  const rawPayload = store.getRawPayload(result.raw_node_ids[0] ?? "");
  if (!rawNode || !rawPayload) throw new Error("missing raw evidence");
  return { store, rawNode, rawPayload };
}

function acceptedItems(
  rawNode: ReturnType<typeof ingestRaw>["rawNode"],
  rawPayload: ReturnType<typeof ingestRaw>["rawPayload"],
  nodeType: ExtractedMemoryItem["node_type"],
  label: string,
  text: string,
  evidenceText: string,
  attributes: ExtractedMemoryItem["attributes"] = []
) {
  const result = validateExtractionProposal(
    {
      schema_version: EXTRACTION_SCHEMA_VERSION,
      raw_node_id: rawNode.node_id,
      items: [
        {
          provisional_id: "item-1",
          node_type: nodeType,
          label,
          text,
          evidence_text: evidenceText,
          attributes,
          temporal: { source_text: null, valid_from: null, valid_to: null, granularity: "none" },
          confidence: 0.9
        }
      ]
    },
    rawNode,
    rawPayload
  );
  expect(result.rejected_items).toEqual([]);
  return result.accepted_items;
}
