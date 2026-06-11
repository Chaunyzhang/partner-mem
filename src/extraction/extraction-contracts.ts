import type { NodeType } from "../core/contracts.js";

export const EXTRACTION_SCHEMA_VERSION = "partner-mem.extraction.v1" as const;
export const EXTRACTION_PROMPT_VERSION = "partner-mem.extraction.prompt.v1" as const;

export const TYPED_EXTRACTION_NODE_TYPES = ["entity", "event", "task", "decision"] as const;
export type TypedExtractionNodeType = (typeof TYPED_EXTRACTION_NODE_TYPES)[number];

export const TEMPORAL_GRANULARITIES = ["none", "date", "datetime", "range"] as const;
export type TemporalGranularity = (typeof TEMPORAL_GRANULARITIES)[number];

export interface ExtractedMemoryAttribute {
  key: string;
  value: string | number | boolean;
  evidence_text: string;
}

export interface ExtractedTemporalProposal {
  source_text: string | null;
  valid_from: string | null;
  valid_to: string | null;
  granularity: TemporalGranularity | string;
}

export interface ExtractedMemoryItem {
  provisional_id: string;
  node_type: NodeType | string;
  label: string;
  text: string;
  evidence_text: string;
  attributes?: ExtractedMemoryAttribute[];
  temporal?: ExtractedTemporalProposal;
  confidence?: number;
}

export interface MemoryExtractionProposal {
  schema_version: typeof EXTRACTION_SCHEMA_VERSION | string;
  raw_node_id: string;
  items: ExtractedMemoryItem[];
}

export interface ValidatedExtractionAttribute {
  key: string;
  value: string | number | boolean;
  evidence_text: string;
}

export interface ValidatedExtractionTemporal {
  source_text: string | null;
  valid_from: string | null;
  valid_to: string | null;
  granularity: TemporalGranularity;
}

export interface ValidatedExtractionItem {
  schema_version: typeof EXTRACTION_SCHEMA_VERSION;
  raw_node_id: string;
  provisional_id: string;
  node_type: TypedExtractionNodeType;
  label: string;
  text: string;
  evidence_text: string;
  attributes: ValidatedExtractionAttribute[];
  temporal: ValidatedExtractionTemporal;
  confidence: number | null;
}

export const EXTRACTION_REJECTION_REASONS = [
  "schema_invalid",
  "schema_version_mismatch",
  "missing_raw_node",
  "missing_raw_payload",
  "unsupported_node_type",
  "empty_label",
  "empty_text",
  "missing_evidence_text",
  "evidence_text_not_in_raw",
  "invalid_attribute",
  "attribute_evidence_text_not_in_raw",
  "invalid_temporal",
  "temporal_evidence_text_not_in_raw",
  "duplicate_item",
  "model_unavailable",
  "model_invalid_json"
] as const;
export type ExtractionRejectedReason = (typeof EXTRACTION_REJECTION_REASONS)[number];

export interface ExtractionRejectedItem {
  raw_node_id: string;
  provisional_id?: string;
  reason: ExtractionRejectedReason;
  message: string;
}

export interface ExtractionValidationResult {
  accepted_items: ValidatedExtractionItem[];
  rejected_items: ExtractionRejectedItem[];
}

export interface ExtractionAcceptedItem {
  raw_node_id: string;
  typed_node_id: string;
  edge_id: string;
  node_type: TypedExtractionNodeType;
  label: string;
}

export interface ExtractionWriteResult {
  accepted_items: ExtractionAcceptedItem[];
  rejected_items: ExtractionRejectedItem[];
}

export interface ExtractionBatchResult {
  accepted_items: ExtractionAcceptedItem[];
  rejected_items: ExtractionRejectedItem[];
}

export interface ExtractRawMessageInput {
  agent_id: string;
  raw_node_id: string;
  raw_text: string;
  observed_at: string | null;
}

export interface ExtractorModelClient {
  extractRawMessage(input: ExtractRawMessageInput): Promise<MemoryExtractionProposal>;
}

export class ModelExtractionError extends Error {
  constructor(
    public readonly reason: Extract<ExtractionRejectedReason, "model_unavailable" | "model_invalid_json">,
    message: string
  ) {
    super(message);
    this.name = "ModelExtractionError";
  }
}

export function isTypedExtractionNodeType(value: string): value is TypedExtractionNodeType {
  return (TYPED_EXTRACTION_NODE_TYPES as readonly string[]).includes(value);
}

export function isTemporalGranularity(value: string): value is TemporalGranularity {
  return (TEMPORAL_GRANULARITIES as readonly string[]).includes(value);
}
