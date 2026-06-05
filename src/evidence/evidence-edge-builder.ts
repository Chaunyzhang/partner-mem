import { randomUUID } from "node:crypto";
import { assertEvidenceEdgeType, type EvidenceEdgeType } from "../core/contracts.js";
import { GraphStore, type CreateEdgeInput, type MemoryEdge } from "../storage/graph-store.js";

export interface CreateEvidenceEdgeInput {
  edge_id?: string;
  agent_id: string;
  from_node_id: string;
  to_node_id: string;
  edge_type: EvidenceEdgeType;
  created_at?: string;
  observed_at?: string | null;
  target_hash: string;
  weight?: number;
  confidence?: number;
  metadata_json?: string;
}

export class EvidenceEdgeBuilder {
  constructor(private readonly store: GraphStore) {}

  createEvidenceEdge(input: CreateEvidenceEdgeInput): string {
    assertEvidenceEdgeType(input.edge_type);
    if (input.target_hash.length === 0) {
      throw new TypeError("Evidence edge target_hash is required");
    }

    const fromNode = this.store.getNode(input.from_node_id);
    if (!fromNode) {
      throw new TypeError(`Evidence edge source node does not exist: ${input.from_node_id}`);
    }

    const toNode = this.store.getNode(input.to_node_id);
    if (!toNode) {
      throw new TypeError(`Evidence edge target node does not exist: ${input.to_node_id}`);
    }

    const targetHash = this.getTargetHash(input.to_node_id, toNode.content_hash);
    if (input.target_hash !== targetHash) {
      throw new TypeError("Evidence edge target_hash must match target node or raw payload");
    }

    const edgeId = input.edge_id ?? randomUUID();
    const edgeInput: CreateEdgeInput = {
      edge_id: edgeId,
      agent_id: input.agent_id,
      from_node_id: input.from_node_id,
      to_node_id: input.to_node_id,
      edge_type: input.edge_type,
      edge_class: "evidence",
      created_at: input.created_at ?? new Date().toISOString(),
      observed_at: input.observed_at ?? null,
      target_hash: input.target_hash
    };
    if (input.weight !== undefined) edgeInput.weight = input.weight;
    if (input.confidence !== undefined) edgeInput.confidence = input.confidence;
    if (input.metadata_json !== undefined) edgeInput.metadata_json = input.metadata_json;

    this.store.createEdge(edgeInput);

    return edgeId;
  }

  getEvidenceEdge(edgeId: string, fromNodeId: string): MemoryEdge | undefined {
    return this.store
      .listOutgoingEdges(fromNodeId, { edge_class: "evidence" })
      .find((edge) => edge.edge_id === edgeId);
  }

  private getTargetHash(nodeId: string, nodeContentHash: string): string {
    return this.store.getRawPayload(nodeId)?.source_hash ?? nodeContentHash;
  }
}
