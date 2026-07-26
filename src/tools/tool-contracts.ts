import type {
  GraphTraverseInput,
  RetrievalScope,
  SearchInput
} from "../retrieval/retrieval-contracts.js";

export const MODEL_VISIBLE_TOOL_NAMES = [
  "partner_mem_keyword_search",
  "partner_mem_vector_search",
  "partner_mem_graph_traverse"
] as const;

export type ModelVisibleToolName = (typeof MODEL_VISIBLE_TOOL_NAMES)[number];

export interface ModelVisibleToolSchema {
  name: ModelVisibleToolName;
  description: string;
  inputSchema: {
    type: "object";
    additionalProperties: false;
    required: readonly string[];
    properties: Record<string, unknown>;
  };
}

export const MODEL_VISIBLE_TOOL_SCHEMAS = [
  {
    name: "partner_mem_keyword_search",
    description:
      "Search complete Partner-Mem turns with the keyword/BM25 index and return full original question and answer text.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["query"],
      properties: {
        query: { type: "string", minLength: 1 },
        scope: {
          type: "string",
          enum: ["current_conversation", "agent_conversations"],
          default: "current_conversation"
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 20,
          default: 10
        }
      }
    }
  },
  {
    name: "partner_mem_vector_search",
    description:
      "Search complete Partner-Mem turns by semantic vector similarity and return full original question and answer text.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["query"],
      properties: {
        query: { type: "string", minLength: 1 },
        scope: {
          type: "string",
          enum: ["current_conversation", "agent_conversations"],
          default: "current_conversation"
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 20,
          default: 10
        }
      }
    }
  },
  {
    name: "partner_mem_graph_traverse",
    description:
      "Traverse only persisted explicit reply relations from one known Partner-Mem turn and return full original turn text plus the actual path.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["start_node_id", "direction"],
      properties: {
        start_node_id: { type: "string", minLength: 1 },
        direction: {
          type: "string",
          enum: ["parent", "replies", "both"]
        },
        max_depth: {
          type: "integer",
          minimum: 1,
          maximum: 3,
          default: 1
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 20,
          default: 10
        }
      }
    }
  }
] as const satisfies readonly ModelVisibleToolSchema[];

export class ToolInputError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = "ToolInputError";
  }
}

export function parseSearchToolInput(value: unknown): SearchInput {
  const input = requireObject(value, "tool input");
  assertOnlyKeys(input, ["query", "scope", "limit"]);
  const query = requireText(input.query, "query").trim();
  const scope = parseScope(input.scope);
  return {
    query,
    scope,
    limit: parseBoundedInteger(input.limit, "limit", 10, 1, 20)
  };
}

export function parseGraphTraverseInput(value: unknown): GraphTraverseInput {
  const input = requireObject(value, "tool input");
  assertOnlyKeys(input, [
    "start_node_id",
    "direction",
    "max_depth",
    "limit"
  ]);
  const direction = requireText(input.direction, "direction");
  if (!["parent", "replies", "both"].includes(direction)) {
    throw new ToolInputError(
      "direction must be one of parent, replies, or both"
    );
  }
  return {
    start_node_id: requireText(input.start_node_id, "start_node_id"),
    direction: direction as GraphTraverseInput["direction"],
    max_depth: parseBoundedInteger(
      input.max_depth,
      "max_depth",
      1,
      1,
      3
    ),
    limit: parseBoundedInteger(input.limit, "limit", 10, 1, 20)
  };
}

function parseScope(value: unknown): RetrievalScope {
  if (value === undefined) return "current_conversation";
  if (
    value === "current_conversation" ||
    value === "agent_conversations"
  ) {
    return value;
  }
  throw new ToolInputError(
    "scope must be current_conversation or agent_conversations"
  );
}

function requireObject(
  value: unknown,
  field: string
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ToolInputError(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ToolInputError(`${field} must be a non-empty string`);
  }
  return value;
}

function parseBoundedInteger(
  value: unknown,
  field: string,
  defaultValue: number,
  minimum: number,
  maximum: number
): number {
  if (value === undefined) return defaultValue;
  if (
    !Number.isInteger(value) ||
    (value as number) < minimum ||
    (value as number) > maximum
  ) {
    throw new ToolInputError(
      `${field} must be an integer from ${minimum} through ${maximum}`
    );
  }
  return value as number;
}

function assertOnlyKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[]
): void {
  const allowed = new Set(allowedKeys);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new ToolInputError(
      `tool input contains unknown fields: ${unknown.join(",")}`
    );
  }
}
