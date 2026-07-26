import type { PartnerMemToolName } from "./tool-schemas.js";

export function unavailableEnvelope(toolName: PartnerMemToolName): Record<string, unknown> {
  return {
    status: "error",
    retrieval_type: retrievalTypeForTool(toolName),
    truncated: false,
    error_code: "partner_mem_unavailable",
    evidence_items: []
  };
}

function retrievalTypeForTool(toolName: PartnerMemToolName): string {
  switch (toolName) {
    case "partner_mem_keyword_search":
      return "keyword";
    case "partner_mem_vector_search":
      return "vector";
    case "partner_mem_graph_traverse":
      return "graph";
  }
}
