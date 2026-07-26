import type { PartnerMemDatabase } from "../storage/schema.js";
import { openPartnerMemDatabase } from "../storage/schema.js";
import { PartnerMemStore } from "../storage/partner-mem-store.js";
import { TurnIngestService } from "../ingest/turn-ingest-service.js";
import type { EmbeddingProvider } from "../embedding/embedding-provider.js";
import { RetrievalFacade } from "../tools/retrieval-facade.js";
import {
  RuntimeInputError,
  parseGetNodeParams,
  parseInvokeToolParams,
  parseRecordAnswerParams,
  parseRecordQuestionParams,
  parseRecordReplyParams,
  parseRegisterHarnessParams,
  parseRuntimeRequest,
  type RuntimeResponse
} from "./runtime-contracts.js";

export class PartnerMemRuntime {
  private readonly store: PartnerMemStore;
  private readonly ingest: TurnIngestService;
  private readonly retrieval: RetrievalFacade;

  constructor(
    private readonly db: PartnerMemDatabase,
    clock?: () => string,
    embeddingProvider: EmbeddingProvider | null = null
  ) {
    this.store = new PartnerMemStore(db);
    this.ingest = new TurnIngestService(this.store, clock);
    this.retrieval = new RetrievalFacade(this.store, embeddingProvider, clock);
  }

  static open(
    databasePath: string,
    embeddingProvider: EmbeddingProvider | null = null
  ): PartnerMemRuntime {
    return new PartnerMemRuntime(
      openPartnerMemDatabase(databasePath),
      undefined,
      embeddingProvider
    );
  }

  async handle(value: unknown): Promise<RuntimeResponse> {
    let id =
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value) &&
      typeof (value as { id?: unknown }).id === "string" &&
      (value as { id: string }).id.trim().length > 0
        ? (value as { id: string }).id
        : "unknown";
    try {
      const request = parseRuntimeRequest(value);
      id = request.id;
      switch (request.command) {
        case "register_harness": {
          const harness = this.store.registerHarness(
            parseRegisterHarnessParams(request.params).harness_type
          );
          return {
            id,
            ok: true,
            result: { harness_id: harness.harness_id }
          };
        }
        case "record_question": {
          const node = this.ingest.recordQuestion(
            parseRecordQuestionParams(request.params)
          );
          return {
            id,
            ok: true,
            result: { node_id: node.node_id }
          };
        }
        case "record_answer": {
          const node = this.ingest.recordAnswer(
            parseRecordAnswerParams(request.params)
          );
          return {
            id,
            ok: true,
            result: { node_id: node.node_id }
          };
        }
        case "record_reply": {
          const edge = this.ingest.recordReply(
            parseRecordReplyParams(request.params)
          );
          return {
            id,
            ok: true,
            result: { edge_id: edge.edge_id }
          };
        }
        case "invoke_tool": {
          const params = parseInvokeToolParams(request.params);
          const identity = this.store.transaction(() => {
            const conversation = this.store.resolveSourceObject({
              harness_id: params.harness_id,
              object_kind: "conversation",
              source_object_id: params.source_conversation_id
            });
            const agent =
              params.source_agent_id === undefined
                ? undefined
                : this.store.resolveSourceObject({
                    harness_id: params.harness_id,
                    object_kind: "agent",
                    source_object_id: params.source_agent_id
                  });
            if (agent !== undefined) {
              this.store.grantAgentConversationAccess({
                harness_id: params.harness_id,
                agent_id: agent.formal_id,
                conversation_id: conversation.formal_id
              });
            }
            return {
              harness_id: params.harness_id,
              conversation_id: conversation.formal_id,
              agent_id: agent?.formal_id
            };
          });
          const result = await this.retrieval.invoke(
            params.tool_name,
            params.arguments,
            identity
          );
          return { id, ok: true, result };
        }
        case "get_node": {
          const params = parseGetNodeParams(request.params);
          const node = this.store.getTurnNode(params.node_id);
          if (!node || node.harness_id !== params.harness_id) {
            return {
              id,
              ok: false,
              error: { code: "NOT_FOUND", message: "Turn node was not found" }
            };
          }
          return { id, ok: true, result: node };
        }
      }
    } catch (error) {
      const unknownCommand =
        error instanceof RuntimeInputError &&
        error.message.startsWith("Unknown runtime command:");
      return {
        id,
        ok: false,
        error: {
          code: unknownCommand
            ? "UNKNOWN_COMMAND"
            : error instanceof RuntimeInputError || error instanceof TypeError
              ? "INVALID_REQUEST"
              : "WRITE_REJECTED",
          message: error instanceof Error ? error.message : "Partner-Mem request failed"
        }
      };
    }
  }

  close(): void {
    this.db.close();
  }
}
