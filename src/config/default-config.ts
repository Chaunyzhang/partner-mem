export interface PartnerMemConfig {
  context: {
    enabled: boolean;
    maxTokens: number;
    recentTurns: number;
    recentMessages: number;
    autoRecallEnabled: boolean;
    autoRecallMaxQueries: number;
    evidenceMaxItems: number;
    evidenceMaxTokens: number;
    includePathExplanations: boolean;
    candidatePreviewEnabled: boolean;
  };
  summary: {
    schemaEnabled: boolean;
    resolverEnabled: boolean;
    autoBuildEnabled: boolean;
    mode: "manual";
    provider: "none";
  };
}

export function getDefaultConfig(): PartnerMemConfig {
  return {
    context: {
      enabled: true,
      maxTokens: 1200,
      recentTurns: 3,
      recentMessages: 8,
      autoRecallEnabled: false,
      autoRecallMaxQueries: 1,
      evidenceMaxItems: 4,
      evidenceMaxTokens: 800,
      includePathExplanations: true,
      candidatePreviewEnabled: false
    },
    summary: {
      schemaEnabled: true,
      resolverEnabled: true,
      autoBuildEnabled: false,
      mode: "manual",
      provider: "none"
    }
  };
}
