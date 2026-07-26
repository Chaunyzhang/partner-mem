import { describe, expect, it, vi } from "vitest";
import {
  EmbeddingProviderError
} from "../../src/embedding/embedding-provider.js";
import { OpenAICompatibleEmbeddingProvider } from "../../src/embedding/openai-compatible-provider.js";

describe("OpenAI-compatible embedding provider", () => {
  it("sends only configured provider inputs and validates dimensions", async () => {
    let capturedUrl: Parameters<typeof fetch>[0] | undefined;
    let capturedRequest: RequestInit | undefined;
    const fetchImplementation = vi.fn(
      async (
        input: Parameters<typeof fetch>[0],
        request?: RequestInit
      ) => {
        capturedUrl = input;
        capturedRequest = request;
        return new Response(
        JSON.stringify({ data: [{ embedding: [0.25, 0.75] }] }),
        { status: 200, headers: { "content-type": "application/json" } }
        );
      }
    );
    const provider = new OpenAICompatibleEmbeddingProvider(
      {
        provider_id: "deployment-a",
        endpoint: "https://embedding.example.test/v1/embeddings",
        api_key: "secret",
        model: "embedding-model",
        dimensions: 2
      },
      fetchImplementation
    );

    await expect(provider.embed("完整原文")).resolves.toEqual([0.25, 0.75]);
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    expect(capturedUrl).toBe("https://embedding.example.test/v1/embeddings");
    expect(capturedRequest?.headers).toMatchObject({
      authorization: "Bearer secret",
      "content-type": "application/json"
    });
    expect(JSON.parse(String(capturedRequest?.body))).toEqual({
      model: "embedding-model",
      input: "完整原文",
      dimensions: 2
    });
  });

  it("surfaces endpoint failures without fabricating a vector", async () => {
    const provider = new OpenAICompatibleEmbeddingProvider(
      {
        provider_id: "deployment-b",
        endpoint: "https://embedding.example.test/v1/embeddings",
        model: "embedding-model"
      },
      async () => new Response("unavailable", { status: 503 })
    );
    await expect(provider.embed("query")).rejects.toBeInstanceOf(
      EmbeddingProviderError
    );
  });

  it("bounds an embedding request even when fetch never settles", async () => {
    const stalledFetches: Array<typeof fetch> = [
      async () => new Promise<Response>(() => {}),
      async () =>
        ({
          ok: true,
          status: 200,
          json: async () => new Promise<unknown>(() => {})
        }) as Response
    ];
    for (const stalledFetch of stalledFetches) {
      const provider = new OpenAICompatibleEmbeddingProvider(
        {
          provider_id: "deployment-timeout",
          endpoint: "https://embedding.example.test/v1/embeddings",
          model: "embedding-model",
          timeout_ms: 5
        },
        stalledFetch
      );
      await expect(provider.embed("query")).rejects.toThrow(
        "Embedding endpoint timed out after 5ms"
      );
    }
  });
});
