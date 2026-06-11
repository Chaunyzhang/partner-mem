import { GraphStore } from "../storage/graph-store.js";
import {
  type ExtractionAcceptedItem,
  type ExtractionBatchResult,
  type ExtractionRejectedItem,
  type ExtractorModelClient,
  ModelExtractionError
} from "./extraction-contracts.js";
import { validateExtractionProposal } from "./proposal-validator.js";
import { TypedGraphWriter } from "./typed-graph-writer.js";

export class ExtractorService {
  private readonly writer: TypedGraphWriter;

  constructor(
    private readonly store: GraphStore,
    private readonly modelClient: ExtractorModelClient
  ) {
    this.writer = new TypedGraphWriter(store);
  }

  async extractRawNodes(rawNodeIds: string[]): Promise<ExtractionBatchResult> {
    const accepted_items: ExtractionAcceptedItem[] = [];
    const rejected_items: ExtractionRejectedItem[] = [];

    for (const rawNodeId of rawNodeIds) {
      const rawNode = this.store.getNode(rawNodeId);
      if (!rawNode || rawNode.node_type !== "raw_message") {
        rejected_items.push({
          raw_node_id: rawNodeId,
          reason: "missing_raw_node",
          message: "Raw node does not exist or is not a raw_message"
        });
        continue;
      }

      const rawPayload = this.store.getRawPayload(rawNode.node_id);
      if (!rawPayload) {
        rejected_items.push({
          raw_node_id: rawNode.node_id,
          reason: "missing_raw_payload",
          message: "Raw node has no raw payload"
        });
        continue;
      }

      let proposal: unknown;
      try {
        proposal = await this.modelClient.extractRawMessage({
          agent_id: rawNode.agent_id,
          raw_node_id: rawNode.node_id,
          raw_text: rawPayload.text,
          observed_at: rawNode.observed_at
        });
      } catch (error) {
        if (error instanceof ModelExtractionError) {
          rejected_items.push({
            raw_node_id: rawNode.node_id,
            reason: error.reason,
            message: error.message
          });
          continue;
        }
        rejected_items.push({
          raw_node_id: rawNode.node_id,
          reason: "model_invalid_json",
          message: error instanceof Error ? error.message : String(error)
        });
        continue;
      }

      const validation = validateExtractionProposal(proposal, rawNode, rawPayload);
      rejected_items.push(...validation.rejected_items);

      if (validation.accepted_items.length === 0) continue;
      const writeResult = this.writer.writeAcceptedItems({
        raw_node: rawNode,
        raw_payload: rawPayload,
        accepted_items: validation.accepted_items
      });
      accepted_items.push(...writeResult.accepted_items);
      rejected_items.push(...writeResult.rejected_items);
    }

    return { accepted_items, rejected_items };
  }
}
