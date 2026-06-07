import { hashText } from "../core/hash.js";
import { GraphStore, type MemoryNode, type RawPayload } from "../storage/graph-store.js";
import {
  EXTRACTION_PROMPT_VERSION,
  type ExtractionWriteResult,
  type ValidatedExtractionItem
} from "./extraction-contracts.js";

export interface TypedGraphWriteInput {
  raw_node: MemoryNode;
  raw_payload: RawPayload;
  accepted_items: ValidatedExtractionItem[];
  extracted_at?: string;
  prompt_version?: string;
  model_provider?: string;
  model_name?: string;
}

export class TypedGraphWriter {
  constructor(private readonly store: GraphStore) {}

  writeAcceptedItems(input: TypedGraphWriteInput): ExtractionWriteResult {
    const accepted_items = this.store.transaction(() =>
      input.accepted_items.map((item) => {
        const typedNodeId = buildTypedNodeId(input.raw_node.agent_id, item);
        const edgeId = buildEvidenceEdgeId(typedNodeId, input.raw_node.node_id);
        const extractedAt = input.extracted_at ?? new Date().toISOString();
        const promptVersion = input.prompt_version ?? EXTRACTION_PROMPT_VERSION;

        if (!this.store.getNode(typedNodeId)) {
          this.store.createNode({
            node_id: typedNodeId,
            agent_id: input.raw_node.agent_id,
            session_id: null,
            node_type: item.node_type,
            created_at: extractedAt,
            observed_at: input.raw_node.observed_at,
            valid_from: item.temporal.valid_from,
            valid_to: item.temporal.valid_to,
            content_hash: hashText(`${item.node_type}\n${item.label}\n${item.text}`),
            metadata_json: JSON.stringify(
              compactObject({
                source: "typed_graph_extraction",
                schema_version: item.schema_version,
                prompt_version: promptVersion,
                model_provider: input.model_provider,
                model_name: input.model_name,
                label: item.label,
                text: item.text,
                attributes: item.attributes,
                temporal: item.temporal,
                source_raw_node_id: input.raw_node.node_id
              })
            )
          });
        }

        const existingEdge = this.store
          .listOutgoingEdges(typedNodeId, { edge_class: "evidence", edge_type: "EVIDENCED_BY_RAW" })
          .some((edge) => edge.edge_id === edgeId);
        if (!existingEdge) {
          this.store.createEdge({
            edge_id: edgeId,
            agent_id: input.raw_node.agent_id,
            from_node_id: typedNodeId,
            to_node_id: input.raw_node.node_id,
            edge_type: "EVIDENCED_BY_RAW",
            edge_class: "evidence",
            created_at: extractedAt,
            observed_at: input.raw_node.observed_at,
            valid_from: item.temporal.valid_from,
            valid_to: item.temporal.valid_to,
            target_hash: input.raw_payload.source_hash,
            metadata_json: JSON.stringify(
              compactObject({
                source: "typed_graph_extraction",
                schema_version: item.schema_version,
                prompt_version: promptVersion,
                evidence_text: item.evidence_text,
                temporal: item.temporal
              })
            )
          });
        }

        this.store.replaceFtsNode({
          node_id: typedNodeId,
          agent_id: input.raw_node.agent_id,
          session_id: null,
          node_type: item.node_type,
          text: buildTypedFtsText(item)
        });

        return {
          raw_node_id: input.raw_node.node_id,
          typed_node_id: typedNodeId,
          edge_id: edgeId,
          node_type: item.node_type,
          label: item.label
        };
      })
    );

    return { accepted_items, rejected_items: [] };
  }
}

export function buildTypedNodeId(agentId: string, item: Pick<ValidatedExtractionItem, "node_type" | "label" | "text">): string {
  const identityHash = hashText(`${normalizeForIdentity(item.label)}\n${normalizeForIdentity(item.text)}`);
  return `typed:${agentId}:${item.node_type}:${identityHash}`;
}

export function buildEvidenceEdgeId(typedNodeId: string, rawNodeId: string): string {
  return `edge:evidenced-by-raw:${typedNodeId}:${rawNodeId}`;
}

function buildTypedFtsText(item: ValidatedExtractionItem): string {
  const parts = [
    item.label,
    item.text,
    item.evidence_text,
    ...item.attributes.flatMap((attribute) => [
      attribute.key,
      String(attribute.value),
      attribute.evidence_text
    ]),
    item.temporal.source_text ?? ""
  ];
  return parts.filter((part) => part.trim().length > 0).join("\n");
}

function normalizeForIdentity(value: string): string {
  return value.normalize("NFC").trim().replace(/\s+/gu, " ").toLowerCase();
}

function compactObject(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}
