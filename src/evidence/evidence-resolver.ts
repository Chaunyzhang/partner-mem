import { randomUUID } from "node:crypto";
import { GraphTraversal, type WalkEvidencePathOptions } from "../graph/traversal.js";
import { GraphStore, type MemoryEdge, type MemoryNode, type RawPayload } from "../storage/graph-store.js";
import {
  buildEvidencePacket,
  type BlockedPath,
  type EvidencePacket,
  type VerifiedRawItem,
  toPathStep
} from "./evidence-packet-builder.js";

export interface EvidenceResolveInput {
  candidate_node_id: string;
  max_depth?: number;
  max_evidence_items?: number;
  query_id?: string;
  include_raw_neighbors?: boolean;
  /** If set, traversal only follows edges owned by this agent. */
  agent_id?: string;
  /** When true, traversal may follow edges owned by other agents. */
  allow_cross_agent?: boolean;
}

export class EvidenceResolver {
  private readonly traversal: GraphTraversal;

  constructor(private readonly store: GraphStore) {
    this.traversal = new GraphTraversal(store);
  }

  resolveEvidence(input: EvidenceResolveInput): EvidencePacket {
    const queryId = input.query_id ?? randomUUID();
    const maxDepth = input.max_depth ?? 3;
    const maxEvidenceItems = input.max_evidence_items ?? 8;
    const candidate = this.store.getNode(input.candidate_node_id);
    const verifiedRawItems: VerifiedRawItem[] = [];
    const blockedPaths: BlockedPath[] = [];

    if (!candidate) {
      blockedPaths.push({
        candidate_node_id: input.candidate_node_id,
        reason: "missing_node",
        path: []
      });
      return this.finish(input, queryId, verifiedRawItems, blockedPaths);
    }

    if (candidate.node_type === "raw_message") {
      const direct = this.verifyRawTerminal(candidate, []);
      if (direct.item) verifiedRawItems.push(direct.item);
      if (direct.blocked) blockedPaths.push(direct.blocked);

      if (input.include_raw_neighbors) {
        const traversalResult = this.traversal.walkEvidencePaths(candidate.node_id, buildTraversalOptions(1, input.agent_id, input.allow_cross_agent));
        blockedPaths.push(...traversalResult.blocked_paths);
        for (const path of traversalResult.paths) {
          this.verifyPath(input.candidate_node_id, path, verifiedRawItems, blockedPaths);
        }
      }

      return this.finish(input, queryId, verifiedRawItems.slice(0, maxEvidenceItems), blockedPaths);
    }

    const traversalResult = this.traversal.walkEvidencePaths(candidate.node_id, buildTraversalOptions(maxDepth, input.agent_id, input.allow_cross_agent));
    blockedPaths.push(...traversalResult.blocked_paths);
    for (const path of traversalResult.paths) {
      this.verifyPath(input.candidate_node_id, path, verifiedRawItems, blockedPaths);
      if (verifiedRawItems.length >= maxEvidenceItems) break;
    }

    return this.finish(input, queryId, verifiedRawItems, blockedPaths);
  }

  verifyTargetHash(edge: MemoryEdge, targetNode: MemoryNode, rawPayload?: RawPayload): boolean {
    const expectedHash = rawPayload?.source_hash ?? targetNode.content_hash;
    return edge.target_hash === expectedHash;
  }

  private verifyPath(
    candidateNodeId: string,
    path: MemoryEdge[],
    verifiedRawItems: VerifiedRawItem[],
    blockedPaths: BlockedPath[]
  ): void {
    const terminalEdge = path.at(-1);
    if (!terminalEdge) {
      blockedPaths.push({ candidate_node_id: candidateNodeId, reason: "missing_edge", path: [] });
      return;
    }

    for (const edge of path) {
      const targetNode = this.store.getNode(edge.to_node_id);
      if (!targetNode) {
        blockedPaths.push({
          candidate_node_id: candidateNodeId,
          terminal_node_id: edge.to_node_id,
          reason: "missing_node",
          path: path.map(toPathStep)
        });
        return;
      }

      const rawPayload = targetNode.node_type === "raw_message" ? this.store.getRawPayload(targetNode.node_id) : undefined;
      if (!this.verifyTargetHash(edge, targetNode, rawPayload)) {
        blockedPaths.push({
          candidate_node_id: candidateNodeId,
          terminal_node_id: targetNode.node_id,
          reason: "target_hash_mismatch",
          path: path.map(toPathStep)
        });
        return;
      }
    }

    const terminalNode = this.store.getNode(terminalEdge.to_node_id);
    if (!terminalNode) {
      blockedPaths.push({
        candidate_node_id: candidateNodeId,
        terminal_node_id: terminalEdge.to_node_id,
        reason: "missing_node",
        path: path.map(toPathStep)
      });
      return;
    }

    const direct = this.verifyRawTerminal(terminalNode, path, candidateNodeId);
    if (direct.item) verifiedRawItems.push(direct.item);
    if (direct.blocked) blockedPaths.push(direct.blocked);
  }

  private verifyRawTerminal(
    node: MemoryNode,
    path: MemoryEdge[],
    candidateNodeId = node.node_id
  ): { item?: VerifiedRawItem; blocked?: BlockedPath } {
    if (node.node_type !== "raw_message") {
      return {
        blocked: {
          candidate_node_id: candidateNodeId,
          terminal_node_id: node.node_id,
          reason: "non_raw_terminal",
          path: path.map(toPathStep)
        }
      };
    }

    const payload = this.store.getRawPayload(node.node_id);
    if (!payload) {
      return {
        blocked: {
          candidate_node_id: candidateNodeId,
          terminal_node_id: node.node_id,
          reason: "missing_raw_payload",
          path: path.map(toPathStep)
        }
      };
    }

    if (payload.source_hash !== node.content_hash) {
      return {
        blocked: {
          candidate_node_id: candidateNodeId,
          terminal_node_id: node.node_id,
          reason: "target_hash_mismatch",
          path: path.map(toPathStep)
        }
      };
    }

    return { item: { node, payload, path } };
  }

  private finish(
    input: EvidenceResolveInput,
    queryId: string,
    verifiedRawItems: VerifiedRawItem[],
    blockedPaths: BlockedPath[]
  ): EvidencePacket {
    const packet = buildEvidencePacket(verifiedRawItems, blockedPaths, queryId);
    this.store.insertEvidencePacketAudit({
      packet_id: randomUUID(),
      query_id: queryId,
      candidate_node_id: input.candidate_node_id,
      evidence_count: packet.evidence_items.length,
      blocked_count: packet.blocked_paths.length,
      created_at: packet.created_at
    });
    return packet;
  }
}

/**
 * Build a WalkEvidencePathOptions that only sets optional fields when defined.
 * Required for strict exactOptionalPropertyTypes compliance.
 */
function buildTraversalOptions(
  maxDepth: number,
  agentId: string | undefined,
  allowCrossAgent: boolean | undefined
): WalkEvidencePathOptions {
  const options: WalkEvidencePathOptions = { max_depth: maxDepth };
  if (agentId !== undefined) options.agent_id = agentId;
  if (allowCrossAgent !== undefined) options.allow_cross_agent = allowCrossAgent;
  return options;
}
