import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PARTNER_MEM_OPENCLAW_CONFIG,
  createPartnerMemCoreConfig,
  readPartnerMemOpenClawConfig
} from "../src/config.js";
import { createPartnerMemOpenClawRuntime } from "../src/runtime.js";

describe("Partner-Mem OpenClaw runtime and config", () => {
  it("returns config defaults and accepts valid overrides without enabling summary auto-build", () => {
    expect(readPartnerMemOpenClawConfig({})).toEqual(DEFAULT_PARTNER_MEM_OPENCLAW_CONFIG);

    const config = readPartnerMemOpenClawConfig({
      dbPath: "/tmp/partner-mem-openclaw.db",
      autoCapture: false,
      autoRecall: false,
      contextBudgetTokens: 2000,
      recallLimit: 6,
      captureFlushMaxTokens: 30000,
      captureFlushMaxTurns: 12,
      captureMaxCharsPerMessage: 300000,
      auditRetentionMaxRows: 250,
      hookTimeoutMs: 500
    });
    const coreConfig = createPartnerMemCoreConfig(config);

    expect(DEFAULT_PARTNER_MEM_OPENCLAW_CONFIG.auditRetentionMaxRows).toBe(500);
    expect(config.autoCapture).toBe(false);
    expect(config.recallLimit).toBe(6);
    expect(config.captureFlushMaxTokens).toBe(30000);
    expect(config.captureFlushMaxTurns).toBe(12);
    expect(config.captureMaxCharsPerMessage).toBe(300000);
    expect(config.auditRetentionMaxRows).toBe(250);
    expect(coreConfig.context.autoRecallEnabled).toBe(true);
    expect(coreConfig.summary.autoBuildEnabled).toBe(false);
  });

  it("rejects invalid numeric config values", () => {
    expect(() => readPartnerMemOpenClawConfig({ hookTimeoutMs: 999999 })).toThrow(TypeError);
    expect(() => readPartnerMemOpenClawConfig({ captureFlushMaxTokens: 0 })).toThrow(TypeError);
    expect(() => readPartnerMemOpenClawConfig({ captureFlushMaxTurns: 101 })).toThrow(TypeError);
    expect(() => readPartnerMemOpenClawConfig({ captureMaxCharsPerMessage: 999 })).toThrow(TypeError);
    expect(() => readPartnerMemOpenClawConfig({ auditRetentionMaxRows: -1 })).toThrow(TypeError);
  });

  it("initializes an on-disk database and status does not expose the path", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "partner-mem-openclaw-"));
    const dbPath = join(tempDir, "runtime", "partner-mem.db");
    const runtime = createPartnerMemOpenClawRuntime(
      {
        resolvePath: (input) => input,
        registerService: () => undefined,
        registerTool: () => undefined,
        registerMemoryCapability: () => undefined,
        on: () => undefined,
        logger: {}
      },
      readPartnerMemOpenClawConfig({ dbPath })
    );

    try {
      const statusText = JSON.stringify(runtime.facade.partner_mem_status());

      expect(statusText).toContain("\"schema\":\"healthy\"");
      expect(statusText).not.toContain(dbPath);
      expect(statusText).not.toContain("dbPath");
      runtime.stop();
      expect(() => runtime.stop()).not.toThrow();
    } finally {
      runtime.stop();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("drains extraction queue only when extractor is enabled", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "partner-mem-openclaw-extractor-"));
    const dbPath = join(tempDir, "runtime", "partner-mem.db");
    const calls: unknown[] = [];
    const runtime = createPartnerMemOpenClawRuntime(
      {
        runtime: {
          agent: {
            async runEmbeddedAgent(input: unknown) {
              calls.push(input);
              const prompt = typeof input === "object" && input !== null && "prompt" in input
                ? String((input as { prompt: unknown }).prompt)
                : JSON.stringify(input);
              const rawNodeId = prompt.match(/"raw_node_id":\s*"([^"]+)"/u)?.[1] ?? "missing";
              return {
                payloads: [
                  {
                    text: JSON.stringify({
                      schema_version: "partner-mem.extraction.v1",
                      raw_node_id: rawNodeId,
                      items: []
                    })
                  }
                ]
              };
            }
          }
        },
        config: { agents: { defaults: { model: "openai-codex/gpt-test" } } },
        resolvePath: (input) => input,
        registerService: () => undefined,
        registerTool: () => undefined,
        registerMemoryCapability: () => undefined,
        on: () => undefined,
        logger: {}
      },
      readPartnerMemOpenClawConfig({
        dbPath,
        extractor: {
          enabled: true,
          provider: "openai-codex",
          model: "gpt-test"
        }
      })
    );

    try {
      const result = runtime.ingest.ingestTurn({
        agent_id: "agent-1",
        session_id: "session-1",
        turn_id: "turn-1",
        turn_index: 0,
        messages: [
          {
            role: "user",
            text: "Queue this raw memory.",
            observed_at: "2026-06-01T00:00:00.000Z",
            message_index: 0
          }
        ]
      });
      runtime.enqueueExtraction(result.raw_node_ids);
      await runtime.drainExtractionQueueForTests();

      expect(calls).toHaveLength(1);
    } finally {
      runtime.stop();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("does not call the model when extractor is disabled", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "partner-mem-openclaw-extractor-disabled-"));
    const dbPath = join(tempDir, "runtime", "partner-mem.db");
    const calls: unknown[] = [];
    const runtime = createPartnerMemOpenClawRuntime(
      {
        runtime: { agent: { async runEmbeddedAgent(input: unknown) { calls.push(input); return { payloads: [] }; } } },
        resolvePath: (input) => input,
        registerService: () => undefined,
        registerTool: () => undefined,
        registerMemoryCapability: () => undefined,
        on: () => undefined,
        logger: {}
      },
      readPartnerMemOpenClawConfig({ dbPath, extractor: { enabled: false } })
    );

    try {
      runtime.enqueueExtraction(["raw-1"]);
      await runtime.drainExtractionQueueForTests();

      expect(calls).toEqual([]);
    } finally {
      runtime.stop();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
