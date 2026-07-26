import {
  EmbeddingProviderError,
  type EmbeddingProvider
} from "./embedding-provider.js";

export interface OpenAICompatibleEmbeddingConfig {
  provider_id: string;
  endpoint: string;
  api_key?: string | null | undefined;
  model: string;
  dimensions?: number | null | undefined;
  timeout_ms?: number | null | undefined;
}

export class OpenAICompatibleEmbeddingProvider implements EmbeddingProvider {
  readonly provider_id: string;
  readonly model: string;
  private readonly endpoint: string;
  private readonly apiKey: string | null;
  private readonly dimensions: number | null;
  private readonly timeoutMs: number;

  constructor(
    config: OpenAICompatibleEmbeddingConfig,
    private readonly fetchImplementation: typeof fetch = fetch
  ) {
    this.provider_id = requireText(config.provider_id, "provider_id");
    this.endpoint = requireText(config.endpoint, "endpoint");
    this.model = requireText(config.model, "model");
    this.apiKey =
      config.api_key === undefined || config.api_key === null
        ? null
        : requireText(config.api_key, "api_key");
    this.dimensions =
      config.dimensions === undefined || config.dimensions === null
        ? null
        : requirePositiveInteger(config.dimensions, "dimensions");
    this.timeoutMs =
      config.timeout_ms === undefined || config.timeout_ms === null
        ? 10_000
        : requirePositiveInteger(config.timeout_ms, "timeout_ms");
  }

  async embed(text: string): Promise<readonly number[]> {
    const headers: Record<string, string> = {
      "content-type": "application/json"
    };
    if (this.apiKey !== null) headers.authorization = `Bearer ${this.apiKey}`;
    const abortController = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let body: unknown;
    try {
      body = await Promise.race([
        this.requestEmbedding(
          requireText(text, "text"),
          headers,
          abortController.signal
        ),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => {
            abortController.abort();
            reject(
              new EmbeddingProviderError(
                `Embedding endpoint timed out after ${this.timeoutMs}ms`
              )
            );
          }, this.timeoutMs);
        })
      ]);
    } catch (error) {
      if (error instanceof EmbeddingProviderError) throw error;
      throw new EmbeddingProviderError("Embedding endpoint is unavailable", {
        cause: error
      });
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
    const embedding = readEmbedding(body);
    if (
      this.dimensions !== null &&
      embedding.length !== this.dimensions
    ) {
      throw new EmbeddingProviderError(
        `Embedding dimensions changed: expected ${this.dimensions}, received ${embedding.length}`
      );
    }
    return embedding;
  }

  private async requestEmbedding(
    text: string,
    headers: Record<string, string>,
    signal: AbortSignal
  ): Promise<unknown> {
    const response = await this.fetchImplementation(this.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: this.model,
        input: text,
        ...(this.dimensions === null ? {} : { dimensions: this.dimensions })
      }),
      signal
    });
    if (!response.ok) {
      throw new EmbeddingProviderError(
        `Embedding endpoint rejected the request with HTTP ${response.status}`
      );
    }
    try {
      return await response.json();
    } catch (error) {
      throw new EmbeddingProviderError(
        "Embedding endpoint returned invalid JSON",
        { cause: error }
      );
    }
  }
}

function readEmbedding(value: unknown): number[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new EmbeddingProviderError("Embedding response must be an object");
  }
  const data = (value as { data?: unknown }).data;
  if (!Array.isArray(data) || data.length === 0) {
    throw new EmbeddingProviderError("Embedding response contains no data");
  }
  const first = data[0];
  if (typeof first !== "object" || first === null || Array.isArray(first)) {
    throw new EmbeddingProviderError("Embedding response item must be an object");
  }
  const embedding = (first as { embedding?: unknown }).embedding;
  if (
    !Array.isArray(embedding) ||
    embedding.length === 0 ||
    embedding.some(
      (entry) => typeof entry !== "number" || !Number.isFinite(entry)
    )
  ) {
    throw new EmbeddingProviderError(
      "Embedding response must contain a non-empty finite number array"
    );
  }
  return embedding as number[];
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${field} must be a non-empty string`);
  }
  return value;
}

function requirePositiveInteger(value: unknown, field: string): number {
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new TypeError(`${field} must be a positive integer`);
  }
  return value as number;
}
