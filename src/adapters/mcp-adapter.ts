import { ToolFacade } from "../tools/tool-facade.js";
import { toolSchemas, type ToolName } from "../tools/tool-contracts.js";

export interface TrustedMemoryIdentity {
  agent_id: string;
  session_id: string;
}

export function createMcpToolList() {
  return Object.values(toolSchemas);
}

export function callMcpTool(
  facade: ToolFacade,
  name: ToolName,
  args: unknown,
  identity?: TrustedMemoryIdentity
) {
  const input = bindTrustedIdentity(name, args, identity);

  switch (name) {
    case "partner_mem_search":
      return facade.partner_mem_search(input as Parameters<ToolFacade["partner_mem_search"]>[0]);
    case "partner_mem_recall":
      return facade.partner_mem_recall(input as Parameters<ToolFacade["partner_mem_recall"]>[0]);
    case "partner_mem_timeline":
      return facade.partner_mem_timeline(input as Parameters<ToolFacade["partner_mem_timeline"]>[0]);
    case "partner_mem_status":
      return facade.partner_mem_status();
    default:
      throw new TypeError(`Unknown Partner-Mem tool: ${String(name)}`);
  }
}

function bindTrustedIdentity(name: ToolName, args: unknown, identity: TrustedMemoryIdentity | undefined): unknown {
  if (name === "partner_mem_status") return args;
  if (!identity) throw new Error("Partner-Mem requires trusted memory identity before tool access.");

  return {
    ...pickAllowedMemoryToolInput(name, args),
    agent_id: identity.agent_id,
    session_id: identity.session_id
  };
}

function pickAllowedMemoryToolInput(name: ToolName, args: unknown): Record<string, unknown> {
  const input = isRecord(args) ? args : {};
  switch (name) {
    case "partner_mem_search":
    case "partner_mem_recall":
      return pick(input, ["query", "time_window", "limit"]);
    case "partner_mem_timeline":
      return pick(input, ["since", "until", "limit"]);
    case "partner_mem_status":
      return {};
  }
}

function pick(input: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const key of keys) {
    if (input[key] !== undefined) output[key] = input[key];
  }
  return output;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
