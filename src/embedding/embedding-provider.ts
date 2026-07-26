export interface EmbeddingProvider {
  readonly provider_id: string;
  readonly model: string;
  embed(text: string): Promise<readonly number[]>;
}

export class EmbeddingProviderError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "EmbeddingProviderError";
  }
}
