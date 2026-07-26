import type { TurnNode } from "../core/contracts.js";
import { requireNonEmptyString } from "../core/contracts.js";
import type { PartnerMemStore } from "../storage/partner-mem-store.js";
import type { TrustedRetrievalIdentity } from "./retrieval-contracts.js";

export class TrustedIdentityError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "TrustedIdentityError";
  }
}

export class RetrievalAuthorization {
  constructor(private readonly store: PartnerMemStore) {}

  assertTrustedIdentity(
    identity: unknown
  ): TrustedRetrievalIdentity {
    const normalized = parseTrustedIdentity(identity);
    const harnessId = normalized.harness_id;
    const conversationId = normalized.conversation_id;
    if (!this.store.getHarness(harnessId)) {
      throw new TrustedIdentityError("Trusted harness_id is not registered");
    }
    if (
      !this.store.isFormalObject({
        harness_id: harnessId,
        object_kind: "conversation",
        formal_id: conversationId
      })
    ) {
      throw new TrustedIdentityError(
        "Trusted conversation_id is not formal for this Harness"
      );
    }
    if (
      normalized.agent_id !== undefined &&
      normalized.agent_id !== null &&
      !this.store.isFormalObject({
        harness_id: harnessId,
        object_kind: "agent",
        formal_id: normalized.agent_id
      })
    ) {
      throw new TrustedIdentityError(
        "Trusted agent_id is not formal for this Harness"
      );
    }
    return normalized;
  }

  requireAgentId(identity: TrustedRetrievalIdentity): string {
    if (identity.agent_id === undefined || identity.agent_id === null) {
      throw new TrustedIdentityError(
        "Trusted agent_id is required for agent_conversations"
      );
    }
    return requireNonEmptyString(identity.agent_id, "agent_id");
  }

  canReadGraphNode(
    identity: TrustedRetrievalIdentity,
    node: TurnNode
  ): boolean {
    if (node.harness_id !== identity.harness_id) return false;
    if (node.conversation_id === identity.conversation_id) return true;
    if (identity.agent_id === undefined || identity.agent_id === null) return false;
    return this.store.hasAgentConversationAccess({
      harness_id: identity.harness_id,
      agent_id: identity.agent_id,
      conversation_id: node.conversation_id
    });
  }
}

function parseTrustedIdentity(identity: unknown): TrustedRetrievalIdentity {
  if (
    typeof identity !== "object" ||
    identity === null ||
    Array.isArray(identity)
  ) {
    throw new TrustedIdentityError("Trusted identity must be an object");
  }
  const fields = identity as Record<string, unknown>;
  try {
    const harnessId = requireNonEmptyString(
      fields.harness_id,
      "harness_id"
    );
    const conversationId = requireNonEmptyString(
      fields.conversation_id,
      "conversation_id"
    );
    const agentId =
      fields.agent_id === undefined || fields.agent_id === null
        ? null
        : requireNonEmptyString(fields.agent_id, "agent_id");
    return {
      harness_id: harnessId,
      conversation_id: conversationId,
      agent_id: agentId
    };
  } catch (error) {
    throw new TrustedIdentityError("Trusted identity fields are invalid", {
      cause: error
    });
  }
}
