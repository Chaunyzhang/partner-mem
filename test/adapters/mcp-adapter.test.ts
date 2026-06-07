import { describe, expect, it } from "vitest";
import { createMcpToolList, callMcpTool } from "../../src/adapters/mcp-adapter.js";
import { RawIngestService } from "../../src/ingest/raw-ingest.js";
import { ToolFacade } from "../../src/tools/tool-facade.js";
import { createInitializedStore } from "../helpers/db.js";

describe("MCP adapter skeleton", () => {
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
    ).toHaveProperty("allow_cross_agent");
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

    const result = callMcpTool(new ToolFacade(store), "partner_mem_recall", {
      query: "MCP",
      agent_id: "agent-1",
      limit: 3
    });

    expect(JSON.stringify(result)).toContain("MCP recall proof.");
  });
});
