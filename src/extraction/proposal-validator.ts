import type { MemoryNode, RawPayload } from "../storage/graph-store.js";
import {
  EXTRACTION_SCHEMA_VERSION,
  isTemporalGranularity,
  isTypedExtractionNodeType,
  type ExtractedMemoryAttribute,
  type ExtractedMemoryItem,
  type ExtractionRejectedItem,
  type ExtractionRejectedReason,
  type ExtractionValidationResult,
  type MemoryExtractionProposal,
  type TemporalGranularity,
  type ValidatedExtractionAttribute,
  type ValidatedExtractionItem,
  type ValidatedExtractionTemporal
} from "./extraction-contracts.js";

export {
  EXTRACTION_SCHEMA_VERSION,
  ModelExtractionError,
  type ExtractedMemoryItem,
  type ExtractorModelClient,
  type MemoryExtractionProposal
} from "./extraction-contracts.js";

const MAX_ITEMS = 20;
const MAX_ATTRIBUTES = 20;
const MAX_LABEL_LENGTH = 120;
const MAX_TEXT_LENGTH = 1000;
const MAX_ATTRIBUTE_KEY_LENGTH = 64;
const MAX_ATTRIBUTE_VALUE_LENGTH = 300;
const ATTRIBUTE_KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/u;

export function validateExtractionProposal(
  proposal: unknown,
  rawNode?: MemoryNode,
  rawPayload?: RawPayload
): ExtractionValidationResult {
  if (!isRecord(proposal)) {
    return rejectedOnly(rawNode?.node_id ?? "unknown", "schema_invalid", "Proposal must be an object");
  }

  const proposedRawNodeId = readString(proposal.raw_node_id);
  const rejectionRawNodeId = proposedRawNodeId ?? rawNode?.node_id ?? "unknown";
  if (proposal.schema_version !== EXTRACTION_SCHEMA_VERSION) {
    return rejectedOnly(rejectionRawNodeId, "schema_version_mismatch", "Unsupported extraction schema_version");
  }

  if (!proposedRawNodeId || !rawNode || rawNode.node_type !== "raw_message" || rawNode.node_id !== proposedRawNodeId) {
    return rejectedOnly(rejectionRawNodeId, "missing_raw_node", "Proposal raw_node_id must match an existing raw_message node");
  }

  if (!rawPayload || rawPayload.node_id !== rawNode.node_id) {
    return rejectedOnly(rawNode.node_id, "missing_raw_payload", "Raw message payload is required for extraction");
  }

  if (!Array.isArray(proposal.items) || proposal.items.length > MAX_ITEMS) {
    return rejectedOnly(rawNode.node_id, "schema_invalid", "Proposal items must be an array with at most 20 items");
  }
  const typedProposal: MemoryExtractionProposal = {
    schema_version: EXTRACTION_SCHEMA_VERSION,
    raw_node_id: proposedRawNodeId,
    items: proposal.items as ExtractedMemoryItem[]
  };

  const accepted_items: ValidatedExtractionItem[] = [];
  const rejected_items: ExtractionRejectedItem[] = [];
  const seenProvisionalIds = new Set<string>();
  const seenItemKeys = new Set<string>();

  for (const candidate of proposal.items) {
    const itemResult = validateItem(candidate, typedProposal, rawPayload, seenProvisionalIds, seenItemKeys);
    if (itemResult.ok) {
      accepted_items.push(itemResult.accepted);
    } else {
      rejected_items.push(itemResult.rejected);
    }
  }

  return { accepted_items, rejected_items };
}

function validateItem(
  candidate: unknown,
  proposal: MemoryExtractionProposal,
  rawPayload: RawPayload,
  seenProvisionalIds: Set<string>,
  seenItemKeys: Set<string>
): ItemValidationResult {
  if (!isRecord(candidate)) {
    return { ok: false, rejected: reject(proposal.raw_node_id, undefined, "schema_invalid", "Extraction item must be an object") };
  }

  const provisionalId = readTrimmedString(candidate.provisional_id);
  if (!provisionalId) {
    return { ok: false, rejected: reject(proposal.raw_node_id, undefined, "schema_invalid", "provisional_id must be a non-empty string") };
  }
  if (seenProvisionalIds.has(provisionalId)) {
    return { ok: false, rejected: reject(proposal.raw_node_id, provisionalId, "duplicate_item", "Duplicate provisional_id in proposal") };
  }
  seenProvisionalIds.add(provisionalId);

  const nodeType = readTrimmedString(candidate.node_type);
  if (!nodeType || !isTypedExtractionNodeType(nodeType)) {
    return { ok: false, rejected: reject(proposal.raw_node_id, provisionalId, "unsupported_node_type", "Unsupported PR06 node_type") };
  }

  const label = readTrimmedString(candidate.label);
  if (!label) return { ok: false, rejected: reject(proposal.raw_node_id, provisionalId, "empty_label", "label must not be empty") };
  if (label.length > MAX_LABEL_LENGTH) {
    return { ok: false, rejected: reject(proposal.raw_node_id, provisionalId, "schema_invalid", "label is too long") };
  }

  const text = readTrimmedString(candidate.text);
  if (!text) return { ok: false, rejected: reject(proposal.raw_node_id, provisionalId, "empty_text", "text must not be empty") };
  if (text.length > MAX_TEXT_LENGTH) {
    return { ok: false, rejected: reject(proposal.raw_node_id, provisionalId, "schema_invalid", "text is too long") };
  }

  const evidenceText = readTrimmedString(candidate.evidence_text);
  if (!evidenceText) {
    return {
      ok: false,
      rejected: reject(proposal.raw_node_id, provisionalId, "missing_evidence_text", "evidence_text must not be empty")
    };
  }
  if (!containsExactRawText(rawPayload, evidenceText)) {
    return {
      ok: false,
      rejected: reject(
        proposal.raw_node_id,
        provisionalId,
        "evidence_text_not_in_raw",
        "evidence_text must be an exact raw substring"
      )
    };
  }

  const duplicateKey = `${nodeType}:${normalizeForIdentity(label)}\n${normalizeForIdentity(text)}`;
  if (seenItemKeys.has(duplicateKey)) {
    return { ok: false, rejected: reject(proposal.raw_node_id, provisionalId, "duplicate_item", "Duplicate typed item in proposal") };
  }
  seenItemKeys.add(duplicateKey);

  const attributesResult = validateAttributes(candidate.attributes, proposal.raw_node_id, provisionalId, rawPayload);
  if ("rejected" in attributesResult) return { ok: false, rejected: attributesResult.rejected };

  const temporalResult = validateTemporal(candidate.temporal, proposal.raw_node_id, provisionalId, rawPayload);
  if ("rejected" in temporalResult) return { ok: false, rejected: temporalResult.rejected };

  const confidence = readConfidence(candidate.confidence);
  if (confidence === "invalid") {
    return { ok: false, rejected: reject(proposal.raw_node_id, provisionalId, "schema_invalid", "confidence must be a number between 0 and 1") };
  }

  return {
    ok: true,
    accepted: {
      schema_version: EXTRACTION_SCHEMA_VERSION,
      raw_node_id: proposal.raw_node_id,
      provisional_id: provisionalId,
      node_type: nodeType,
      label,
      text,
      evidence_text: evidenceText,
      attributes: attributesResult.attributes,
      temporal: temporalResult.temporal,
      confidence
    }
  };
}

type ItemValidationResult =
  | { ok: true; accepted: ValidatedExtractionItem }
  | { ok: false; rejected: ExtractionRejectedItem };

function validateAttributes(
  value: unknown,
  rawNodeId: string,
  provisionalId: string,
  rawPayload: RawPayload
): { attributes: ValidatedExtractionAttribute[] } | { rejected: ExtractionRejectedItem } {
  if (value == null) return { attributes: [] };
  if (!Array.isArray(value) || value.length > MAX_ATTRIBUTES) {
    return { rejected: reject(rawNodeId, provisionalId, "invalid_attribute", "attributes must be an array with at most 20 items") };
  }

  const attributes: ValidatedExtractionAttribute[] = [];
  for (const attribute of value) {
    if (!isRecord(attribute)) {
      return { rejected: reject(rawNodeId, provisionalId, "invalid_attribute", "attribute must be an object") };
    }
    const key = readTrimmedString(attribute.key);
    if (!key || key.length > MAX_ATTRIBUTE_KEY_LENGTH || !ATTRIBUTE_KEY_PATTERN.test(key)) {
      return { rejected: reject(rawNodeId, provisionalId, "invalid_attribute", "attribute key must be lowercase snake_case") };
    }
    const attributeValue = readAttributeValue(attribute.value);
    if (attributeValue == null) {
      return { rejected: reject(rawNodeId, provisionalId, "invalid_attribute", "attribute value must be concrete") };
    }
    const evidenceText = readTrimmedString(attribute.evidence_text);
    if (!evidenceText) {
      return { rejected: reject(rawNodeId, provisionalId, "invalid_attribute", "attribute evidence_text must not be empty") };
    }
    if (!containsExactRawText(rawPayload, evidenceText)) {
      return {
        rejected: reject(
          rawNodeId,
          provisionalId,
          "attribute_evidence_text_not_in_raw",
          "attribute evidence_text must be an exact raw substring"
        )
      };
    }
    attributes.push({ key, value: attributeValue, evidence_text: evidenceText });
  }

  return { attributes };
}

function validateTemporal(
  value: unknown,
  rawNodeId: string,
  provisionalId: string,
  rawPayload: RawPayload
): { temporal: ValidatedExtractionTemporal } | { rejected: ExtractionRejectedItem } {
  if (value == null) {
    return { temporal: emptyTemporal() };
  }
  if (!isRecord(value)) {
    return { rejected: reject(rawNodeId, provisionalId, "invalid_temporal", "temporal must be an object") };
  }

  const granularity = readTrimmedString(value.granularity) ?? "none";
  if (!isTemporalGranularity(granularity)) {
    return { rejected: reject(rawNodeId, provisionalId, "invalid_temporal", "temporal granularity is invalid") };
  }

  const sourceText = readNullableTrimmedString(value.source_text);
  const validFrom = readNullableTrimmedString(value.valid_from);
  const validTo = readNullableTrimmedString(value.valid_to);
  if (sourceText && !containsExactRawText(rawPayload, sourceText)) {
    return {
      rejected: reject(
        rawNodeId,
        provisionalId,
        "temporal_evidence_text_not_in_raw",
        "temporal source_text must be an exact raw substring"
      )
    };
  }

  if (!sourceText && (validFrom || validTo || granularity !== "none")) {
    return { rejected: reject(rawNodeId, provisionalId, "invalid_temporal", "temporal metadata must be raw-backed") };
  }

  if ((validFrom && !isIsoLikeString(validFrom)) || (validTo && !isIsoLikeString(validTo))) {
    return { rejected: reject(rawNodeId, provisionalId, "invalid_temporal", "temporal ISO fields are invalid") };
  }

  return {
    temporal: {
      source_text: sourceText,
      valid_from: validFrom,
      valid_to: validTo,
      granularity: granularity as TemporalGranularity
    }
  };
}

function reject(
  rawNodeId: string,
  provisionalId: string | undefined,
  reason: ExtractionRejectedReason,
  message: string
): ExtractionRejectedItem {
  return provisionalId
    ? { raw_node_id: rawNodeId, provisional_id: provisionalId, reason, message }
    : { raw_node_id: rawNodeId, reason, message };
}

function rejectedOnly(
  rawNodeId: string,
  reason: ExtractionRejectedReason,
  message: string
): ExtractionValidationResult {
  return { accepted_items: [], rejected_items: [reject(rawNodeId, undefined, reason, message)] };
}

function readAttributeValue(value: unknown): string | number | boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_ATTRIBUTE_VALUE_LENGTH) return null;
    return trimmed;
  }
  return null;
}

function readConfidence(value: unknown): number | null | "invalid" {
  if (value == null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) return "invalid";
  return value;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readTrimmedString(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim() : undefined;
}

function readNullableTrimmedString(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function containsExactRawText(rawPayload: RawPayload, evidenceText: string): boolean {
  const rawText = rawPayload.normalized_text || rawPayload.text;
  return rawText.normalize("NFC").includes(evidenceText.normalize("NFC"));
}

function normalizeForIdentity(value: string): string {
  return value.normalize("NFC").trim().replace(/\s+/gu, " ").toLowerCase();
}

function isIsoLikeString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}(?:[T ][0-9:.+-Z]*)?$/u.test(value)) return false;
  return !Number.isNaN(Date.parse(value));
}

function emptyTemporal(): ValidatedExtractionTemporal {
  return { source_text: null, valid_from: null, valid_to: null, granularity: "none" };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
