import { ToolFacade } from "../tools/tool-facade.js";
import { toolSchemas, type ToolName } from "../tools/tool-contracts.js";

export function createMcpToolList() {
  return Object.values(toolSchemas);
}

export function callMcpTool(facade: ToolFacade, name: ToolName, args: unknown) {
  switch (name) {
    case "partner_mem_search":
      return facade.partner_mem_search(args as Parameters<ToolFacade["partner_mem_search"]>[0]);
    case "partner_mem_recall":
      return facade.partner_mem_recall(args as Parameters<ToolFacade["partner_mem_recall"]>[0]);
    case "partner_mem_timeline":
      return facade.partner_mem_timeline(args as Parameters<ToolFacade["partner_mem_timeline"]>[0]);
    case "partner_mem_status":
      return facade.partner_mem_status();
    default:
      throw new TypeError(`Unknown Partner-Mem tool: ${String(name)}`);
  }
}
