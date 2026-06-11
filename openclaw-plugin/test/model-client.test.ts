import { describe, expect, it } from "vitest";
import { ModelExtractionError } from "../../src/extraction/extraction-contracts.js";
import { EXTRACTION_SCHEMA_VERSION } from "../../src/extraction/proposal-validator.js";
import { readPartnerMemOpenClawConfig } from "../src/config.js";
import { createOpenClawExtractorModelClient } from "../src/model-client.js";

describe("OpenClaw extractor model client", () => {
  it("calls runEmbeddedAgent with a session file, disabled tools, JSON-only prompt, provider/model, timeout, and maxTokens", async () => {
    const calls: unknown[] = [];
    const api = fakeApi(async (input) => {
      calls.push(input);
      return {
        payloads: [
          {
            text: JSON.stringify({
              schema_version: EXTRACTION_SCHEMA_VERSION,
              raw_node_id: "raw-1",
              items: []
            })
          }
        ]
      };
    });
    const client = createOpenClawExtractorModelClient(
      api,
      readPartnerMemOpenClawConfig({
        extractor: {
          enabled: true,
          provider: "openai-codex",
          model: "gpt-test",
          allowedModels: ["openai-codex/gpt-test"],
          timeoutMs: 5000,
          maxTokens: 512
        }
      })
    );

    const proposal = await client.extractRawMessage({
      agent_id: "agent-1",
      raw_node_id: "raw-1",
      raw_text: "Project Quartz password is QZ-8842.",
      observed_at: "2026-06-01T00:00:00.000Z"
    });

    expect(proposal.schema_version).toBe(EXTRACTION_SCHEMA_VERSION);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      sessionFile: expect.any(String),
      disableTools: true,
      provider: "openai-codex",
      model: "gpt-test",
      timeoutMs: 5000,
      streamParams: { maxTokens: 512 }
    });
    expect((calls[0] as { sessionFile: string }).sessionFile).toMatch(/session\.json$/u);
    expect(JSON.stringify(calls[0])).toContain("Return ONLY valid JSON");
    expect(JSON.stringify(calls[0])).toContain("Do not wrap in markdown fences");
    expect(JSON.stringify(calls[0])).toContain("partner-mem.extraction.v1");
    expect(JSON.stringify(calls[0])).toContain("Project Quartz password is QZ-8842.");
  });

  it("throws model_invalid_json when runtime output is not JSON", async () => {
    const client = createOpenClawExtractorModelClient(
      fakeApi(async () => ({ payloads: [{ text: "not json" }] })),
      readPartnerMemOpenClawConfig({
        extractor: { enabled: true, provider: "openai-codex", model: "gpt-test" }
      })
    );

    await expect(
      client.extractRawMessage({
        agent_id: "agent-1",
        raw_node_id: "raw-1",
        raw_text: "raw",
        observed_at: null
      })
    ).rejects.toMatchObject({ reason: "model_invalid_json" satisfies ModelExtractionError["reason"] });
  });

  it("throws model_unavailable when runtime agent is missing or the model is not allowed", async () => {
    const config = readPartnerMemOpenClawConfig({
      extractor: {
        enabled: true,
        provider: "openai-codex",
        model: "gpt-test",
        allowedModels: ["openai-codex/other"]
      }
    });

    await expect(
      createOpenClawExtractorModelClient(fakeApi(undefined), config).extractRawMessage({
        agent_id: "agent-1",
        raw_node_id: "raw-1",
        raw_text: "raw",
        observed_at: null
      })
    ).rejects.toMatchObject({ reason: "model_unavailable" satisfies ModelExtractionError["reason"] });

    await expect(
      createOpenClawExtractorModelClient(fakeApi(async () => ({ payloads: [] })), config).extractRawMessage({
        agent_id: "agent-1",
        raw_node_id: "raw-1",
        raw_text: "raw",
        observed_at: null
      })
    ).rejects.toMatchObject({ reason: "model_unavailable" satisfies ModelExtractionError["reason"] });
  });
});

function fakeApi(runEmbeddedAgent?: (input: unknown) => Promise<unknown>) {
  return {
    runtime: runEmbeddedAgent ? { agent: { runEmbeddedAgent } } : {},
    config: { agents: { defaults: { model: "openai-codex/gpt-default" } } },
    resolvePath: (input: string) => input,
    registerService: () => undefined,
    registerTool: () => undefined,
    registerMemoryCapability: () => undefined,
    on: () => undefined,
    logger: {}
  };
}
