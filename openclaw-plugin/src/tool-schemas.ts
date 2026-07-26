import toolSchemas from "./generated/tool-schemas.json" with { type: "json" };

export interface PartnerMemToolSchema {
  name: "partner_mem_keyword_search" | "partner_mem_vector_search" | "partner_mem_graph_traverse";
  description: string;
  inputSchema: Record<string, unknown>;
}

export const PARTNER_MEM_TOOL_SCHEMAS = toolSchemas as PartnerMemToolSchema[];

export type PartnerMemToolName = PartnerMemToolSchema["name"];

export function isPartnerMemToolName(value: string): value is PartnerMemToolName {
  return PARTNER_MEM_TOOL_SCHEMAS.some((tool) => tool.name === value);
}
