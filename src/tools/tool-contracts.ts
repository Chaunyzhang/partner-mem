import { MEMORY_SCOPE_VALUES } from "./tool-scope.js";

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

const timeWindowSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    since: { type: "string" },
    until: { type: "string" }
  }
} as const;

const memoryScopeSchema = {
  type: "string",
  enum: [...MEMORY_SCOPE_VALUES],
  description: "current_session searches only this chat; agent_memory searches long-term memory for the same agent."
} as const;

export const toolSchemas = {
  partner_mem_search: {
    name: "partner_mem_search",
    description: "Search Partner-Mem candidate routes. Candidate results are not final evidence.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["query", "limit"],
      properties: {
        query: { type: "string" },
        scope: memoryScopeSchema,
        time_window: timeWindowSchema,
        limit: { type: "integer", minimum: 1, maximum: 50 }
      }
    }
  },
  partner_mem_recall: {
    name: "partner_mem_recall",
    description: "Recall verified original raw text evidence through the graph resolver.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["query", "limit"],
      properties: {
        query: { type: "string" },
        scope: memoryScopeSchema,
        time_window: timeWindowSchema,
        limit: { type: "integer", minimum: 1, maximum: 50 }
      }
    }
  },
  partner_mem_timeline: {
    name: "partner_mem_timeline",
    description: "Return recent or filtered raw memory timeline items.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["limit"],
      properties: {
        since: { type: "string" },
        until: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 50 }
      }
    }
  },
  partner_mem_status: {
    name: "partner_mem_status",
    description: "Report Partner-Mem storage, FTS, graph, evidence, and config health.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {}
    }
  }
} as const;

export { resultClassValues };
