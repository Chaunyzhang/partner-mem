import type { AnyAgentTool, AgentToolResult } from "openclaw/plugin-sdk/plugin-entry";
import {
  TOOL_NAMES,
  toolSchemas,
  type ToolName
} from "../../src/tools/tool-contracts.js";
import type { PartnerMemOpenClawRuntime } from "./runtime.js";

export function toOpenClawToolResult(result: unknown): AgentToolResult {
  const text = typeof result === "string" ? result : JSON.stringify(result, null, 2);

  return {
    content: [{ type: "text", text }],
    details: result
  };
}

export function createPartnerMemOpenClawTools(runtime: PartnerMemOpenClawRuntime): AnyAgentTool[] {
  return TOOL_NAMES.map((name) => createTool(name, runtime));
}

function createTool(name: ToolName, runtime: PartnerMemOpenClawRuntime): AnyAgentTool {
  const schema = toolSchemas[name];

  return {
    name,
    label: toLabel(name),
    description: schema.description,
    parameters: schema.inputSchema,
    async execute(_toolCallId: string, params: unknown) {
      try {
        return toOpenClawToolResult(callFacade(name, runtime, params));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: message }],
          isError: true
        };
      }
    }
  };
}

function callFacade(name: ToolName, runtime: PartnerMemOpenClawRuntime, params: unknown): unknown {
  switch (name) {
    case "partner_mem_search":
      return runtime.facade.partner_mem_search(params as Parameters<typeof runtime.facade.partner_mem_search>[0]);
    case "partner_mem_recall":
      return runtime.facade.partner_mem_recall(params as Parameters<typeof runtime.facade.partner_mem_recall>[0]);
    case "partner_mem_timeline":
      return runtime.facade.partner_mem_timeline(params as Parameters<typeof runtime.facade.partner_mem_timeline>[0]);
    case "partner_mem_status":
      return runtime.facade.partner_mem_status();
    default:
      throw new TypeError(`Unknown Partner-Mem tool: ${String(name)}`);
  }
}

function toLabel(name: ToolName): string {
  return name
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
