import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import {
  EXTRACTION_PROMPT_VERSION,
  EXTRACTION_SCHEMA_VERSION,
  ModelExtractionError,
  type ExtractRawMessageInput,
  type ExtractorModelClient,
  type MemoryExtractionProposal
} from "../../src/extraction/extraction-contracts.js";
import type { PartnerMemOpenClawConfig } from "./config.js";

interface EmbeddedAgentRuntime {
  runEmbeddedAgent(input: EmbeddedAgentInput): Promise<unknown>;
}

interface EmbeddedAgentInput {
  sessionId: string;
  sessionFile: string;
  workspaceDir: string;
  config?: unknown;
  prompt: string;
  timeoutMs: number;
  runId: string;
  provider: string;
  model: string;
  streamParams: {
    maxTokens: number;
  };
  disableTools: true;
}

export function createOpenClawExtractorModelClient(
  api: OpenClawPluginApi,
  config: PartnerMemOpenClawConfig
): ExtractorModelClient {
  return {
    async extractRawMessage(input: ExtractRawMessageInput): Promise<MemoryExtractionProposal> {
      const agent = getEmbeddedAgentRuntime(api.runtime);
      if (!agent) {
        throw new ModelExtractionError("model_unavailable", "OpenClaw runtime agent API is unavailable");
      }

      const modelRef = resolveModelRef(api, config);
      const modelKey = `${modelRef.provider}/${modelRef.model}`;
      if (config.extractor.allowedModels.length > 0 && !config.extractor.allowedModels.includes(modelKey)) {
        throw new ModelExtractionError("model_unavailable", `Extractor model is not allowed: ${modelKey}`);
      }

      const prompt = buildExtractionPrompt(input);
      const extractionId = `partner-mem-extraction-${Date.now()}`;
      const tempDir = await mkdtemp(join(tmpdir(), "partner-mem-openclaw-extraction-"));
      let result: unknown;
      try {
        result = await agent.runEmbeddedAgent({
          sessionId: extractionId,
          sessionFile: join(tempDir, "session.json"),
          workspaceDir: process.cwd(),
          config: api.config,
          prompt,
          timeoutMs: config.extractor.timeoutMs,
          runId: extractionId,
          provider: modelRef.provider,
          model: modelRef.model,
          streamParams: {
            maxTokens: config.extractor.maxTokens
          },
          disableTools: true
        });
      } finally {
        await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
      }

      const text = collectText(result);
      if (!text) {
        throw new ModelExtractionError("model_invalid_json", "OpenClaw extractor model returned empty output");
      }

      try {
        return JSON.parse(text) as MemoryExtractionProposal;
      } catch {
        throw new ModelExtractionError("model_invalid_json", "OpenClaw extractor model returned invalid JSON");
      }
    }
  };
}

function buildExtractionPrompt(input: ExtractRawMessageInput): string {
  const inputJson = JSON.stringify(
    {
      schema_version: EXTRACTION_SCHEMA_VERSION,
      raw_node_id: input.raw_node_id,
      agent_id: input.agent_id,
      observed_at: input.observed_at,
      raw_text: input.raw_text
    },
    null,
    2
  );

  return [
    "You are a JSON-only extraction function for Partner-Mem typed graph memory.",
    "Return ONLY valid JSON.",
    "Do not wrap in markdown fences.",
    "Do not include commentary.",
    "Do not call tools.",
    "Extract only from the supplied raw message text.",
    `The top-level schema_version must be "${EXTRACTION_SCHEMA_VERSION}".`,
    "The top-level raw_node_id must exactly match the supplied raw_node_id.",
    "Return items: [] when there is no durable memory.",
    "Allowed node_type values are entity, event, task, and decision.",
    "Every item evidence_text must be an exact substring copied from raw_text.",
    "Every attribute must include key, value, and evidence_text copied from raw_text.",
    "Use temporal only when raw_text contains explicit time text; do not infer dates from current time or outside context.",
    "Do not summarize the raw message.",
    `Prompt contract version: ${EXTRACTION_PROMPT_VERSION}.`,
    "",
    "Required JSON shape:",
    JSON.stringify(
      {
        schema_version: EXTRACTION_SCHEMA_VERSION,
        raw_node_id: "<raw node id>",
        items: [
          {
            provisional_id: "item-1",
            node_type: "entity|event|task|decision",
            label: "short searchable label",
            text: "one grounded sentence",
            evidence_text: "exact substring copied from raw message",
            attributes: [{ key: "snake_case_key", value: "exact concrete value", evidence_text: "exact substring" }],
            temporal: { source_text: null, valid_from: null, valid_to: null, granularity: "none" },
            confidence: 0.8
          }
        ]
      },
      null,
      2
    ),
    "",
    "INPUT_JSON:",
    inputJson
  ].join("\n");
}

function getEmbeddedAgentRuntime(runtime: unknown): EmbeddedAgentRuntime | undefined {
  if (!isRecord(runtime)) return undefined;
  const agent = runtime.agent;
  if (!isRecord(agent) || typeof agent.runEmbeddedAgent !== "function") return undefined;
  const runEmbeddedAgent = agent.runEmbeddedAgent.bind(agent) as EmbeddedAgentRuntime["runEmbeddedAgent"];
  return { runEmbeddedAgent };
}

function resolveModelRef(
  api: Pick<OpenClawPluginApi, "config">,
  config: PartnerMemOpenClawConfig
): { provider: string; model: string } {
  const configuredProvider = config.extractor.provider;
  const configuredModel = config.extractor.model;
  const defaultModel = readDefaultModel(api.config);
  let provider = configuredProvider;
  let model = configuredModel;

  if (!model && defaultModel) {
    model = defaultModel.model;
  }
  if (!provider && defaultModel) {
    provider = defaultModel.provider;
  }
  if (!provider && model?.includes("/")) {
    const split = splitModelKey(model);
    provider = split?.provider;
    model = split?.model;
  }
  if (provider && model?.startsWith(`${provider}/`)) {
    model = model.slice(provider.length + 1);
  }

  if (!provider || !model) {
    throw new ModelExtractionError("model_unavailable", "Extractor provider/model could not be resolved");
  }
  return { provider, model };
}

function readDefaultModel(config: unknown): { provider: string; model: string } | undefined {
  if (!isRecord(config)) return undefined;
  const agents = config.agents;
  if (!isRecord(agents)) return undefined;
  const defaults = agents.defaults;
  if (!isRecord(defaults)) return undefined;
  const rawModel = defaults.model;
  if (typeof rawModel === "string") return splitModelKey(rawModel);
  if (isRecord(rawModel) && typeof rawModel.primary === "string") return splitModelKey(rawModel.primary);
  return undefined;
}

function splitModelKey(value: string): { provider: string; model: string } | undefined {
  const trimmed = value.trim();
  const slash = trimmed.indexOf("/");
  if (slash <= 0 || slash === trimmed.length - 1) return undefined;
  return { provider: trimmed.slice(0, slash), model: trimmed.slice(slash + 1) };
}

function collectText(result: unknown): string {
  if (!isRecord(result) || !Array.isArray(result.payloads)) return "";
  return result.payloads
    .filter((payload) => isRecord(payload) && payload.isError !== true && typeof payload.text === "string")
    .map((payload) => (payload as { text: string }).text)
    .join("\n")
    .trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
