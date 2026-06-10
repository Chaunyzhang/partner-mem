import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "@photostructure/sqlite";
import { describe, expect, it } from "vitest";
import { readPartnerMemOpenClawConfig } from "../src/config.js";
import type { SqliteDatabase } from "../../src/storage/schema.js";
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
          { role: "user", content: "Partner-Mem hook capture exact user text.", message_index: 0 },
          { role: "assistant", content: "Partner-Mem hook capture exact assistant text.", message_index: 1 }
        ]
      };

      captureAgentEnd(event, mainCtx("session-1"), runtime);
      captureAgentEnd(event, mainCtx("session-1"), runtime);

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

  it("skips capture without writing default-agent memory when trusted identity is missing", () => {
    const warnings: unknown[] = [];
    const runtime = createTempRuntime({
      autoRecall: true,
      logger: { warn: (_message: string, meta?: unknown) => warnings.push(meta) }
    });
    try {
      captureAgentEnd(
        {
          runId: "run-1",
          success: true,
          messages: [
            { role: "user", content: "missing identity user text", message_index: 0 },
            { role: "assistant", content: "missing identity assistant text", message_index: 1 }
          ]
        },
        {},
        runtime
      );

      expect(countRuntimeRows(runtime, "memory_nodes")).toBe(0);
      expect(countRuntimeRows(runtime, "raw_payloads")).toBe(0);
      expect(warnings.length).toBeGreaterThan(0);
      expect(JSON.stringify(warnings)).toContain("trusted OpenClaw identity");
    } finally {
      cleanupRuntime(runtime);
    }
  });

  it("filters channel conversation metadata before buffering captured turns", () => {
    const runtime = createTempRuntime({ autoRecall: true });
    const originalIngest = runtime.ingest.ingestTurn;
    const calls: Parameters<typeof runtime.ingest.ingestTurn>[0][] = [];
    runtime.ingest.ingestTurn = (input) => {
      calls.push(input);
      return originalIngest.call(runtime.ingest, input);
    };

    try {
      captureAgentEnd(
        {
          runId: "run-1",
          success: true,
          messages: [
            {
              role: "user",
              content:
                'Conversation info (untrusted metadata): { "chat_id": "chat-1", "message_id": "msg-1" }',
              message_index: 0
            },
            { role: "user", content: "feishu visible user message", message_index: 1 },
            { role: "assistant", content: "feishu visible assistant reply", message_index: 2 }
          ]
        },
        mainCtx("session-1"),
        runtime
      );

      expect(calls.map((call) => call.messages.map((message) => message.text))).toEqual([
        ["feishu visible user message", "feishu visible assistant reply"]
      ]);
      expect(timelineTexts(runtime, "agent-1", "session-1")).toEqual([
        "feishu visible user message",
        "feishu visible assistant reply"
      ]);
    } finally {
      runtime.ingest.ingestTurn = originalIngest;
      cleanupRuntime(runtime);
    }
  });

  it("uses message_index cursor instead of runId when OpenClaw emits overlapping full history", () => {
    const runtime = createTempRuntime();
    try {
      captureAgentEnd(
        {
          runId: "run-1",
          success: true,
          messages: [
            { role: "user", content: "cursor first user", message_index: 0 },
            { role: "assistant", content: "cursor first assistant", message_index: 1 }
          ]
        },
        mainCtx("session-1"),
        runtime
      );
      captureAgentEnd(
        {
          runId: "run-2",
          success: true,
          messages: [
            { role: "user", content: "cursor first user", message_index: 0 },
            { role: "assistant", content: "cursor first assistant", message_index: 1 },
            { role: "user", content: "cursor second user", message_index: 2 },
            { role: "assistant", content: "cursor second assistant", message_index: 3 }
          ]
        },
        mainCtx("session-1"),
        runtime
      );

      expect(timelineTexts(runtime, "agent-1", "session-1")).toEqual([
        "cursor first user",
        "cursor first assistant",
        "cursor second user",
        "cursor second assistant"
      ]);
    } finally {
      cleanupRuntime(runtime);
    }
  });

  it("buffers complete turns until captureFlushMaxTurns is reached", () => {
    const runtime = createTempRuntime({ captureFlushMaxTurns: 2 });
    try {
      captureAgentEnd(
        {
          runId: "run-1",
          success: true,
          messages: [
            { role: "user", content: "first buffered user", message_index: 0 },
            { role: "assistant", content: "first buffered assistant", message_index: 1 }
          ]
        },
        mainCtx("session-1"),
        runtime
      );

      expect(timelineTexts(runtime, "agent-1", "session-1")).toEqual([]);

      captureAgentEnd(
        {
          runId: "run-2",
          success: true,
          messages: [
            { role: "user", content: "first buffered user", message_index: 0 },
            { role: "assistant", content: "first buffered assistant", message_index: 1 },
            { role: "user", content: "second buffered user", message_index: 2 },
            { role: "assistant", content: "second buffered assistant", message_index: 3 }
          ]
        },
        mainCtx("session-1"),
        runtime
      );

      expect(timelineTexts(runtime, "agent-1", "session-1")).toEqual([
        "first buffered user",
        "first buffered assistant",
        "second buffered user",
        "second buffered assistant"
      ]);
    } finally {
      cleanupRuntime(runtime);
    }
  });

  it("does not flush a single large complete turn before the two-turn threshold", () => {
    const runtime = createTempRuntime({ captureFlushMaxTurns: 2 });
    try {
      captureAgentEnd(
        {
          runId: "run-1",
          success: true,
          messages: [
            { role: "user", content: "long token threshold user", message_index: 0 },
            { role: "assistant", content: "long token threshold assistant", message_index: 1 }
          ]
        },
        mainCtx("session-1"),
        runtime
      );

      expect(timelineTexts(runtime, "agent-1", "session-1")).toEqual([]);
    } finally {
      cleanupRuntime(runtime);
    }
  });

  it("captures a user-only turn once it reaches the two user-anchored turn threshold", () => {
    const runtime = createTempRuntime({ captureFlushMaxTurns: 2 });
    try {
      captureAgentEnd(
        {
          runId: "run-1",
          success: true,
          messages: [{ role: "user", content: "pending user only", message_index: 0 }]
        },
        mainCtx("session-1"),
        runtime
      );

      expect(timelineTexts(runtime, "agent-1", "session-1")).toEqual([]);

      captureAgentEnd(
        {
          runId: "run-2",
          success: true,
          messages: [
            { role: "user", content: "pending user only", message_index: 0 },
            { role: "user", content: "second user anchor", message_index: 1 }
          ]
        },
        mainCtx("session-1"),
        runtime
      );

      expect(timelineTexts(runtime, "agent-1", "session-1")).toEqual([
        "pending user only",
        "second user anchor"
      ]);
    } finally {
      cleanupRuntime(runtime);
    }
  });

  it("keeps multiple assistant replies inside the preceding user-anchored turn", () => {
    const runtime = createTempRuntime({ captureFlushMaxTurns: 2 });
    const originalIngest = runtime.ingest.ingestTurn;
    const calls: Parameters<typeof runtime.ingest.ingestTurn>[0][] = [];
    runtime.ingest.ingestTurn = (input) => {
      calls.push(input);
      return originalIngest.call(runtime.ingest, input);
    };

    try {
      captureAgentEnd(
        {
          runId: "run-1",
          success: true,
          messages: [
            { role: "user", content: "anchor one user", message_index: 0 },
            { role: "assistant", content: "anchor one assistant 1", message_index: 1 },
            { role: "assistant", content: "anchor one assistant 2", message_index: 2 },
            { role: "assistant", content: "anchor one assistant 3", message_index: 3 },
            { role: "user", content: "anchor two user", message_index: 4 }
          ]
        },
        mainCtx("session-1"),
        runtime
      );

      expect(calls.map((call) => call.messages.map((message) => message.text))).toEqual([
        [
          "anchor one user",
          "anchor one assistant 1",
          "anchor one assistant 2",
          "anchor one assistant 3"
        ],
        ["anchor two user"]
      ]);
    } finally {
      runtime.ingest.ingestTurn = originalIngest;
      cleanupRuntime(runtime);
    }
  });

  it("persists neighboring Q/A rounds as separate RawTurnInput calls", () => {
    const runtime = createTempRuntime({ captureFlushMaxTurns: 2 });
    const originalIngest = runtime.ingest.ingestTurn;
    const calls: Parameters<typeof runtime.ingest.ingestTurn>[0][] = [];
    runtime.ingest.ingestTurn = (input) => {
      calls.push(input);
      return originalIngest.call(runtime.ingest, input);
    };

    try {
      captureAgentEnd(
        {
          runId: "run-1",
          success: true,
          messages: [
            { role: "user", content: "round one user", message_index: 0 },
            { role: "assistant", content: "round one assistant", message_index: 1 },
            { role: "user", content: "round two user", message_index: 2 },
            { role: "assistant", content: "round two assistant", message_index: 3 }
          ]
        },
        mainCtx("session-1"),
        runtime
      );

      expect(calls).toHaveLength(2);
      expect(calls.map((call) => call.messages.map((message) => message.text))).toEqual([
        ["round one user", "round one assistant"],
        ["round two user", "round two assistant"]
      ]);
      expect(new Set(calls.map((call) => call.turn_id)).size).toBe(2);
    } finally {
      runtime.ingest.ingestTurn = originalIngest;
      cleanupRuntime(runtime);
    }
  });

  it("prunes audit logs after successful capture flush without deleting memory or FTS rows", () => {
    const runtime = createTempRuntime({ auditRetentionMaxRows: 2 });
    try {
      captureAgentEnd(
        {
          runId: "run-1",
          success: true,
          messages: [
            { role: "user", content: "audit cleanup searchable user", message_index: 0 },
            { role: "assistant", content: "audit cleanup searchable assistant", message_index: 1 }
          ]
        },
        mainCtx("session-1"),
        runtime
      );

      for (let index = 0; index < 4; index += 1) {
        runtime.facade.partner_mem_search({
          query: "audit cleanup searchable",
          agent_id: "agent-1",
          session_id: "session-1",
          limit: 10
        });
        runtime.facade.partner_mem_recall({
          query: "audit cleanup searchable",
          agent_id: "agent-1",
          session_id: "session-1",
          limit: 10
        });
      }

      expect(countRuntimeRows(runtime, "retrieval_runs")).toBeGreaterThan(2);
      expect(countRuntimeRows(runtime, "evidence_packets")).toBeGreaterThan(2);

      captureAgentEnd(
        {
          runId: "run-2",
          success: true,
          messages: [
            { role: "user", content: "audit cleanup second user", message_index: 2 },
            { role: "assistant", content: "audit cleanup second assistant", message_index: 3 }
          ]
        },
        mainCtx("session-1"),
        runtime
      );

      expect(countRuntimeRows(runtime, "retrieval_runs")).toBe(2);
      expect(countRuntimeRows(runtime, "evidence_packets")).toBe(2);
      expect(countRuntimeRows(runtime, "memory_nodes")).toBe(4);
      expect(countRuntimeRows(runtime, "raw_payloads")).toBe(4);
      expect(countRuntimeRows(runtime, "node_fts")).toBe(4);
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
          messages: [
            { role: "user", content: "Extract this captured raw message.", message_index: 0 },
            { role: "assistant", content: "Extraction queue assistant reply.", message_index: 1 }
          ]
        },
        mainCtx("session-1"),
        runtime
      );
      await runtime.drainExtractionQueueForTests();

      expect(calls).toHaveLength(2);
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
        mainCtx("partner-mem-extraction-123"),
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

  it("does not capture explicit subagent or embedded conversations", () => {
    const runtime = createTempRuntime({ captureFlushMaxTurns: 1 });
    try {
      captureAgentEnd(
        {
          runId: "subagent-run-1",
          conversationKind: "subagent",
          success: true,
          messages: [
            { role: "user", content: "subagent should not persist user", message_index: 0 },
            { role: "assistant", content: "subagent should not persist assistant", message_index: 1 }
          ]
        },
        { agentId: "agent-1", sessionKey: "subagent-session", conversationKind: "subagent" },
        runtime
      );
      captureAgentEnd(
        {
          runId: "embedded-run-1",
          success: true,
          messages: [
            { role: "user", content: "embedded should not persist user", message_index: 0 },
            { role: "assistant", content: "embedded should not persist assistant", message_index: 1 }
          ]
        },
        { agentId: "agent-1", sessionKey: "embedded-session", isEmbedded: true },
        runtime
      );

      expect(timelineTexts(runtime, "agent-1", "subagent-session")).toEqual([]);
      expect(timelineTexts(runtime, "agent-1", "embedded-session")).toEqual([]);
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
          messages: [
            { role: "user", content: "Capture without extraction.", message_index: 0 },
            { role: "assistant", content: "Capture without extraction reply.", message_index: 1 }
          ]
        },
        mainCtx("session-1"),
        runtime
      );
      await runtime.drainExtractionQueueForTests();

      recallBeforePromptBuild(
        {
          prompt: "Capture",
          messages: [{ role: "user", content: "Capture" }]
        },
        mainCtx("session-1"),
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
          messages: [
            { role: "user", content: "Raw capture survives extraction failure.", message_index: 0 },
            { role: "assistant", content: "Raw capture failure reply is still stored.", message_index: 1 }
          ]
        },
        mainCtx("session-1"),
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
        mainCtx("session-1"),
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

  it("auto-recalls current-session exact raw evidence into appendContext when explicitly enabled", () => {
    const runtime = createTempRuntime({ autoRecall: true });
    try {
      captureAgentEnd(
        {
          runId: "run-1",
          success: true,
          messages: [
            { role: "user", content: "Partner-Mem recall hook exact raw text.", message_index: 0 },
            { role: "assistant", content: "Partner-Mem recall hook exact assistant text.", message_index: 1 }
          ]
        },
        mainCtx("session-1"),
        runtime
      );

      const result = recallBeforePromptBuild(
        {
          prompt: "Find recall hook",
          messages: [{ role: "user", content: "recall hook" }]
        },
        mainCtx("session-1"),
        runtime
      );

      expect(result?.appendContext).toContain("Partner-Mem recall hook exact raw text.");
      expect(result?.appendContext).not.toContain("Partner-Mem recent raw timeline:");
      expect(result?.appendContext).not.toContain(runtime.__dbPath);
      expect(result?.appendContext).not.toContain("candidate route as fact");
      expect(result?.appendContext).not.toContain("fake summary proof");
      expect(result).not.toHaveProperty("prependContext");
      expect(result).not.toHaveProperty("systemPrompt");
    } finally {
      cleanupRuntime(runtime);
    }
  });

  it("skips auto recall injection when trusted identity is missing", () => {
    const warnings: unknown[] = [];
    const runtime = createTempRuntime({
      autoRecall: true,
      logger: { warn: (_message: string, meta?: unknown) => warnings.push(meta) }
    });
    try {
      captureAgentEnd(
        {
          runId: "run-1",
          success: true,
          messages: [
            { role: "user", content: "identity guarded recall proof", message_index: 0 },
            { role: "assistant", content: "identity guarded recall reply", message_index: 1 }
          ]
        },
        mainCtx("session-1"),
        runtime
      );

      const result = recallBeforePromptBuild(
        {
          prompt: "identity guarded",
          messages: [{ role: "user", content: "identity guarded" }]
        },
        {},
        runtime
      );

      expect(result).toBeUndefined();
      expect(warnings.length).toBeGreaterThan(0);
      expect(JSON.stringify(warnings)).toContain("trusted OpenClaw identity");
    } finally {
      cleanupRuntime(runtime);
    }
  });

  it("keeps the base prompt prefix stable when dynamic memory changes", () => {
    const runtime = createTempRuntime({ autoRecall: true });
    try {
      captureAgentEnd(
        {
          runId: "run-1",
          success: true,
          messages: [
            { role: "user", content: "alpha cache evidence", message_index: 0 },
            { role: "assistant", content: "alpha cache reply", message_index: 1 }
          ]
        },
        mainCtx("session-1"),
        runtime
      );
      captureAgentEnd(
        {
          runId: "run-2",
          success: true,
          messages: [
            { role: "user", content: "beta cache evidence", message_index: 2 },
            { role: "assistant", content: "beta cache reply", message_index: 3 }
          ]
        },
        mainCtx("session-1"),
        runtime
      );

      const first = recallBeforePromptBuild(
        {
          prompt: "alpha",
          messages: [{ role: "user", content: "alpha" }]
        },
        mainCtx("session-1"),
        runtime
      );
      const second = recallBeforePromptBuild(
        {
          prompt: "beta",
          messages: [{ role: "user", content: "beta" }]
        },
        mainCtx("session-1"),
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
          messages: [
            { role: "user", content: "Visible memory that must not enter extraction prompt.", message_index: 0 },
            { role: "assistant", content: "Visible assistant memory that must not enter extraction prompt.", message_index: 1 }
          ]
        },
        mainCtx("session-1"),
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
          mainCtx("partner-mem-extraction-456"),
          runtime
        )
      ).toBeUndefined();
    } finally {
      cleanupRuntime(runtime);
    }
  });

  it("does not auto-recall exact raw evidence across OpenClaw sessions", () => {
    const runtime = createTempRuntime({ autoRecall: true });
    try {
      captureAgentEnd(
        {
          runId: "run-1",
          success: true,
          messages: [
            { role: "user", content: "密码：柚子茶8842", message_index: 0 },
            { role: "assistant", content: "我记住了。", message_index: 1 }
          ]
        },
        mainCtx("old-session"),
        runtime
      );

      const result = recallBeforePromptBuild(
        {
          prompt: "我的密码是什么",
          messages: [{ role: "user", content: "我的密码是什么" }]
        },
        mainCtx("new-session"),
        runtime
      );

      expect(result).toBeUndefined();
    } finally {
      cleanupRuntime(runtime);
    }
  });

  it("autoRecall defaults to false and injects nothing", () => {
    const runtime = createTempRuntime();
    try {
      expect(
        recallBeforePromptBuild(
          {
            prompt: "anything",
            messages: [{ role: "user", content: "anything" }]
          },
          mainCtx("session-1"),
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
            messages: [
              { role: "user", content: "capture failure input", message_index: 0 },
              { role: "assistant", content: "capture failure reply", message_index: 1 }
            ]
          },
          mainCtx("session-1"),
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
    const runtime = createTempRuntime({ captureMaxCharsPerMessage: 1000 });
    const longText = "x".repeat(1001);
    try {
      captureAgentEnd(
        {
          runId: "run-1",
          success: true,
          messages: [
            { role: "user", content: longText, message_index: 0 },
            { role: "assistant", content: "short assistant after oversized user", message_index: 1 }
          ]
        },
        mainCtx("session-1"),
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
    readPartnerMemOpenClawConfig({ captureFlushMaxTurns: 1, ...configOverrides, dbPath })
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

function timelineTexts(runtime: ReturnType<typeof createTempRuntime>, agentId: string, sessionId: string): string[] {
  return runtime.facade
    .partner_mem_timeline({
      agent_id: agentId,
      session_id: sessionId,
      limit: 20
    })
    .evidence_items.map((item) => item.text);
}

function mainCtx(sessionKey: string): { agentId: string; sessionKey: string; conversationKind: "main" } {
  return { agentId: "agent-1", sessionKey, conversationKind: "main" };
}

function countRuntimeRows(runtime: ReturnType<typeof createTempRuntime>, tableName: string): number {
  if (!/^[a-z_]+$/u.test(tableName)) {
    throw new TypeError(`Unsafe table name: ${tableName}`);
  }
  const db = new DatabaseSync(runtime.__dbPath) as SqliteDatabase & { close?: () => void };
  try {
    const row = db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get() as { count: number };
    return row.count;
  } finally {
    db.close?.();
  }
}
