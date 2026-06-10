import { describe, expect, it } from "vitest";
import { createMcpToolList, callMcpTool } from "../../src/adapters/mcp-adapter.js";
import { RawIngestService } from "../../src/ingest/raw-ingest.js";
import { ToolFacade } from "../../src/tools/tool-facade.js";
import { createInitializedStore } from "../helpers/db.js";

describe("MCP adapter skeleton", () => {
  const crossAgentSwitchKey = ["allow", "cross", "agent"].join("_");

  it("exposes the PR04 tool list with schemas", () => {
    const tools = createMcpToolList();
    expect(tools.map((tool) => tool.name)).toEqual([
      "partner_mem_search",
      "partner_mem_recall",
      "partner_mem_timeline",
      "partner_mem_status"
    ]);
    expect(
      tools.find((tool) => tool.name === "partner_mem_search")?.inputSchema.properties
    ).toHaveProperty("time_window");
    expect(
      tools.find((tool) => tool.name === "partner_mem_recall")?.inputSchema.properties
    ).toHaveProperty("time_window");
    expect(
      tools.find((tool) => tool.name === "partner_mem_recall")?.inputSchema.properties
    ).toHaveProperty("scope");
    expect(
      tools.find((tool) => tool.name === "partner_mem_search")?.inputSchema.properties
    ).toHaveProperty("scope");
    expect(
      tools.find((tool) => tool.name === "partner_mem_timeline")?.inputSchema.properties
    ).not.toHaveProperty("scope");
    for (const name of ["partner_mem_search", "partner_mem_recall", "partner_mem_timeline"] as const) {
      expect(tools.find((tool) => tool.name === name)?.inputSchema.properties).not.toHaveProperty("agent_id");
      expect(tools.find((tool) => tool.name === name)?.inputSchema.properties).not.toHaveProperty("session_id");
    }
    expect(
      tools.find((tool) => tool.name === "partner_mem_recall")?.inputSchema.properties
    ).not.toHaveProperty(crossAgentSwitchKey);
  });

  it("routes tools/call style requests to ToolFacade", () => {
    const store = createInitializedStore();
    new RawIngestService(store).ingestTurn({
      agent_id: "agent-1",
      session_id: "session-1",
      turn_id: "turn-1",
      turn_index: 0,
      messages: [
        {
          role: "user",
          text: "MCP recall proof.",
          observed_at: "2026-01-01T00:00:00.000Z",
          message_index: 0
        }
      ]
    });
    new RawIngestService(store).ingestTurn({
      agent_id: "agent-1",
      session_id: "session-2",
      turn_id: "turn-2",
      turn_index: 0,
      messages: [
        {
          role: "user",
          text: "MCP wrong session proof.",
          observed_at: "2026-01-01T00:00:00.000Z",
          message_index: 0
        }
      ]
    });

    const result = callMcpTool(new ToolFacade(store), "partner_mem_recall", {
      query: "MCP",
      agent_id: "agent-2",
      session_id: "session-2",
      limit: 3
    }, {
      agent_id: "agent-1",
      session_id: "session-1"
    });

    expect(JSON.stringify(result)).toContain("MCP recall proof.");
    expect(JSON.stringify(result)).not.toContain("MCP wrong session proof.");
  });

  it("uses scope to choose current session or same-agent memory", () => {
    const store = createInitializedStore();
    const ingest = new RawIngestService(store);
    ingest.ingestTurn({
      agent_id: "agent-1",
      session_id: "session-1",
      turn_id: "turn-1",
      turn_index: 0,
      messages: [
        {
          role: "user",
          text: "MCP current session scoped proof.",
          observed_at: "2026-01-01T00:00:00.000Z",
          message_index: 0
        }
      ]
    });
    ingest.ingestTurn({
      agent_id: "agent-1",
      session_id: "session-2",
      turn_id: "turn-2",
      turn_index: 0,
      messages: [
        {
          role: "user",
          text: "MCP agent memory scoped proof.",
          observed_at: "2026-01-01T00:00:00.000Z",
          message_index: 0
        }
      ]
    });

    const facade = new ToolFacade(store);
    const currentSession = callMcpTool(facade, "partner_mem_recall", {
      query: "scoped proof",
      limit: 5
    }, {
      agent_id: "agent-1",
      session_id: "session-1"
    });
    const agentMemory = callMcpTool(facade, "partner_mem_recall", {
      query: "scoped proof",
      scope: "agent_memory",
      limit: 5
    }, {
      agent_id: "agent-1",
      session_id: "session-1"
    });

    expect(JSON.stringify(currentSession)).toContain("MCP current session scoped proof.");
    expect(JSON.stringify(currentSession)).not.toContain("MCP agent memory scoped proof.");
    expect(JSON.stringify(agentMemory)).toContain("MCP current session scoped proof.");
    expect(JSON.stringify(agentMemory)).toContain("MCP agent memory scoped proof.");
  });

  it("rejects invalid memory scope", () => {
    expect(() =>
      callMcpTool(new ToolFacade(createInitializedStore()), "partner_mem_recall", {
        query: "anything",
        scope: "cross_agent",
        limit: 5
      }, {
        agent_id: "agent-1",
        session_id: "session-1"
      })
    ).toThrow("scope must be current_session or agent_memory");
  });

  it("rejects memory tool calls without trusted identity", () => {
    expect(() =>
      callMcpTool(new ToolFacade(createInitializedStore()), "partner_mem_recall", {
        query: "MCP",
        limit: 3
      })
    ).toThrow("trusted memory identity");
  });
});
