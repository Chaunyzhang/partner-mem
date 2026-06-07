import { randomUUID } from "node:crypto";
import { assertRawMessageRole, type RawMessageRole } from "../core/contracts.js";
import { hashText } from "../core/hash.js";
import { EvidenceEdgeBuilder } from "../evidence/evidence-edge-builder.js";
import { GraphStore } from "../storage/graph-store.js";

export interface RawMessageInput {
  role: RawMessageRole;
  text: string;
  observed_at: string;
  message_index: number;
}

export interface RawTurnInput {
  agent_id: string;
  session_id: string;
  turn_id: string;
  turn_index: number;
  messages: RawMessageInput[];
}

export interface RawIngestResult {
  raw_node_ids: string[];
  raw_near_raw_edge_ids: string[];
}

export class RawIngestService {
  private readonly evidenceEdgeBuilder: EvidenceEdgeBuilder;

  constructor(private readonly store: GraphStore) {
    this.evidenceEdgeBuilder = new EvidenceEdgeBuilder(store);
  }

  ingestTurn(input: RawTurnInput): RawIngestResult {
    this.validateTurn(input);

    return this.store.transaction(() => {
      const raw_node_ids: string[] = [];
      const raw_near_raw_edge_ids: string[] = [];

      for (const message of input.messages) {
        const nodeId = randomUUID();
        const sourceHash = hashText(message.text);
        const createdAt = new Date().toISOString();

        this.store.createNode({
          node_id: nodeId,
          agent_id: input.agent_id,
          session_id: input.session_id,
          node_type: "raw_message",
          created_at: createdAt,
          observed_at: message.observed_at,
          content_hash: sourceHash,
          metadata_json: "{}"
        });
        this.store.createRawPayload({
          node_id: nodeId,
          role: message.role,
          text: message.text,
          normalized_text: normalizeRawText(message.text),
          token_count: countTokens(message.text),
          turn_id: input.turn_id,
          turn_index: input.turn_index,
          message_index: message.message_index,
          source_hash: sourceHash
        });
        this.store.insertFtsNode({
          node_id: nodeId,
          agent_id: input.agent_id,
          session_id: input.session_id,
          node_type: "raw_message",
          text: message.text
        });

        raw_node_ids.push(nodeId);
      }

      for (let index = 0; index < raw_node_ids.length - 1; index += 1) {
        const fromNodeId = raw_node_ids[index];
        const toNodeId = raw_node_ids[index + 1];
        if (!fromNodeId || !toNodeId) continue;
        const targetHash = this.store.getRawPayload(toNodeId)?.source_hash;
        if (!targetHash) {
          throw new Error(`Missing target raw payload for ${toNodeId}`);
        }

        raw_near_raw_edge_ids.push(
          this.evidenceEdgeBuilder.createEvidenceEdge({
            agent_id: input.agent_id,
            from_node_id: fromNodeId,
            to_node_id: toNodeId,
            edge_type: "RAW_NEAR_RAW",
            observed_at: input.messages[index + 1]?.observed_at ?? null,
            target_hash: targetHash
          })
        );
      }

      const firstNodeId = raw_node_ids[0];
      const firstMessage = input.messages[0];
      if (firstNodeId && firstMessage) {
        const previous = this.store.getLatestRawTimelineItemBefore({
          agent_id: input.agent_id,
          session_id: input.session_id,
          turn_index: input.turn_index,
          message_index: firstMessage.message_index
        });
        if (previous) {
          this.store.createEdge({
            edge_id: randomUUID(),
            agent_id: input.agent_id,
            from_node_id: firstNodeId,
            to_node_id: previous.node.node_id,
            edge_type: "FOLLOWS",
            edge_class: "temporal",
            created_at: new Date().toISOString(),
            observed_at: firstMessage.observed_at,
            target_hash: previous.payload.source_hash
          });
        }
      }

      return { raw_node_ids, raw_near_raw_edge_ids };
    });
  }

  private validateTurn(input: RawTurnInput): void {
    if (input.messages.length === 0) {
      throw new TypeError("Raw turn must contain at least one visible message");
    }

    for (const message of input.messages) {
      assertRawMessageRole(message.role);
      if (message.text.trim().length === 0) {
        throw new TypeError("Raw message text must not be empty");
      }
      if (!Number.isInteger(message.message_index) || message.message_index < 0) {
        throw new TypeError("Raw message message_index must be a non-negative integer");
      }
    }
  }
}

function normalizeRawText(text: string): string {
  return text.normalize("NFC");
}

function countTokens(text: string): number {
  return text.trim().length === 0 ? 0 : text.trim().split(/\s+/u).length;
}
