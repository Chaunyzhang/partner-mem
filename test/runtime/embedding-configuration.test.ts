import { describe, expect, it } from "vitest";
import { embeddingProviderFromEnvironment } from "../../src/runtime/embedding-configuration.js";

describe("embedding runtime configuration", () => {
  it("leaves vector retrieval explicitly unavailable when no endpoint is configured", () => {
    expect(embeddingProviderFromEnvironment({})).toBeNull();
  });

  it("constructs an OpenAI-compatible provider from deployment-only environment", () => {
    const provider = embeddingProviderFromEnvironment({
      PARTNER_MEM_EMBEDDING_ENDPOINT: "https://embedding.example/v1/embeddings",
      PARTNER_MEM_EMBEDDING_MODEL: "example-embedding",
      PARTNER_MEM_EMBEDDING_PROVIDER_ID: "example",
      PARTNER_MEM_EMBEDDING_DIMENSIONS: "128",
      PARTNER_MEM_EMBEDDING_TIMEOUT_MS: "2500"
    });
    expect(provider).toMatchObject({
      provider_id: "example",
      model: "example-embedding"
    });
  });

  it("rejects partial or non-positive configuration instead of guessing", () => {
    expect(() =>
      embeddingProviderFromEnvironment({
        PARTNER_MEM_EMBEDDING_ENDPOINT: "https://embedding.example"
      })
    ).toThrow(/configured together/);
    expect(() =>
      embeddingProviderFromEnvironment({
        PARTNER_MEM_EMBEDDING_ENDPOINT: "https://embedding.example",
        PARTNER_MEM_EMBEDDING_MODEL: "model",
        PARTNER_MEM_EMBEDDING_DIMENSIONS: "0"
      })
    ).toThrow(/positive integer/);
  });
});
