export const SOURCE_OBJECT_KINDS = [
  "conversation",
  "thread",
  "message",
  "author",
  "agent"
] as const;

export type SourceObjectKind = (typeof SOURCE_OBJECT_KINDS)[number];

export type HarnessId = string;
export type FormalObjectId = string;
export type NodeId = string;

export interface HarnessInstance {
  harness_id: HarnessId;
  harness_type: string;
  registered_at: string;
}

export interface SourceObjectMapping {
  harness_id: HarnessId;
  object_kind: SourceObjectKind;
  source_object_id: string;
  formal_id: FormalObjectId;
  created_at: string;
}

export interface TurnNode {
  node_id: NodeId;
  harness_id: HarnessId;
  harness_type: string;
  conversation_id: FormalObjectId;
  thread_id: FormalObjectId | null;
  question_text: string | null;
  question_role: string | null;
  question_message_id: FormalObjectId | null;
  question_author_id: FormalObjectId | null;
  question_visible_at: string | null;
  question_display_order: number | null;
  answer_text: string | null;
  answer_role: string | null;
  answer_message_id: FormalObjectId | null;
  answer_author_id: FormalObjectId | null;
  answer_agent_id: FormalObjectId | null;
  answer_visible_at: string | null;
  answer_display_order: number | null;
  created_at: string;
  updated_at: string;
}

export interface ExplicitReplyEdge {
  edge_id: string;
  harness_id: HarnessId;
  from_node_id: NodeId;
  from_message_id: FormalObjectId;
  to_node_id: NodeId;
  to_message_id: FormalObjectId;
  created_at: string;
}

export function assertSourceObjectKind(value: string): SourceObjectKind {
  if ((SOURCE_OBJECT_KINDS as readonly string[]).includes(value)) {
    return value as SourceObjectKind;
  }
  throw new TypeError(`Unknown source object kind: ${value}`);
}

export function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${field} must be a non-empty string`);
  }
  return value;
}

export function optionalNonEmptyString(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  return requireNonEmptyString(value, field);
}

export function requireNonNegativeInteger(value: unknown, field: string): number | null {
  if (value === undefined || value === null) return null;
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new TypeError(`${field} must be a non-negative integer`);
  }
  return value as number;
}
