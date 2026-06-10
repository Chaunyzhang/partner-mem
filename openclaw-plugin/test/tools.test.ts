import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TOOL_NAMES, toolSchemas } from "../../src/tools/tool-contracts.js";
import { readPartnerMemOpenClawConfig } from "../src/config.js";
import { createPartnerMemOpenClawRuntime } from "../src/runtime.js";
import { createPartnerMemOpenClawTools } from "../src/tools.js";

describe("Partner-Mem OpenClaw tools", () => {
  const crossAgentSwitchKey = ["allow", "cross", "agent"].join("_");

  it("registers exactly the four Partner-Mem tools and no generic aliases", () => {
    const runtime = createTempRuntime();
    try {
      const names = createPartnerMemOpenClawTools(runtime).map((tool) => tool.name);

      expect(names).toEqual([...TOOL_NAMES]);
      expect(names).not.toContain("memory_search");
      expect(names).not.toContain("memory_recall");
      expect(names).not.toContain("memory_store");
      expect(names).not.toContain("memory_add");
    } finally {
      cleanupRuntime(runtime);
    }
  });

  it("routes recall and status through ToolFacade", async () => {
    const runtime = createTempRuntime();
    try {
      runtime.ingest.ingestTurn({
        agent_id: "agent-1",
        session_id: "session-1",
        turn_id: "turn-1",
        turn_index: 0,
        messages: [
          {
            role: "user",
            text: "Partner-Mem tool proof exact raw text.",
            observed_at: "2026-06-06T00:00:00.000Z",
            message_index: 0
          }
        ]
      });

      const tools = createPartnerMemOpenClawTools(runtime);
      const recall = await tools
        .find((tool) => tool.name === "partner_mem_recall")!
        .execute("call-1", {
          query: "tool proof",
          limit: 5
        }, {
          agentId: "agent-1",
          sessionKey: "session-1"
        });
      const status = await tools.find((tool) => tool.name === "partner_mem_status")!.execute("call-2", {
        ignored: true
      });

      expect(JSON.stringify(recall.details)).toContain("Partner-Mem tool proof exact raw text.");
      expect(JSON.stringify(status.details)).toContain("\"schema\":\"healthy\"");
      expect(recall.content[0]?.text).not.toContain(runtime.__dbPath);
      expect(JSON.stringify(recall.details)).not.toContain(runtime.__dbPath);
    } finally {
      cleanupRuntime(runtime);
    }
  });

  it("does not expose agent identity or cross-agent switches in model-facing schemas", () => {
    expect(toolSchemas.partner_mem_search.inputSchema.required).toEqual(["query", "limit"]);
    expect(toolSchemas.partner_mem_recall.inputSchema.required).toEqual(["query", "limit"]);
    expect(toolSchemas.partner_mem_timeline.inputSchema.required).toEqual(["limit"]);
    expect(toolSchemas.partner_mem_search.inputSchema.properties).toHaveProperty("scope");
    expect(toolSchemas.partner_mem_recall.inputSchema.properties).toHaveProperty("scope");
    expect(toolSchemas.partner_mem_timeline.inputSchema.properties).not.toHaveProperty("scope");
    expect(JSON.stringify(toolSchemas.partner_mem_recall.inputSchema.properties.scope)).toContain("current_session");
    expect(JSON.stringify(toolSchemas.partner_mem_recall.inputSchema.properties.scope)).toContain("agent_memory");

    for (const name of ["partner_mem_search", "partner_mem_recall", "partner_mem_timeline"] as const) {
      expect(toolSchemas[name].inputSchema.properties).not.toHaveProperty("agent_id");
      expect(toolSchemas[name].inputSchema.properties).not.toHaveProperty("session_id");
    }
    expect(toolSchemas.partner_mem_recall.inputSchema.properties).not.toHaveProperty(crossAgentSwitchKey);
  });

  it("binds recall to trusted OpenClaw context instead of model-supplied agent_id", async () => {
    const runtime = createTempRuntime();
    try {
      runtime.ingest.ingestTurn({
        agent_id: "agent-1",
        session_id: "session-1",
        turn_id: "turn-1",
        turn_index: 0,
        messages: [
          {
            role: "user",
            text: "trusted context recall proof",
            observed_at: "2026-06-06T00:00:00.000Z",
            message_index: 0
          }
        ]
      });
      runtime.ingest.ingestTurn({
        agent_id: "agent-2",
        session_id: "session-2",
        turn_id: "turn-2",
        turn_index: 0,
        messages: [
          {
            role: "user",
            text: "model supplied wrong agent proof",
            observed_at: "2026-06-06T00:00:00.000Z",
            message_index: 0
          }
        ]
      });
      runtime.ingest.ingestTurn({
        agent_id: "agent-1",
        session_id: "session-2",
        turn_id: "turn-3",
        turn_index: 0,
        messages: [
          {
            role: "user",
            text: "model supplied wrong session proof",
            observed_at: "2026-06-06T00:00:00.000Z",
            message_index: 0
          }
        ]
      });

      const recall = await createPartnerMemOpenClawTools(runtime)
        .find((tool) => tool.name === "partner_mem_recall")!
        .execute(
          "call-identity",
          {
            query: "proof",
            agent_id: "agent-2",
            session_id: "session-2",
            [crossAgentSwitchKey]: true,
            limit: 5
          },
          { agentId: "agent-1", sessionKey: "session-1" }
        );

      expect(recall.isError).not.toBe(true);
      expect(JSON.stringify(recall.details)).toContain("trusted context recall proof");
      expect(JSON.stringify(recall.details)).not.toContain("model supplied wrong agent proof");
      expect(JSON.stringify(recall.details)).not.toContain("model supplied wrong session proof");
    } finally {
      cleanupRuntime(runtime);
    }
  });

  it("defaults recall to current session and only crosses sessions with agent_memory scope", async () => {
    const runtime = createTempRuntime();
    try {
      runtime.ingest.ingestTurn({
        agent_id: "agent-1",
        session_id: "session-1",
        turn_id: "turn-1",
        turn_index: 0,
        messages: [
          {
            role: "user",
            text: "current session scoped proof",
            observed_at: "2026-06-06T00:00:00.000Z",
            message_index: 0
          }
        ]
      });
      runtime.ingest.ingestTurn({
        agent_id: "agent-1",
        session_id: "session-2",
        turn_id: "turn-2",
        turn_index: 0,
        messages: [
          {
            role: "user",
            text: "agent memory scoped proof",
            observed_at: "2026-06-06T00:00:00.000Z",
            message_index: 0
          }
        ]
      });

      const recallTool = createPartnerMemOpenClawTools(runtime)
        .find((tool) => tool.name === "partner_mem_recall")!;
      const currentSession = await recallTool.execute(
        "call-current-session",
        { query: "scoped proof", limit: 5 },
        { agentId: "agent-1", sessionKey: "session-1" }
      );
      const agentMemory = await recallTool.execute(
        "call-agent-memory",
        { query: "scoped proof", scope: "agent_memory", limit: 5 },
        { agentId: "agent-1", sessionKey: "session-1" }
      );

      expect(JSON.stringify(currentSession.details)).toContain("current session scoped proof");
      expect(JSON.stringify(currentSession.details)).not.toContain("agent memory scoped proof");
      expect(JSON.stringify(agentMemory.details)).toContain("current session scoped proof");
      expect(JSON.stringify(agentMemory.details)).toContain("agent memory scoped proof");
    } finally {
      cleanupRuntime(runtime);
    }
  });

  it("rejects invalid memory scope before facade access", async () => {
    const runtime = createTempRuntime();
    const originalRecall = runtime.facade.partner_mem_recall;
    let facadeCalled = false;
    runtime.facade.partner_mem_recall = ((input) => {
      facadeCalled = true;
      return originalRecall.call(runtime.facade, input);
    }) as typeof runtime.facade.partner_mem_recall;

    try {
      const recall = await createPartnerMemOpenClawTools(runtime)
        .find((tool) => tool.name === "partner_mem_recall")!
        .execute(
          "call-invalid-scope",
          { query: "anything", scope: "cross_agent", limit: 5 },
          { agentId: "agent-1", sessionKey: "session-1" }
        );

      expect(recall.isError).toBe(true);
      expect(recall.content[0]?.text).toContain("scope must be current_session or agent_memory");
      expect(facadeCalled).toBe(false);
    } finally {
      runtime.facade.partner_mem_recall = originalRecall;
      cleanupRuntime(runtime);
    }
  });

  it("returns an error without facade access when a memory tool has no trusted agent identity", async () => {
    const runtime = createTempRuntime();
    const originalRecall = runtime.facade.partner_mem_recall;
    let facadeCalled = false;
    runtime.facade.partner_mem_recall = ((input) => {
      facadeCalled = true;
      return originalRecall.call(runtime.facade, input);
    }) as typeof runtime.facade.partner_mem_recall;

    try {
      const recall = await createPartnerMemOpenClawTools(runtime)
        .find((tool) => tool.name === "partner_mem_recall")!
        .execute("call-missing-identity", { query: "anything", limit: 5 });

      expect(recall.isError).toBe(true);
      expect(recall.content[0]?.text).toContain("trusted OpenClaw identity");
      expect(facadeCalled).toBe(false);
    } finally {
      runtime.facade.partner_mem_recall = originalRecall;
      cleanupRuntime(runtime);
    }
  });

  it("tool source does not import storage owners or direct SQLite", () => {
    const source = readFileSync(new URL("../src/tools.ts", import.meta.url), "utf8");

    expect(source).not.toMatch(/GraphStore|DatabaseSync|@photostructure\/sqlite|db\.prepare|db\.exec/u);
  });
});

function createTempRuntime() {
  const tempDir = mkdtempSync(join(tmpdir(), "partner-mem-openclaw-tools-"));
  const dbPath = join(tempDir, "partner-mem.db");
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
  return Object.assign(runtime, { __tempDir: tempDir, __dbPath: dbPath });
}

function cleanupRuntime(runtime: ReturnType<typeof createTempRuntime>): void {
  runtime.stop();
  rmSync(runtime.__tempDir, { recursive: true, force: true });
}
