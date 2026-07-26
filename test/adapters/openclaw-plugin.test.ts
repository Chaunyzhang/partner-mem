import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import rootToolSchemas from "../../src/tools/generated/tool-schemas.json" with { type: "json" };
import pluginManifest from "../../openclaw-plugin/openclaw.plugin.json" with { type: "json" };
import pluginToolSchemas from "../../openclaw-plugin/src/generated/tool-schemas.json" with { type: "json" };
import pluginEntry from "../../openclaw-plugin/src/index.js";
import { PartnerMemOpenClawAdapter } from "../../openclaw-plugin/src/plugin-core.js";
import { RuntimeClient } from "../../openclaw-plugin/src/runtime-client.js";
import { HarnessStateStore } from "../../openclaw-plugin/src/state.js";
import type { PartnerMemToolName } from "../../openclaw-plugin/src/tool-schemas.js";

describe("OpenClaw Partner-Mem adapter", () => {
  it("projects the canonical three Partner-Mem tools into the manifest", () => {
    expect(pluginToolSchemas).toEqual(rootToolSchemas);
    expect(pluginManifest.contracts.tools).toEqual(rootToolSchemas.map((tool) => tool.name));
    expect(pluginManifest.contracts.tools).toEqual([
      "partner_mem_keyword_search",
      "partner_mem_vector_search",
      "partner_mem_graph_traverse"
    ]);
    expect(pluginManifest.configSchema).toMatchObject({
      type: "object",
      additionalProperties: false
    });
    expect(pluginManifest).not.toHaveProperty("entry");
    expect(pluginManifest).not.toHaveProperty("kind");
    expect(pluginManifest.contracts).not.toHaveProperty("hooks");
    expect(JSON.stringify(pluginManifest)).not.toContain("agent_end");
    expect(JSON.stringify(pluginManifest)).not.toContain("partner_mem_search");
  });

  it("registers five typed hooks, one lifecycle cleanup, and exactly three tool factories", async () => {
    const dir = await mkdtemp(join(tmpdir(), "partner-mem-openclaw-entry-"));
    const hooks: string[] = [];
    const tools: Array<(context: Record<string, unknown>) => { name: string }> = [];
    const lifecycles: Array<{ id: string; cleanup?: () => void }> = [];
    const api = {
      pluginConfig: {
        statePath: join(dir, "state.json"),
        databasePath: join(dir, "partner-mem.sqlite"),
        runtimePath: join(dir, "runtime.js")
      },
      logger: { debug() {}, info() {}, warn() {}, error() {} },
      on(name: string) {
        hooks.push(name);
      },
      registerTool(factory: (context: Record<string, unknown>) => { name: string }) {
        tools.push(factory);
      },
      lifecycle: {
        registerRuntimeLifecycle(
          lifecycle: { id: string; cleanup?: () => void }
        ) {
          lifecycles.push(lifecycle);
        }
      }
    };
    if (!pluginEntry.register) {
      throw new Error("OpenClaw plugin entry lacks register()");
    }
    pluginEntry.register(
      api as unknown as Parameters<NonNullable<typeof pluginEntry.register>>[0]
    );

    expect(hooks).toEqual([
      "gateway_start",
      "before_agent_run",
      "message_received",
      "reply_payload_sending",
      "message_sent"
    ]);
    expect(tools.map((factory) => factory({ sessionKey: "s", agentId: "a" }).name)).toEqual([
      "partner_mem_keyword_search",
      "partner_mem_vector_search",
      "partner_mem_graph_traverse"
    ]);
    expect(lifecycles).toHaveLength(1);
    expect(lifecycles[0]?.id).toBe("partner-mem-runtime");
    lifecycles[0]?.cleanup?.();
  });

  it("records final inbound text and the successful outbound reply as one node", async () => {
    const fake = new FakeRuntimeClient();
    const adapter = newAdapter(fake);

    adapter.onMessageReceived(
      {
        content: "  What did I say?  ",
        messageId: "msg-user-1",
        senderId: "user-1",
        sessionKey: "session-1",
        timestamp: 1780000000
      },
      { sessionKey: "session-1", senderId: "agent-1" }
    );
    observeVisible(adapter, "session-1", "You said hello.", {
      agentId: "agent-1"
    });
    adapter.onMessageSent(
      { content: "You said hello.", success: true, messageId: "msg-agent-1" },
      { sessionKey: "session-1", senderId: "agent-1", replyToId: "msg-user-1" }
    );

    await adapter.flush("session-1");

    expect(fake.registerHarnessCalls).toBe(1);
    expect(fake.questions).toHaveLength(1);
    expect(fake.answers).toHaveLength(1);
    expect(fake.questions[0]).toMatchObject({
      harness_id: "harness-openclaw",
      source_conversation_id: "session-1",
      text: "  What did I say?  ",
      role: "user",
      source_message_id: "msg-user-1",
      source_author_id: "user-1"
    });
    expect(fake.answers[0]).toMatchObject({
      harness_id: "harness-openclaw",
      source_conversation_id: "session-1",
      node_id: "node-1",
      text: "You said hello.",
      role: "assistant",
      source_message_id: "msg-agent-1"
    });
    expect(fake.answers[0]).toMatchObject({
      source_agent_id: "agent-1",
      source_access_agent_id: "agent-1"
    });
    expect(fake.questions[0]).not.toHaveProperty("source_access_agent_id");
  });

  it("records answer-only only for an exact host-proven proactive run", async () => {
    const fake = new FakeRuntimeClient();
    const adapter = newAdapter(fake);

    adapter.onBeforeAgentRun({
      sessionKey: "proactive-session",
      runId: "cron-run",
      agentId: "agent-1",
      trigger: "cron"
    });
    observeVisible(adapter, "proactive-session", "Scheduled result", {
      runId: "cron-run"
    });
    adapter.onMessageSent(
      {
        content: "Scheduled result",
        success: true,
        messageId: "proactive-answer",
        runId: "cron-run"
      },
      { sessionKey: "proactive-session", runId: "cron-run" }
    );

    observeVisible(adapter, "ambiguous-session", "Unproven result", {
      runId: "ordinary-run",
      agentId: "agent-1"
    });
    adapter.onMessageSent(
      {
        content: "Unproven result",
        success: true,
        messageId: "unproven-answer",
        runId: "ordinary-run"
      },
      { sessionKey: "ambiguous-session", runId: "ordinary-run" }
    );
    await adapter.flush();

    expect(fake.answers).toHaveLength(1);
    expect(fake.answers[0]).toMatchObject({
      source_conversation_id: "proactive-session",
      question_was_absent: true,
      text: "Scheduled result",
      source_agent_id: "agent-1",
      source_access_agent_id: "agent-1"
    });
    expect(fake.answers[0]).not.toHaveProperty("node_id");

    adapter.onBeforeAgentRun({
      sessionKey: "ordinary-session",
      runId: "user-run",
      agentId: "agent-1",
      trigger: "user"
    });
    observeVisible(adapter, "ordinary-session", "Ordinary unanchored result", {
      runId: "user-run",
      agentId: "agent-1"
    });
    adapter.onMessageSent(
      {
        content: "Ordinary unanchored result",
        success: true,
        messageId: "ordinary-answer",
        runId: "user-run"
      },
      { sessionKey: "ordinary-session", runId: "user-run" }
    );
    await adapter.flush("ordinary-session");

    expect(fake.answers).toHaveLength(1);
  });

  it("does not write delivery failures, blank messages, or ambiguous outbound answers", async () => {
    const fake = new FakeRuntimeClient();
    const adapter = newAdapter(fake);

    adapter.onMessageReceived({ content: "first", messageId: "m1" }, { sessionKey: "s" });
    adapter.onMessageReceived({ content: "second", messageId: "m2" }, { sessionKey: "s" });
    observeVisible(adapter, "s", "ambiguous");
    adapter.onMessageSent({ content: "ambiguous", success: true, messageId: "a1" }, { sessionKey: "s" });
    observeVisible(adapter, "s", "failed");
    adapter.onMessageSent({ content: "failed", success: false, messageId: "a2" }, { sessionKey: "s", replyToId: "m1" });
    adapter.onMessageSent({ content: "   ", success: true, messageId: "a3" }, { sessionKey: "s", replyToId: "m1" });

    await adapter.flush("s");

    expect(fake.questions).toHaveLength(2);
    expect(fake.answers).toHaveLength(0);
  });

  it("does not guess when sessionKey is missing", async () => {
    const fake = new FakeRuntimeClient();
    const adapter = newAdapter(fake);

    adapter.onMessageReceived({ content: "hello", messageId: "m1" }, {});
    observeVisible(adapter, "", "world");
    adapter.onMessageSent({ content: "world", success: true, messageId: "a1" }, {});
    await adapter.flush();

    expect(fake.questions).toHaveLength(0);
    expect(fake.answers).toHaveLength(0);
  });

  it("returns a stable unavailable envelope when tool transport fails", async () => {
    const fake = new FakeRuntimeClient();
    fake.invokeToolError = new Error("runtime down");
    const adapter = newAdapter(fake);

    const result = await adapter.invokeTool(
      "partner_mem_vector_search",
      { query: "needle" },
      { sessionKey: "s", senderId: "agent-1" }
    );

    expect(result).toEqual({
      status: "error",
      retrieval_type: "vector",
      truncated: false,
      error_code: "partner_mem_unavailable",
      evidence_items: []
    });
  });

  it("deduplicates repeated inbound source messages before correlating outbound", async () => {
    const fake = new FakeRuntimeClient();
    const adapter = newAdapter(fake);

    adapter.onMessageReceived({ content: "same", messageId: "m1" }, { sessionKey: "s" });
    adapter.onMessageReceived({ content: "same", messageId: "m1" }, { sessionKey: "s" });
    observeVisible(adapter, "s", "answer");
    adapter.onMessageSent({ content: "answer", success: true, messageId: "a1" }, { sessionKey: "s" });
    await adapter.flush("s");

    expect(fake.questions).toHaveLength(1);
    expect(fake.answers).toHaveLength(1);
    expect(fake.answers[0]?.node_id).toBe("node-1");
  });

  it("does not store an audio-only hidden spoken transcript", async () => {
    const fake = new FakeRuntimeClient();
    const adapter = newAdapter(fake);

    adapter.onMessageReceived(
      { content: "say it", messageId: "m1" },
      { sessionKey: "s" }
    );
    adapter.onReplyPayloadSending(
      {
        spokenText: "hidden speech",
        hasMedia: true,
        isReasoning: false,
        isCommentary: false,
        isStatusNotice: false,
        isCompactionNotice: false,
        isFallbackNotice: false,
        sessionKey: "s"
      },
      { sessionKey: "s" }
    );
    adapter.onMessageSent(
      { content: "hidden speech", success: true, messageId: "a1" },
      { sessionKey: "s" }
    );
    await adapter.flush("s");

    expect(fake.questions).toHaveLength(1);
    expect(fake.answers).toHaveLength(0);
  });

  it("does not treat message_sent text as visible without payload proof", async () => {
    const fake = new FakeRuntimeClient();
    const adapter = newAdapter(fake);

    adapter.onMessageReceived(
      { content: "question", messageId: "m1" },
      { sessionKey: "s" }
    );
    adapter.onMessageSent(
      { content: "unproven", success: true, messageId: "a1" },
      { sessionKey: "s" }
    );
    await adapter.flush("s");

    expect(fake.questions).toHaveLength(1);
    expect(fake.answers).toHaveLength(0);
  });

  it("persists stable harness state atomically and registers once", async () => {
    const dir = await mkdtemp(join(tmpdir(), "partner-mem-openclaw-"));
    const statePath = join(dir, "state.json");
    const databasePath = join(dir, "partner-mem.sqlite");
    const fake = new FakeRuntimeClient();
    const first = new HarnessStateStore(statePath, databasePath, fake);

    await expect(first.ensure()).resolves.toEqual({
      version: 1,
      harness_id: "harness-openclaw"
    });
    await writeFile(databasePath, "");
    const second = new HarnessStateStore(statePath, databasePath, fake);
    await expect(second.ensure()).resolves.toEqual({
      version: 1,
      harness_id: "harness-openclaw"
    });

    expect(fake.registerHarnessCalls).toBe(1);
    await expect(readFile(statePath, "utf8")).resolves.toContain("harness-openclaw");
  });

  it("fails when state survives but its database is missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "partner-mem-openclaw-"));
    const statePath = join(dir, "state.json");
    const databasePath = join(dir, "partner-mem.sqlite");
    const fake = new FakeRuntimeClient();
    const first = new HarnessStateStore(statePath, databasePath, fake);
    await first.ensure();

    const restarted = new HarnessStateStore(statePath, databasePath, fake);
    await expect(restarted.ensure()).rejects.toThrow(
      "state exists but the database is missing"
    );
    expect(fake.registerHarnessCalls).toBe(1);
  });

  it("persists only host-provided explicit reply relations", async () => {
    const fake = new FakeRuntimeClient();
    const adapter = newAdapter(fake);

    adapter.onMessageReceived(
      {
        content: "reply",
        messageId: "reply-message",
        replyToId: "parent-message"
      },
      { sessionKey: "s" }
    );
    await adapter.flush("s");

    expect(fake.replies).toEqual([
      {
        harness_id: "harness-openclaw",
        from_source_message_id: "reply-message",
        to_source_message_id: "parent-message"
      }
    ]);
  });

  it("bounds runtime requests and does not restart the child after timeout", async () => {
    const dir = await mkdtemp(join(tmpdir(), "partner-mem-openclaw-runtime-"));
    const runtimePath = join(dir, "silent-runtime.mjs");
    await writeFile(runtimePath, "setInterval(() => undefined, 1000);\n");
    const client = new RuntimeClient({
      runtimePath,
      databasePath: join(dir, "db.sqlite"),
      requestTimeoutMs: 10
    });

    await expect(client.registerHarness("openclaw")).rejects.toThrow("timed out");
    await expect(client.registerHarness("openclaw")).rejects.toThrow("closed");
  });

  it("rejects pending requests when the runtime protocol returns invalid JSON", async () => {
    const dir = await mkdtemp(join(tmpdir(), "partner-mem-openclaw-runtime-"));
    const runtimePath = join(dir, "invalid-json-runtime.mjs");
    await writeFile(runtimePath, "console.log('not json'); setInterval(() => undefined, 1000);\n");
    const client = new RuntimeClient({
      runtimePath,
      databasePath: join(dir, "db.sqlite"),
      requestTimeoutMs: 1000
    });

    await expect(client.registerHarness("openclaw")).rejects.toThrow("invalid JSON");
    await expect(client.registerHarness("openclaw")).rejects.toThrow("closed");
  });
});

function newAdapter(fake: FakeRuntimeClient): PartnerMemOpenClawAdapter {
  let state: Promise<{ version: 1; harness_id: string }> | null = null;
  return new PartnerMemOpenClawAdapter({
    client: fake,
    stateStore: {
      ensure: async () => {
        state ??= fake
          .registerHarness("openclaw")
          .then((harness_id) => ({ version: 1, harness_id }));
        return await state;
      }
    } as HarnessStateStore,
    logger: { warn: () => undefined, error: () => undefined }
  });
}

function observeVisible(
  adapter: PartnerMemOpenClawAdapter,
  sessionKey: string,
  text: string,
  options: { runId?: string; agentId?: string } = {}
): void {
  adapter.onReplyPayloadSending(
    {
      text,
      hasMedia: false,
      isReasoning: false,
      isCommentary: false,
      isStatusNotice: false,
      isCompactionNotice: false,
      isFallbackNotice: false,
      ...(options.runId ? { runId: options.runId } : {}),
      ...(options.agentId ? { agentId: options.agentId } : {}),
      ...(sessionKey ? { sessionKey } : {})
    },
    {
      ...(sessionKey ? { sessionKey } : {}),
      ...(options.runId ? { runId: options.runId } : {})
    }
  );
}

class FakeRuntimeClient {
  registerHarnessCalls = 0;
  questions: Record<string, unknown>[] = [];
  answers: Record<string, unknown>[] = [];
  replies: Record<string, unknown>[] = [];
  invokeToolError: Error | null = null;

  async registerHarness(_harnessType: string): Promise<string> {
    this.registerHarnessCalls += 1;
    return "harness-openclaw";
  }

  async recordQuestion(params: Record<string, unknown>): Promise<string> {
    this.questions.push(params);
    return `node-${this.questions.length}`;
  }

  async recordAnswer(params: Record<string, unknown>): Promise<string> {
    this.answers.push(params);
    return String(params.node_id);
  }

  async recordReply(params: Record<string, unknown>): Promise<string> {
    this.replies.push(params);
    return `edge-${this.replies.length}`;
  }

  async invokeTool(params: {
    harness_id: string;
    source_conversation_id: string;
    source_agent_id?: string;
    tool_name: PartnerMemToolName;
    arguments: Record<string, unknown>;
  }): Promise<unknown> {
    if (this.invokeToolError) {
      throw this.invokeToolError;
    }
    return { status: "empty", retrieval_type: params.tool_name, evidence_items: [] };
  }

  close(): void {}
}
