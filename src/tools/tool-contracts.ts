export const TOOL_NAMES = [
  "partner_mem_search",
  "partner_mem_recall",
  "partner_mem_timeline",
  "partner_mem_status"
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

const resultClassValues = [
  "candidate",
  "evidence",
  "status"
] as const;

export const toolSchemas = {
  partner_mem_search: {
    name: "partner_mem_search",
    description: "Search Partner-Mem candidate routes. Candidate results are not final evidence.",
    inputSchema: {
      type: "object",
      required: ["query", "agent_id", "limit"],
      properties: {
        query: { type: "string" },
        agent_id: { type: "string" },
        session_id: { type: "string" },
        limit: { type: "integer", minimum: 1 }
      }
    }
  },
  partner_mem_recall: {
    name: "partner_mem_recall",
    description: "Recall verified original raw text evidence through the graph resolver.",
    inputSchema: {
      type: "object",
      required: ["query", "agent_id", "limit"],
      properties: {
        query: { type: "string" },
        agent_id: { type: "string" },
        session_id: { type: "string" },
        limit: { type: "integer", minimum: 1 }
      }
    }
  },
  partner_mem_timeline: {
    name: "partner_mem_timeline",
    description: "Return recent or filtered raw memory timeline items.",
    inputSchema: {
      type: "object",
      required: ["agent_id", "limit"],
      properties: {
        agent_id: { type: "string" },
        session_id: { type: "string" },
        since: { type: "string" },
        until: { type: "string" },
        limit: { type: "integer", minimum: 1 }
      }
    }
  },
  partner_mem_status: {
    name: "partner_mem_status",
    description: "Report Partner-Mem storage, FTS, graph, evidence, and config health.",
    inputSchema: {
      type: "object",
      properties: {}
    }
  }
} as const;

export { resultClassValues };
