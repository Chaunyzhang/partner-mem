import type {
  AnyAgentTool,
  AgentToolResult,
  OpenClawPluginToolContext
} from "openclaw/plugin-sdk/plugin-entry";
import {
  TOOL_NAMES,
  toolSchemas,
  type ToolName
} from "../../src/tools/tool-contracts.js";
import { readMemoryScope, sessionIdForMemoryScope, type MemoryScope } from "../../src/tools/tool-scope.js";
import { resolveOpenClawSessionIdentity } from "./openclaw-adapter.js";
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
    async execute(_toolCallId: string, params: unknown, context?: OpenClawPluginToolContext) {
      try {
        return toOpenClawToolResult(callFacade(name, runtime, bindTrustedIdentity(name, params, context)));
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

function bindTrustedIdentity(
  name: ToolName,
  params: unknown,
  context: OpenClawPluginToolContext | undefined
): unknown {
  if (name === "partner_mem_status") return params;

  const identity = resolveOpenClawSessionIdentity(undefined, context);
  if (!identity) {
    throw new Error("Partner-Mem requires trusted OpenClaw identity before memory tool access.");
  }

  return {
    ...buildTrustedMemoryToolInput(name, params, identity.session_id),
    agent_id: identity.agent_id,
  };
}

function buildTrustedMemoryToolInput(name: ToolName, params: unknown, trustedSessionId: string): Record<string, unknown> {
  const input = isRecord(params) ? params : {};
  switch (name) {
    case "partner_mem_search":
    case "partner_mem_recall":
      return {
        ...pick(input, ["query", "time_window", "limit"]),
        ...withScopedSessionId(readMemoryScope(input.scope), trustedSessionId)
      };
    case "partner_mem_timeline":
      return {
        ...pick(input, ["since", "until", "limit"]),
        session_id: trustedSessionId
      };
    case "partner_mem_status":
      return {};
  }
}

function withScopedSessionId(scope: MemoryScope, trustedSessionId: string): Record<string, string> {
  const sessionId = sessionIdForMemoryScope(scope, trustedSessionId);
  return sessionId ? { session_id: sessionId } : {};
}

function pick(input: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const key of keys) {
    if (input[key] !== undefined) output[key] = input[key];
  }
  return output;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toLabel(name: ToolName): string {
  return name
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
