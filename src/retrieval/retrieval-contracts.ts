import type { ExplicitReplyEdge, TurnNode } from "../core/contracts.js";

export const RETRIEVAL_SCOPES = [
  "current_conversation",
  "agent_conversations"
] as const;

export type RetrievalScope = (typeof RETRIEVAL_SCOPES)[number];
export type RetrievalType = "keyword" | "vector" | "graph";
export type RetrievalStatus = "ok" | "empty" | "error";

export interface TrustedRetrievalIdentity {
  harness_id: string;
  conversation_id: string;
  agent_id?: string | null | undefined;
}

export interface SearchInput {
  query: string;
  scope: RetrievalScope;
  limit: number;
}

export interface GraphTraverseInput {
  start_node_id: string;
  direction: "parent" | "replies" | "both";
  max_depth: number;
  limit: number;
}

export interface EvidenceSide {
  text: string;
  role: string | null;
  message_id: string | null;
  author_id: string | null;
  visible_at: string | null;
  display_order: number | null;
}

export interface AnswerEvidenceSide extends EvidenceSide {
  agent_id: string | null;
}

export interface EvidenceItem {
  rank: number;
  node_id: string;
  harness_id: string;
  harness_type: string;
  conversation_id: string;
  thread_id: string | null;
  question: EvidenceSide | null;
  answer: AnswerEvidenceSide | null;
}

export interface GraphPathStep {
  edge_id: string;
  from_node_id: string;
  from_message_id: string;
  to_node_id: string;
  to_message_id: string;
}

export interface GraphEvidenceItem extends EvidenceItem {
  path: GraphPathStep[];
}

export type RetrievalErrorCode =
  | "invalid_tool_input"
  | "trusted_identity_invalid"
  | "embedding_unavailable"
  | "partner_mem_unavailable";

export interface RetrievalEnvelope<T extends EvidenceItem = EvidenceItem> {
  status: RetrievalStatus;
  retrieval_type: RetrievalType;
  truncated: boolean;
  evidence_items: T[];
  error_code?: RetrievalErrorCode | undefined;
}

export interface RetrievalResult<T> {
  items: T[];
  truncated: boolean;
}

export interface GraphTraversalResultItem {
  node: TurnNode;
  path: ExplicitReplyEdge[];
}

export function projectEvidenceItem(node: TurnNode, rank: number): EvidenceItem {
  return {
    rank,
    node_id: node.node_id,
    harness_id: node.harness_id,
    harness_type: node.harness_type,
    conversation_id: node.conversation_id,
    thread_id: node.thread_id,
    question:
      node.question_text === null
        ? null
        : {
            text: node.question_text,
            role: node.question_role,
            message_id: node.question_message_id,
            author_id: node.question_author_id,
            visible_at: node.question_visible_at,
            display_order: node.question_display_order
          },
    answer:
      node.answer_text === null
        ? null
        : {
            text: node.answer_text,
            role: node.answer_role,
            message_id: node.answer_message_id,
            author_id: node.answer_author_id,
            agent_id: node.answer_agent_id,
            visible_at: node.answer_visible_at,
            display_order: node.answer_display_order
          }
  };
}

export function projectGraphPath(edges: ExplicitReplyEdge[]): GraphPathStep[] {
  return edges.map((edge) => ({
    edge_id: edge.edge_id,
    from_node_id: edge.from_node_id,
    from_message_id: edge.from_message_id,
    to_node_id: edge.to_node_id,
    to_message_id: edge.to_message_id
  }));
}
