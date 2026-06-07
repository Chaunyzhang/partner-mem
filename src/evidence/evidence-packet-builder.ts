import { randomUUID } from "node:crypto";
import type { MemoryEdge, MemoryNode, RawPayload } from "../storage/graph-store.js";

export const BLOCKED_REASONS = [
  "missing_node",
  "missing_edge",
  "disallowed_edge_class",
  "disallowed_edge_type",
  "target_hash_mismatch",
  "cycle_detected",
  "missing_raw_payload",
  "max_depth_exceeded",
  "non_raw_terminal",
  "cross_agent_edge_blocked"
] as const;

export type BlockedReason = (typeof BLOCKED_REASONS)[number];

export interface EvidencePathStep {
  edge_id: string;
  from_node_id: string;
  to_node_id: string;
  edge_type: string;
  edge_class: string;
}

export interface EvidenceItem {
  raw_node_id: string;
  role: string;
  text: string;
  observed_at: string | null;
  session_id: string | null;
  turn_id: string;
  turn_index: number;
  message_index: number;
  source_hash: string;
  path: EvidencePathStep[];
}

export interface BlockedPath {
  candidate_node_id: string;
  terminal_node_id?: string;
  reason: BlockedReason;
  path: EvidencePathStep[];
}

export interface EvidencePacket {
  result_class: "evidence";
  query_id: string;
  evidence_items: EvidenceItem[];
  blocked_paths: BlockedPath[];
  created_at: string;
}

export interface VerifiedRawItem {
  node: MemoryNode;
  payload: RawPayload;
  path: MemoryEdge[];
}

export function buildEvidencePacket(
  verifiedRawItems: VerifiedRawItem[],
  blockedPaths: BlockedPath[],
  queryId: string = randomUUID(),
  createdAt: string = new Date().toISOString()
): EvidencePacket {
  return {
    result_class: "evidence",
    query_id: queryId,
    evidence_items: verifiedRawItems.map(({ node, payload, path }) => ({
      raw_node_id: node.node_id,
      role: payload.role,
      text: payload.text,
      observed_at: node.observed_at,
      session_id: node.session_id,
      turn_id: payload.turn_id,
      turn_index: payload.turn_index,
      message_index: payload.message_index,
      source_hash: payload.source_hash,
      path: path.map(toPathStep)
    })),
    blocked_paths: blockedPaths,
    created_at: createdAt
  };
}

export function toPathStep(edge: MemoryEdge): EvidencePathStep {
  return {
    edge_id: edge.edge_id,
    from_node_id: edge.from_node_id,
    to_node_id: edge.to_node_id,
    edge_type: edge.edge_type,
    edge_class: edge.edge_class
  };
}
