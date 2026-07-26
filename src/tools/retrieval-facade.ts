import {
  EmbeddingProviderError,
  type EmbeddingProvider
} from "../embedding/embedding-provider.js";
import { KeywordSearchService } from "../retrieval/keyword-search-service.js";
import {
  projectEvidenceItem,
  projectGraphPath,
  type EvidenceItem,
  type GraphEvidenceItem,
  type RetrievalEnvelope,
  type RetrievalErrorCode,
  type RetrievalResult,
  type RetrievalType
} from "../retrieval/retrieval-contracts.js";
import {
  RetrievalAuthorization,
  TrustedIdentityError
} from "../retrieval/retrieval-authorization.js";
import { ReplyGraphTraversalService } from "../retrieval/reply-graph-traversal-service.js";
import { VectorSearchService } from "../retrieval/vector-search-service.js";
import type { PartnerMemStore } from "../storage/partner-mem-store.js";
import {
  ToolInputError,
  parseGraphTraverseInput,
  parseSearchToolInput,
  type ModelVisibleToolName
} from "./tool-contracts.js";

export class RetrievalFacade {
  private readonly authorization: RetrievalAuthorization;
  private readonly keyword: KeywordSearchService;
  private readonly vector: VectorSearchService;
  private readonly graph: ReplyGraphTraversalService;

  constructor(
    store: PartnerMemStore,
    provider: EmbeddingProvider | null = null,
    clock?: () => string
  ) {
    this.authorization = new RetrievalAuthorization(store);
    this.keyword = new KeywordSearchService(store, this.authorization);
    this.vector = new VectorSearchService(
      store,
      this.authorization,
      provider,
      clock
    );
    this.graph = new ReplyGraphTraversalService(store, this.authorization);
  }

  async invoke(
    toolName: ModelVisibleToolName,
    input: unknown,
    identity: unknown
  ): Promise<RetrievalEnvelope> {
    const retrievalType = retrievalTypeForTool(toolName);
    try {
      const trustedIdentity =
        this.authorization.assertTrustedIdentity(identity);
      switch (toolName) {
        case "partner_mem_keyword_search": {
          const result = this.keyword.search(
            trustedIdentity,
            parseSearchToolInput(input)
          );
          return evidenceEnvelope(retrievalType, result);
        }
        case "partner_mem_vector_search": {
          const result = await this.vector.search(
            trustedIdentity,
            parseSearchToolInput(input)
          );
          return evidenceEnvelope(retrievalType, result);
        }
        case "partner_mem_graph_traverse": {
          const result = this.graph.traverse(
            trustedIdentity,
            parseGraphTraverseInput(input)
          );
          const evidence: RetrievalResult<GraphEvidenceItem> = {
            truncated: result.truncated,
            items: result.items.map((entry, index) => ({
              ...projectEvidenceItem(entry.node, index + 1),
              path: projectGraphPath(entry.path)
            }))
          };
          return projectedEnvelope(retrievalType, evidence);
        }
      }
    } catch (error) {
      return errorEnvelope(retrievalType, errorCode(error));
    }
  }
}

function evidenceEnvelope(
  retrievalType: RetrievalType,
  result: RetrievalResult<Parameters<typeof projectEvidenceItem>[0]>
): RetrievalEnvelope {
  return projectedEnvelope(retrievalType, {
    truncated: result.truncated,
    items: result.items.map((node, index) =>
      projectEvidenceItem(node, index + 1)
    )
  });
}

function projectedEnvelope<T extends EvidenceItem>(
  retrievalType: RetrievalType,
  result: RetrievalResult<T>
): RetrievalEnvelope<T> {
  return {
    status: result.items.length === 0 ? "empty" : "ok",
    retrieval_type: retrievalType,
    truncated: result.truncated,
    evidence_items: result.items
  };
}

function errorEnvelope(
  retrievalType: RetrievalType,
  errorCode: RetrievalErrorCode
): RetrievalEnvelope {
  return {
    status: "error",
    retrieval_type: retrievalType,
    truncated: false,
    error_code: errorCode,
    evidence_items: []
  };
}

function errorCode(error: unknown): RetrievalErrorCode {
  if (error instanceof ToolInputError) return "invalid_tool_input";
  if (error instanceof TrustedIdentityError) return "trusted_identity_invalid";
  if (error instanceof EmbeddingProviderError) return "embedding_unavailable";
  return "partner_mem_unavailable";
}

function retrievalTypeForTool(toolName: ModelVisibleToolName): RetrievalType {
  switch (toolName) {
    case "partner_mem_keyword_search":
      return "keyword";
    case "partner_mem_vector_search":
      return "vector";
    case "partner_mem_graph_traverse":
      return "graph";
  }
}
