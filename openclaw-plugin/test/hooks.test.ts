import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readPartnerMemOpenClawConfig } from "../src/config.js";
import {
  captureAgentEnd,
  recallBeforePromptBuild,
  registerPartnerMemHooks
} from "../src/hooks.js";
import { createPartnerMemOpenClawRuntime } from "../src/runtime.js";

describe("Partner-Mem OpenClaw hooks", () => {
  it("registers only agent_end and before_prompt_build hooks with timeout", () => {
    const runtime = createTempRuntime();
    const registered: Array<{ name: string; opts: unknown }> = [];
    try {
      registerPartnerMemHooks(
        {
          on(name, _handler, opts) {
            registered.push({ name, opts });
          }
        },
        runtime
      );

      expect(registered.map((hook) => hook.name)).toEqual(["agent_end", "before_prompt_build"]);
      expect(registered.map((hook) => hook.opts)).toEqual([
        { timeoutMs: runtime.config.hookTimeoutMs },
        { timeoutMs: runtime.config.hookTimeoutMs }
      ]);
    } finally {
      cleanupRuntime(runtime);
    }
  });

  it("auto-captures unique user/assistant messages and does not duplicate the same event", () => {
    const runtime = createTempRuntime();
    try {
      const event = {
        runId: "run-1",
        success: true,
        messages: [
          { role: "user", content: "Partner-Mem hook capture exact user text." },
          { role: "assistant", content: "Partner-Mem hook capture exact assistant text." }
        ]
      };

      captureAgentEnd(event, { agentId: "agent-1", sessionKey: "session-1" }, runtime);
      captureAgentEnd(event, { agentId: "agent-1", sessionKey: "session-1" }, runtime);

      expect(
        runtime.facade
          .partner_mem_timeline({
            agent_id: "agent-1",
            session_id: "session-1",
            limit: 10
          })
          .evidence_items.map((item) => item.text)
      ).toEqual([
        "Partner-Mem hook capture exact user text.",
        "Partner-Mem hook capture exact assistant text."
      ]);
    } finally {
      cleanupRuntime(runtime);
    }
  });

  it("enqueues extraction after successful capture when extractor is enabled", async () => {
    const calls: unknown[] = [];
    const runtime = createTempRuntime({
      extractor: {
        enabled: true,
        provider: "openai-codex",
        model: "gpt-test"
      },
      apiRuntime: {
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
      apiConfig: { agents: { defaults: { model: "openai-codex/gpt-test" } } }
    });
    try {
      captureAgentEnd(
        {
          runId: "run-1",
          success: true,
          messages: [{ role: "user", content: "Extract this captured raw message." }]
        },
        { agentId: "agent-1", sessionKey: "session-1" },
        runtime
      );
      await runtime.drainExtractionQueueForTests();

      expect(calls).toHaveLength(1);
    } finally {
      cleanupRuntime(runtime);
    }
  });

  it("does not capture or extract Partner-Mem internal extraction runs", async () => {
    const calls: unknown[] = [];
    const runtime = createTempRuntime({
      extractor: {
        enabled: true,
        provider: "openai-codex",
        model: "gpt-test"
      },
      apiRuntime: {
        agent: {
          async runEmbeddedAgent(input: unknown) {
            calls.push(input);
            return { payloads: [] };
          }
        }
      }
    });
    try {
      captureAgentEnd(
        {
          runId: "partner-mem-extraction-123",
          success: true,
          messages: [
            {
              role: "user",
              content: "You are a JSON-only extraction function for Partner-Mem typed graph memory."
            },
            {
              role: "assistant",
              content: "{\"schema_version\":\"partner-mem.extraction.v1\",\"items\":[]}"
            }
          ]
        },
        { agentId: "agent-1", sessionKey: "partner-mem-extraction-123" },
        runtime
      );
      await runtime.drainExtractionQueueForTests();

      expect(
        runtime.facade.partner_mem_timeline({ agent_id: "agent-1", session_id: "partner-mem-extraction-123", limit: 10 })
          .evidence_items
      ).toEqual([]);
      expect(calls).toEqual([]);
    } finally {
      cleanupRuntime(runtime);
    }
  });

  it("does not enqueue extraction when disabled and before_prompt_build never calls the model", async () => {
    const calls: unknown[] = [];
    const runtime = createTempRuntime({
      apiRuntime: {
        agent: {
          async runEmbeddedAgent(input: unknown) {
            calls.push(input);
            return { payloads: [] };
          }
        }
      }
    });
    try {
      captureAgentEnd(
        {
          runId: "run-1",
          success: true,
          messages: [{ role: "user", content: "Capture without extraction." }]
        },
        { agentId: "agent-1", sessionKey: "session-1" },
        runtime
      );
      await runtime.drainExtractionQueueForTests();

      recallBeforePromptBuild(
        {
          prompt: "Capture",
          messages: [{ role: "user", content: "Capture" }]
        },
        { agentId: "agent-1", sessionKey: "session-1" },
        runtime
      );

      expect(calls).toEqual([]);
    } finally {
      cleanupRuntime(runtime);
    }
  });

  it("logs extraction failure without failing raw capture", async () => {
    const warnings: unknown[] = [];
    const runtime = createTempRuntime({
      logger: { warn: (_message: string, meta?: unknown) => warnings.push(meta) },
      extractor: {
        enabled: true,
        provider: "openai-codex",
        model: "gpt-test"
      },
      apiRuntime: {
        agent: {
          async runEmbeddedAgent() {
            return { payloads: [{ text: "not json" }] };
          }
        }
      }
    });
    try {
      captureAgentEnd(
        {
          runId: "run-1",
          success: true,
          messages: [{ role: "user", content: "Raw capture survives extraction failure." }]
        },
        { agentId: "agent-1", sessionKey: "session-1" },
        runtime
      );
      await runtime.drainExtractionQueueForTests();

      expect(
        runtime.facade.partner_mem_timeline({ agent_id: "agent-1", session_id: "session-1", limit: 10 })
          .evidence_items[0]?.text
      ).toBe("Raw capture survives extraction failure.");
      expect(warnings.length).toBeGreaterThan(0);
    } finally {
      cleanupRuntime(runtime);
    }
  });

  it("autoCapture false writes nothing", () => {
    const runtime = createTempRuntime({ autoCapture: false });
    try {
      captureAgentEnd(
        {
          runId: "run-1",
          success: true,
          messages: [{ role: "user", content: "should not be stored" }]
        },
        { agentId: "agent-1", sessionKey: "session-1" },
        runtime
      );

      expect(
        runtime.facade.partner_mem_timeline({ agent_id: "agent-1", session_id: "session-1", limit: 10 })
          .evidence_items
      ).toEqual([]);
    } finally {
      cleanupRuntime(runtime);
    }
  });

  it("auto-recalls exact raw evidence into appendContext and does not leak dbPath", () => {
    const runtime = createTempRuntime();
    try {
      captureAgentEnd(
        {
          runId: "run-1",
          success: true,
          messages: [{ role: "user", content: "Partner-Mem recall hook exact raw text." }]
        },
        { agentId: "agent-1", sessionKey: "session-1" },
        runtime
      );

      const result = recallBeforePromptBuild(
        {
          prompt: "Find recall hook",
          messages: [{ role: "user", content: "recall hook" }]
        },
        { agentId: "agent-1", sessionKey: "session-1" },
        runtime
      );

      expect(result?.appendContext).toContain("Partner-Mem recall hook exact raw text.");
      expect(result?.appendContext).not.toContain(runtime.__dbPath);
      expect(result?.appendContext).not.toContain("candidate route as fact");
      expect(result?.appendContext).not.toContain("fake summary proof");
      expect(result).not.toHaveProperty("prependContext");
      expect(result).not.toHaveProperty("systemPrompt");
    } finally {
      cleanupRuntime(runtime);
    }
  });

  it("keeps the base prompt prefix stable when dynamic memory changes", () => {
    const runtime = createTempRuntime();
    try {
      captureAgentEnd(
        {
          runId: "run-1",
          success: true,
          messages: [{ role: "user", content: "alpha cache evidence" }]
        },
        { agentId: "agent-1", sessionKey: "session-1" },
        runtime
      );
      captureAgentEnd(
        {
          runId: "run-2",
          success: true,
          messages: [{ role: "user", content: "beta cache evidence" }]
        },
        { agentId: "agent-1", sessionKey: "session-1" },
        runtime
      );

      const first = recallBeforePromptBuild(
        {
          prompt: "alpha",
          messages: [{ role: "user", content: "alpha" }]
        },
        { agentId: "agent-1", sessionKey: "session-1" },
        runtime
      );
      const second = recallBeforePromptBuild(
        {
          prompt: "beta",
          messages: [{ role: "user", content: "beta" }]
        },
        { agentId: "agent-1", sessionKey: "session-1" },
        runtime
      );
      const basePrompt = "system instructions\n\nstable conversation history";

      expect(first?.appendContext).toContain("alpha cache evidence");
      expect(second?.appendContext).toContain("beta cache evidence");
      expect(first?.appendContext).not.toBe(second?.appendContext);
      expect(first).not.toHaveProperty("prependContext");
      expect(second).not.toHaveProperty("prependContext");
      expect(applyHookContext(basePrompt, first)).toMatch(new RegExp(`^${escapeRegExp(basePrompt)}`));
      expect(applyHookContext(basePrompt, second)).toMatch(new RegExp(`^${escapeRegExp(basePrompt)}`));
    } finally {
      cleanupRuntime(runtime);
    }
  });

  it("does not inject recall context into Partner-Mem internal extraction prompts", () => {
    const runtime = createTempRuntime();
    try {
      captureAgentEnd(
        {
          runId: "run-1",
          success: true,
          messages: [{ role: "user", content: "Visible memory that must not enter extraction prompt." }]
        },
        { agentId: "agent-1", sessionKey: "session-1" },
        runtime
      );

      expect(
        recallBeforePromptBuild(
          {
            runId: "partner-mem-extraction-456",
            prompt: "You are a JSON-only extraction function for Partner-Mem typed graph memory.",
            messages: [
              {
                role: "user",
                content: "You are a JSON-only extraction function for Partner-Mem typed graph memory."
              }
            ]
          },
          { agentId: "agent-1", sessionKey: "partner-mem-extraction-456" },
          runtime
        )
      ).toBeUndefined();
    } finally {
      cleanupRuntime(runtime);
    }
  });

  it("auto-recalls exact raw evidence across OpenClaw sessions", () => {
    const runtime = createTempRuntime();
    try {
      captureAgentEnd(
        {
          runId: "run-1",
          success: true,
          messages: [{ role: "user", content: "密码：柚子茶8842" }]
        },
        { agentId: "agent-1", sessionKey: "old-session" },
        runtime
      );

      const result = recallBeforePromptBuild(
        {
          prompt: "我的密码是什么",
          messages: [{ role: "user", content: "我的密码是什么" }]
        },
        { agentId: "agent-1", sessionKey: "new-session" },
        runtime
      );

      expect(result?.appendContext).toContain("Partner-Mem verified raw evidence:\n- user: 密码：柚子茶8842");
      expect(result).not.toHaveProperty("prependContext");
    } finally {
      cleanupRuntime(runtime);
    }
  });

  it("autoRecall false injects nothing", () => {
    const runtime = createTempRuntime({ autoRecall: false });
    try {
      expect(
        recallBeforePromptBuild(
          {
            prompt: "anything",
            messages: [{ role: "user", content: "anything" }]
          },
          { agentId: "agent-1", sessionKey: "session-1" },
          runtime
        )
      ).toBeUndefined();
    } finally {
      cleanupRuntime(runtime);
    }
  });

  it("failed capture logs and does not throw", () => {
    const warnings: unknown[] = [];
    const runtime = createTempRuntime({ logger: { warn: (_message: string, meta?: unknown) => warnings.push(meta) } });
    const originalIngest = runtime.ingest.ingestTurn;
    runtime.ingest.ingestTurn = () => {
      throw new Error("capture failed");
    };

    try {
      expect(() =>
        captureAgentEnd(
          {
            runId: "run-1",
            success: true,
            messages: [{ role: "user", content: "capture failure input" }]
          },
          { agentId: "agent-1", sessionKey: "session-1" },
          runtime
        )
      ).not.toThrow();
      expect(warnings.length).toBeGreaterThan(0);
    } finally {
      runtime.ingest.ingestTurn = originalIngest;
      cleanupRuntime(runtime);
    }
  });

  it("skips a long message instead of slicing it", () => {
    const runtime = createTempRuntime({ captureMaxCharsPerTurn: 1000 });
    const longText = "x".repeat(1001);
    try {
      captureAgentEnd(
        {
          runId: "run-1",
          success: true,
          messages: [{ role: "user", content: longText }]
        },
        { agentId: "agent-1", sessionKey: "session-1" },
        runtime
      );

      expect(
        runtime.facade.partner_mem_timeline({ agent_id: "agent-1", session_id: "session-1", limit: 10 })
          .evidence_items
      ).toEqual([]);
    } finally {
      cleanupRuntime(runtime);
    }
  });

  it("hook source does not import storage owners or direct SQLite", () => {
    const source = readFileSync(new URL("../src/hooks.ts", import.meta.url), "utf8");

    expect(source).not.toMatch(/GraphStore|DatabaseSync|@photostructure\/sqlite|db\.prepare|db\.exec/u);
  });
});

function createTempRuntime(
  overrides: Record<string, unknown> & {
    logger?: { warn?: (message: string, meta?: unknown) => void };
    apiRuntime?: unknown;
    apiConfig?: unknown;
  } = {}
) {
  const tempDir = mkdtempSync(join(tmpdir(), "partner-mem-openclaw-hooks-"));
  const dbPath = join(tempDir, "partner-mem.db");
  const { apiRuntime, apiConfig, logger, ...configOverrides } = overrides;
  const runtime = createPartnerMemOpenClawRuntime(
    {
      runtime: apiRuntime,
      config: apiConfig,
      resolvePath: (input) => input,
      registerService: () => undefined,
      registerTool: () => undefined,
      registerMemoryCapability: () => undefined,
      on: () => undefined,
      logger: logger ?? {}
    },
    readPartnerMemOpenClawConfig({ ...configOverrides, dbPath })
  );
  return Object.assign(runtime, { __tempDir: tempDir, __dbPath: dbPath });
}

function cleanupRuntime(runtime: ReturnType<typeof createTempRuntime>): void {
  runtime.stop();
  rmSync(runtime.__tempDir, { recursive: true, force: true });
}

function applyHookContext(basePrompt: string, hookResult: { appendContext?: string } | undefined): string {
  return hookResult?.appendContext ? `${basePrompt}\n\n${hookResult.appendContext}` : basePrompt;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
