import { describe, expect, it } from "vitest";
import {
  DEFAULT_PARTNER_MEM_OPENCLAW_CONFIG,
  readPartnerMemOpenClawConfig
} from "../src/config.js";

describe("Partner-Mem OpenClaw extractor config", () => {
  it("defaults extractor to disabled with bounded queue and model call settings", () => {
    expect(readPartnerMemOpenClawConfig({}).extractor).toEqual(
      DEFAULT_PARTNER_MEM_OPENCLAW_CONFIG.extractor
    );
    expect(readPartnerMemOpenClawConfig({}).extractor.enabled).toBe(false);
  });

  it("accepts valid extractor overrides", () => {
    const config = readPartnerMemOpenClawConfig({
      extractor: {
        enabled: true,
        provider: "openai-codex",
        model: "gpt-test",
        allowedModels: ["openai-codex/gpt-test"],
        timeoutMs: 5000,
        maxTokens: 512,
        queueMaxItems: 20,
        onFailure: "skip"
      }
    });

    expect(config.extractor).toMatchObject({
      enabled: true,
      provider: "openai-codex",
      model: "gpt-test",
      allowedModels: ["openai-codex/gpt-test"],
      timeoutMs: 5000,
      maxTokens: 512,
      queueMaxItems: 20,
      onFailure: "skip"
    });
  });

  it("rejects invalid extractor numeric ranges, allowed models, and failure policies", () => {
    expect(() => readPartnerMemOpenClawConfig({ extractor: { timeoutMs: 999999 } })).toThrow(TypeError);
    expect(() => readPartnerMemOpenClawConfig({ extractor: { maxTokens: 12 } })).toThrow(TypeError);
    expect(() => readPartnerMemOpenClawConfig({ extractor: { queueMaxItems: 0 } })).toThrow(TypeError);
    expect(() => readPartnerMemOpenClawConfig({ extractor: { allowedModels: ["missing-slash"] } })).toThrow(TypeError);
    expect(() => readPartnerMemOpenClawConfig({ extractor: { onFailure: "retry" } })).toThrow(TypeError);
  });
});
