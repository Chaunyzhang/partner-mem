import { describe, expect, it } from "vitest";
import {
  EXTRACTION_SCHEMA_VERSION,
  validateExtractionProposal,
  type ExtractedMemoryItem
} from "../../src/extraction/proposal-validator.js";
import type { MemoryNode, RawPayload } from "../../src/storage/graph-store.js";
import { hashText } from "../../src/core/hash.js";

const rawText =
  "Alice decided on 2026-06-01 that Project Quartz password is 柚子茶8842 and Bob should follow up.";
const rawHash = hashText(rawText);
const rawNode: MemoryNode = {
  node_id: "raw-1",
  agent_id: "agent-1",
  session_id: "session-1",
  node_type: "raw_message",
  status: "active",
  created_at: "2026-06-01T00:00:00.000Z",
  updated_at: "2026-06-01T00:00:00.000Z",
  observed_at: "2026-06-01T00:00:00.000Z",
  valid_from: null,
  valid_to: null,
  invalidated_at: null,
  topic_group: null,
  sequence: null,
  supersedes: null,
  superseded_by: null,
  content_hash: rawHash,
  metadata_json: "{}"
};
const rawPayload: RawPayload = {
  node_id: "raw-1",
  role: "user",
  text: rawText,
  normalized_text: rawText.normalize("NFC"),
  token_count: 15,
  turn_id: "turn-1",
  turn_index: 0,
  message_index: 0,
  source_hash: rawHash
};

describe("validateExtractionProposal", () => {
  it("accepts entity, event, task, and decision items with exact raw evidence", () => {
    const result = validateExtractionProposal(
      proposal([
        item("i-1", "entity", "Project Quartz", "Project Quartz password is 柚子茶8842", "Project Quartz"),
        item("i-2", "event", "Alice decided", "Alice decided on 2026-06-01", "Alice decided"),
        item("i-3", "task", "Bob follow up", "Bob should follow up", "Bob should follow up"),
        item("i-4", "decision", "Quartz password", "Project Quartz password is 柚子茶8842", "decided")
      ]),
      rawNode,
      rawPayload
    );

    expect(result.rejected_items).toEqual([]);
    expect(result.accepted_items.map((accepted) => accepted.node_type)).toEqual([
      "entity",
      "event",
      "task",
      "decision"
    ]);
  });

  it("accepts empty items as no extracted memory", () => {
    const result = validateExtractionProposal(
      { schema_version: EXTRACTION_SCHEMA_VERSION, raw_node_id: "raw-1", items: [] },
      rawNode,
      rawPayload
    );

    expect(result.accepted_items).toEqual([]);
    expect(result.rejected_items).toEqual([]);
  });

  it("accepts raw-backed attributes and explicit temporal metadata", () => {
    const result = validateExtractionProposal(
      proposal([
        {
          ...item("i-1", "decision", "Quartz password", "Project Quartz password is 柚子茶8842", "柚子茶8842"),
          attributes: [
            { key: "project_name", value: "Project Quartz", evidence_text: "Project Quartz" },
            { key: "password", value: "柚子茶8842", evidence_text: "柚子茶8842" }
          ],
          temporal: {
            source_text: "2026-06-01",
            valid_from: "2026-06-01",
            valid_to: null,
            granularity: "date"
          }
        }
      ]),
      rawNode,
      rawPayload
    );

    expect(result.rejected_items).toEqual([]);
    expect(result.accepted_items[0]?.attributes).toHaveLength(2);
    expect(result.accepted_items[0]?.temporal?.valid_from).toBe("2026-06-01");
  });

  it("rejects schema version mismatch and proposals for a different raw node", () => {
    expect(
      validateExtractionProposal(
        { schema_version: "partner-mem.extraction.v0", raw_node_id: "raw-1", items: [] },
        rawNode,
        rawPayload
      ).rejected_items[0]?.reason
    ).toBe("schema_version_mismatch");

    expect(
      validateExtractionProposal({ schema_version: EXTRACTION_SCHEMA_VERSION, items: [] }, rawNode, rawPayload).rejected_items[0]?.reason
    ).toBe("missing_raw_node");

    expect(
      validateExtractionProposal(
        { schema_version: EXTRACTION_SCHEMA_VERSION, raw_node_id: "raw-2", items: [] },
        rawNode,
        rawPayload
      ).rejected_items[0]?.reason
    ).toBe("missing_raw_node");
  });

  it("rejects unsupported node types, empty labels/text, and missing item evidence", () => {
    const result = validateExtractionProposal(
      proposal([
        item("i-1", "summary", "summary", "summary text", "Alice"),
        item("i-2", "entity", "", "valid text", "Alice"),
        item("i-3", "entity", "Alice", "", "Alice"),
        item("i-4", "entity", "Alice", "Alice is present", "")
      ]),
      rawNode,
      rawPayload
    );

    expect(result.rejected_items.map((rejected) => rejected.reason)).toEqual([
      "unsupported_node_type",
      "empty_label",
      "empty_text",
      "missing_evidence_text"
    ]);
  });

  it("rejects item, attribute, and temporal evidence that is not an exact raw substring", () => {
    const result = validateExtractionProposal(
      proposal([
        item("i-1", "entity", "Missing", "Missing fact", "not in raw"),
        {
          ...item("i-2", "entity", "Alice", "Alice is mentioned", "Alice"),
          attributes: [{ key: "person_name", value: "Alice", evidence_text: "Alicia" }]
        },
        {
          ...item("i-3", "event", "Date", "Alice decided on 2026-06-01", "2026-06-01"),
          temporal: {
            source_text: "yesterday",
            valid_from: "2026-06-01T00:00:00.000Z",
            valid_to: null,
            granularity: "datetime"
          }
        }
      ]),
      rawNode,
      rawPayload
    );

    expect(result.rejected_items.map((rejected) => rejected.reason)).toEqual([
      "evidence_text_not_in_raw",
      "attribute_evidence_text_not_in_raw",
      "temporal_evidence_text_not_in_raw"
    ]);
  });

  it("rejects invalid attributes, invalid temporal shapes, duplicate items, and missing raw payloads", () => {
    const invalid = validateExtractionProposal(
      proposal([
        {
          ...item("i-1", "entity", "Alice", "Alice is mentioned", "Alice"),
          attributes: [{ key: "PersonName", value: "Alice", evidence_text: "Alice" }]
        },
        {
          ...item("i-2", "event", "Decision date", "Alice decided on 2026-06-01", "2026-06-01"),
          temporal: {
            source_text: "2026-06-01",
            valid_from: "next week",
            valid_to: null,
            granularity: "relative"
          }
        },
        item("i-2", "task", "Bob follow up", "Bob should follow up", "Bob should follow up")
      ]),
      rawNode,
      rawPayload
    );

    expect(invalid.rejected_items.map((rejected) => rejected.reason)).toEqual([
      "invalid_attribute",
      "invalid_temporal",
      "duplicate_item"
    ]);

    expect(validateExtractionProposal(proposal([item("i-1", "entity", "Alice", "Alice", "Alice")]), rawNode).rejected_items[0]?.reason).toBe(
      "missing_raw_payload"
    );
  });
});

function proposal(items: ExtractedMemoryItem[]) {
  return { schema_version: EXTRACTION_SCHEMA_VERSION, raw_node_id: "raw-1", items };
}

function item(
  provisional_id: string,
  node_type: string,
  label: string,
  text: string,
  evidence_text: string
): ExtractedMemoryItem {
  return {
    provisional_id,
    node_type,
    label,
    text,
    evidence_text,
    attributes: [],
    temporal: { source_text: null, valid_from: null, valid_to: null, granularity: "none" },
    confidence: 0.8
  };
}
