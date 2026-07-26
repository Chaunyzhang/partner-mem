import {
  OpenAICompatibleEmbeddingProvider,
  type OpenAICompatibleEmbeddingConfig
} from "../embedding/openai-compatible-provider.js";
import type { EmbeddingProvider } from "../embedding/embedding-provider.js";

export interface EmbeddingEnvironment {
  PARTNER_MEM_EMBEDDING_PROVIDER_ID?: string | undefined;
  PARTNER_MEM_EMBEDDING_ENDPOINT?: string | undefined;
  PARTNER_MEM_EMBEDDING_API_KEY?: string | undefined;
  PARTNER_MEM_EMBEDDING_MODEL?: string | undefined;
  PARTNER_MEM_EMBEDDING_DIMENSIONS?: string | undefined;
  PARTNER_MEM_EMBEDDING_TIMEOUT_MS?: string | undefined;
}

export function embeddingProviderFromEnvironment(
  environment: EmbeddingEnvironment
): EmbeddingProvider | null {
  const endpoint = optionalTrimmed(
    environment.PARTNER_MEM_EMBEDDING_ENDPOINT
  );
  const model = optionalTrimmed(environment.PARTNER_MEM_EMBEDDING_MODEL);
  if (endpoint === undefined && model === undefined) return null;
  if (endpoint === undefined || model === undefined) {
    throw new TypeError(
      "PARTNER_MEM_EMBEDDING_ENDPOINT and PARTNER_MEM_EMBEDDING_MODEL must be configured together"
    );
  }

  const config: OpenAICompatibleEmbeddingConfig = {
    provider_id:
      optionalTrimmed(environment.PARTNER_MEM_EMBEDDING_PROVIDER_ID) ??
      "openai-compatible",
    endpoint,
    model
  };
  const apiKey = optionalTrimmed(environment.PARTNER_MEM_EMBEDDING_API_KEY);
  if (apiKey !== undefined) config.api_key = apiKey;
  const dimensions = optionalPositiveInteger(
    environment.PARTNER_MEM_EMBEDDING_DIMENSIONS,
    "PARTNER_MEM_EMBEDDING_DIMENSIONS"
  );
  if (dimensions !== undefined) config.dimensions = dimensions;
  const timeout = optionalPositiveInteger(
    environment.PARTNER_MEM_EMBEDDING_TIMEOUT_MS,
    "PARTNER_MEM_EMBEDDING_TIMEOUT_MS"
  );
  if (timeout !== undefined) config.timeout_ms = timeout;
  return new OpenAICompatibleEmbeddingProvider(config);
}

function optionalTrimmed(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}

function optionalPositiveInteger(
  value: string | undefined,
  field: string
): number | undefined {
  const trimmed = optionalTrimmed(value);
  if (trimmed === undefined) return undefined;
  if (!/^[1-9]\d*$/.test(trimmed)) {
    throw new TypeError(`${field} must be a positive integer`);
  }
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed)) {
    throw new TypeError(`${field} must be a positive safe integer`);
  }
  return parsed;
}
