import type { PartnerMemStore } from "../storage/partner-mem-store.js";
import type {
  RetrievalResult,
  SearchInput,
  TrustedRetrievalIdentity
} from "./retrieval-contracts.js";
import type { TurnNode } from "../core/contracts.js";
import type { RetrievalAuthorization } from "./retrieval-authorization.js";

export class KeywordSearchService {
  constructor(
    private readonly store: PartnerMemStore,
    private readonly authorization: RetrievalAuthorization
  ) {}

  search(
    identity: TrustedRetrievalIdentity,
    input: SearchInput
  ): RetrievalResult<TurnNode> {
    const query = input.query.trim();
    const common = {
      harness_id: identity.harness_id,
      ...(Array.from(query).length < 3
        ? { substring_query: query }
        : { fts_query: quoteFtsPhrase(query) })
    };
    const scope =
      input.scope === "current_conversation"
        ? { conversation_id: identity.conversation_id }
        : { agent_id: this.authorization.requireAgentId(identity) };
    const authorizedById = new Map<string, TurnNode>();
    const batchSize = input.limit + 1;
    let offset = 0;
    let exhausted = false;
    while (authorizedById.size <= input.limit && !exhausted) {
      const matches = this.store.keywordSearch({
        ...common,
        ...scope,
        limit: batchSize,
        offset
      });
      for (const match of matches) {
        const node = this.store.getTurnNode(match.node_id);
        const allowed =
          node !== undefined &&
          (input.scope === "current_conversation"
            ? node.harness_id === identity.harness_id &&
              node.conversation_id === identity.conversation_id
            : this.authorization.canReadGraphNode(identity, node));
        if (allowed && !authorizedById.has(node.node_id)) {
          authorizedById.set(node.node_id, node);
        }
      }
      offset += matches.length;
      exhausted = matches.length < batchSize;
    }
    const authorized = [...authorizedById.values()];
    const truncated = authorized.length > input.limit;
    const items = authorized.slice(0, input.limit);
    return { items, truncated };
  }
}

function quoteFtsPhrase(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}
