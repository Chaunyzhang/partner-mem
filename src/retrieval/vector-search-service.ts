import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import {
  EmbeddingProviderError,
  type EmbeddingProvider
} from "../embedding/embedding-provider.js";
import type { TurnNode } from "../core/contracts.js";
import type {
  NodeVectorIndex,
  PartnerMemStore
} from "../storage/partner-mem-store.js";
import type {
  RetrievalResult,
  SearchInput,
  TrustedRetrievalIdentity
} from "./retrieval-contracts.js";
import type { RetrievalAuthorization } from "./retrieval-authorization.js";

export class VectorSearchService {
  constructor(
    private readonly store: PartnerMemStore,
    private readonly authorization: RetrievalAuthorization,
    private readonly provider: EmbeddingProvider | null,
    private readonly clock: () => string = () => new Date().toISOString()
  ) {}

  async search(
    identity: TrustedRetrievalIdentity,
    input: SearchInput
  ): Promise<RetrievalResult<TurnNode>> {
    const nodes =
      input.scope === "current_conversation"
        ? this.store.listTurnNodesForCurrentConversation({
            harness_id: identity.harness_id,
            conversation_id: identity.conversation_id
          })
        : this.store.listTurnNodesForAgent({
            harness_id: identity.harness_id,
            agent_id: this.authorization.requireAgentId(identity)
          });
    if (nodes.length === 0) return { items: [], truncated: false };
    if (this.provider === null) {
      throw new EmbeddingProviderError("No embedding provider is configured");
    }

    const queryVector = validateEmbedding(
      await this.embed(input.query),
      "query"
    );
    const ranked: Array<{ node: TurnNode; distance: number }> = [];
    for (const node of nodes) {
      const vector = await this.resolveNodeVector(node, queryVector.length);
      ranked.push({ node, distance: cosineDistance(queryVector, vector) });
    }
    ranked.sort(
      (left, right) =>
        left.distance - right.distance ||
        left.node.node_id.localeCompare(right.node.node_id)
    );
    return {
      items: ranked.slice(0, input.limit).map((entry) => entry.node),
      truncated: ranked.length > input.limit
    };
  }

  private async resolveNodeVector(
    node: TurnNode,
    expectedDimensions: number
  ): Promise<number[]> {
    if (this.provider === null) {
      throw new EmbeddingProviderError("No embedding provider is configured");
    }
    const content = turnEmbeddingText(node);
    const contentSha256 = createHash("sha256").update(content).digest("hex");
    const existing = this.store.getNodeVector(node.node_id);
    if (
      existing &&
      existing.provider_id === this.provider.provider_id &&
      existing.model === this.provider.model &&
      existing.content_sha256 === contentSha256 &&
      existing.dimensions === expectedDimensions
    ) {
      return decodeVector(existing);
    }

    const vector = validateEmbedding(
      await this.embed(content),
      `node ${node.node_id}`
    );
    if (vector.length !== expectedDimensions) {
      throw new EmbeddingProviderError(
        `Embedding dimensions changed between query and node ${node.node_id}`
      );
    }
    this.store.upsertNodeVector({
      node_id: node.node_id,
      provider_id: this.provider.provider_id,
      model: this.provider.model,
      dimensions: vector.length,
      content_sha256: contentSha256,
      vector: encodeVector(vector),
      indexed_at: this.clock()
    });
    return vector;
  }

  private async embed(text: string): Promise<readonly number[]> {
    if (this.provider === null) {
      throw new EmbeddingProviderError("No embedding provider is configured");
    }
    try {
      return await this.provider.embed(text);
    } catch (error) {
      if (error instanceof EmbeddingProviderError) throw error;
      throw new EmbeddingProviderError("Embedding provider failed", {
        cause: error
      });
    }
  }
}

export function turnEmbeddingText(node: TurnNode): string {
  if (node.question_text !== null && node.answer_text !== null) {
    return `${node.question_text}\n${node.answer_text}`;
  }
  return node.question_text ?? node.answer_text ?? "";
}

function validateEmbedding(value: readonly number[], source: string): number[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new EmbeddingProviderError(
      `Embedding for ${source} must be a non-empty number array`
    );
  }
  const copy = value.map((entry) => {
    const float32 = Math.fround(entry);
    if (!Number.isFinite(entry) || !Number.isFinite(float32)) {
      throw new EmbeddingProviderError(
        `Embedding for ${source} must remain finite as Float32`
      );
    }
    return float32;
  });
  const magnitude = vectorMagnitude(copy);
  if (!Number.isFinite(magnitude) || magnitude === 0) {
    throw new EmbeddingProviderError(
      `Embedding for ${source} must have a finite non-zero norm`
    );
  }
  return copy;
}

function encodeVector(vector: readonly number[]): Buffer {
  const buffer = Buffer.alloc(vector.length * 4);
  vector.forEach((entry, index) => {
    buffer.writeFloatLE(entry, index * 4);
  });
  return buffer;
}

function decodeVector(index: NodeVectorIndex): number[] {
  if (index.vector.length !== index.dimensions * 4) {
    throw new EmbeddingProviderError(
      `Stored vector for ${index.node_id} has an invalid byte length`
    );
  }
  return validateEmbedding(
    Array.from({ length: index.dimensions }, (_, position) =>
      index.vector.readFloatLE(position * 4)
    ),
    `stored node ${index.node_id}`
  );
}

function cosineDistance(left: readonly number[], right: readonly number[]): number {
  if (left.length !== right.length) {
    throw new EmbeddingProviderError("Embedding dimensions do not match");
  }
  const leftMagnitude = vectorMagnitude(left);
  const rightMagnitude = vectorMagnitude(right);
  if (
    !Number.isFinite(leftMagnitude) ||
    !Number.isFinite(rightMagnitude) ||
    leftMagnitude === 0 ||
    rightMagnitude === 0
  ) {
    throw new EmbeddingProviderError(
      "Cosine distance requires finite non-zero vectors"
    );
  }
  let normalizedDot = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index];
    const rightValue = right[index];
    if (leftValue === undefined || rightValue === undefined) {
      throw new Error("Embedding index is out of bounds");
    }
    normalizedDot +=
      (leftValue / leftMagnitude) * (rightValue / rightMagnitude);
  }
  const distance = 1 - normalizedDot;
  if (!Number.isFinite(distance)) {
    throw new EmbeddingProviderError("Cosine distance must be finite");
  }
  return distance;
}

function vectorMagnitude(vector: readonly number[]): number {
  let scale = 0;
  let scaledSquares = 1;
  for (const value of vector) {
    const absolute = Math.abs(value);
    if (absolute === 0) continue;
    if (scale < absolute) {
      const ratio = scale / absolute;
      scaledSquares = 1 + scaledSquares * ratio * ratio;
      scale = absolute;
    } else {
      const ratio = absolute / scale;
      scaledSquares += ratio * ratio;
    }
  }
  return scale === 0 ? 0 : scale * Math.sqrt(scaledSquares);
}
