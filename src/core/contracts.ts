export const NODE_TYPES = [
  "raw_message",
  "summary",
  "entity",
  "task",
  "event",
  "decision",
  "artifact"
] as const;

export type NodeType = (typeof NODE_TYPES)[number];

export const EDGE_CLASSES = [
  "evidence",
  "semantic",
  "temporal",
  "navigation"
] as const;

export type EdgeClass = (typeof EDGE_CLASSES)[number];

export const EVIDENCE_EDGE_TYPES = [
  "RAW_NEAR_RAW",
  "SUMMARY_COVERS_RAW",
  "SUMMARY_ROLLS_UP_SUMMARY",
  "MENTIONED_IN_RAW",
  "EVIDENCED_BY_RAW"
] as const;

export type EvidenceEdgeType = (typeof EVIDENCE_EDGE_TYPES)[number];

export const SEMANTIC_EDGE_TYPES = [
  "RELATED_TO",
  "SIMILAR_TO",
  "CAUSED_BY",
  "USED_TOOL",
  "SOLVED_BY"
] as const;

export type SemanticEdgeType = (typeof SEMANTIC_EDGE_TYPES)[number];

export const TEMPORAL_EDGE_TYPES = ["FOLLOWS"] as const;
export type TemporalEdgeType = (typeof TEMPORAL_EDGE_TYPES)[number];

export const NAVIGATION_EDGE_TYPES = ["INDEXES", "ROLLS_UP"] as const;
export type NavigationEdgeType = (typeof NAVIGATION_EDGE_TYPES)[number];

export type EdgeType =
  | EvidenceEdgeType
  | SemanticEdgeType
  | TemporalEdgeType
  | NavigationEdgeType;

export const NODE_STATUSES = ["active", "invalidated"] as const;
export type NodeStatus = (typeof NODE_STATUSES)[number];

export const PATH_STATUSES = ["verified", "blocked", "candidate_only"] as const;
export type PathStatus = (typeof PATH_STATUSES)[number];

export const RESULT_CLASSES = ["candidate", "evidence", "status"] as const;
export type ResultClass = (typeof RESULT_CLASSES)[number];

export const RAW_MESSAGE_ROLES = [
  "user",
  "assistant",
  "system_visible",
  "tool_visible"
] as const;

export type RawMessageRole = (typeof RAW_MESSAGE_ROLES)[number];

function assertAllowedValue<T extends readonly string[]>(
  value: string,
  allowed: T,
  label: string
): T[number] {
  if ((allowed as readonly string[]).includes(value)) {
    return value as T[number];
  }

  throw new TypeError(`Unknown ${label}: ${value}`);
}

export function assertNodeType(value: string): NodeType {
  return assertAllowedValue(value, NODE_TYPES, "NodeType");
}

export function assertEdgeClass(value: string): EdgeClass {
  return assertAllowedValue(value, EDGE_CLASSES, "EdgeClass");
}

export function assertEvidenceEdgeType(value: string): EvidenceEdgeType {
  return assertAllowedValue(value, EVIDENCE_EDGE_TYPES, "EvidenceEdgeType");
}

export function isEvidenceEdgeType(value: string): value is EvidenceEdgeType {
  return (EVIDENCE_EDGE_TYPES as readonly string[]).includes(value);
}

export function assertNodeStatus(value: string): NodeStatus {
  return assertAllowedValue(value, NODE_STATUSES, "NodeStatus");
}

export function assertPathStatus(value: string): PathStatus {
  return assertAllowedValue(value, PATH_STATUSES, "PathStatus");
}

export function assertResultClass(value: string): ResultClass {
  return assertAllowedValue(value, RESULT_CLASSES, "ResultClass");
}

export function assertRawMessageRole(value: string): RawMessageRole {
  return assertAllowedValue(value, RAW_MESSAGE_ROLES, "RawMessageRole");
}
