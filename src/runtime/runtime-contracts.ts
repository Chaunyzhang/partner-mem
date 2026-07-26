import {
  optionalNonEmptyString,
  requireNonEmptyString,
  requireNonNegativeInteger
} from "../core/contracts.js";
import type {
  RecordAnswerInput,
  RecordQuestionInput,
  RecordReplyInput
} from "../ingest/turn-ingest-service.js";
import {
  MODEL_VISIBLE_TOOL_NAMES,
  type ModelVisibleToolName
} from "../tools/tool-contracts.js";

export type RuntimeCommand =
  | "register_harness"
  | "record_question"
  | "record_answer"
  | "record_reply"
  | "invoke_tool"
  | "get_node";

export interface RuntimeRequest {
  id: string;
  command: RuntimeCommand;
  params: Record<string, unknown>;
}

export type RuntimeResponse =
  | { id: string; ok: true; result: unknown }
  | {
      id: string;
      ok: false;
      error: {
        code: "INVALID_REQUEST" | "UNKNOWN_COMMAND" | "WRITE_REJECTED" | "NOT_FOUND";
        message: string;
      };
    };

export class RuntimeInputError extends TypeError {}

export function parseRuntimeRequest(value: unknown): RuntimeRequest {
  const request = requireObject(value, "request");
  assertOnlyKeys(request, ["id", "command", "params"], "request");
  const id = requireNonEmptyString(request.id, "id");
  const command = requireNonEmptyString(request.command, "command");
  const params = requireObject(request.params, "params");
  if (!isRuntimeCommand(command)) {
    throw new RuntimeInputError(`Unknown runtime command: ${command}`);
  }
  return { id, command, params };
}

export function parseRegisterHarnessParams(params: Record<string, unknown>): {
  harness_type: string;
} {
  assertOnlyKeys(params, ["harness_type"], "register_harness params");
  return { harness_type: requireNonEmptyString(params.harness_type, "harness_type") };
}

export function parseRecordQuestionParams(
  params: Record<string, unknown>
): RecordQuestionInput {
  assertOnlyKeys(
    params,
    [
      "harness_id",
      "source_conversation_id",
      "source_thread_id",
      "text",
      "role",
      "source_message_id",
      "source_author_id",
      "source_access_agent_id",
      "visible_at",
      "display_order"
    ],
    "record_question params"
  );
  return compactOptional({
    harness_id: requireNonEmptyString(params.harness_id, "harness_id"),
    source_conversation_id: requireNonEmptyString(
      params.source_conversation_id,
      "source_conversation_id"
    ),
    source_thread_id: optionalNonEmptyString(params.source_thread_id, "source_thread_id"),
    text: requireNonEmptyString(params.text, "text"),
    role: optionalNonEmptyString(params.role, "role"),
    source_message_id: optionalNonEmptyString(params.source_message_id, "source_message_id"),
    source_author_id: optionalNonEmptyString(params.source_author_id, "source_author_id"),
    source_access_agent_id: optionalNonEmptyString(
      params.source_access_agent_id,
      "source_access_agent_id"
    ),
    visible_at: optionalNonEmptyString(params.visible_at, "visible_at"),
    display_order: requireNonNegativeInteger(params.display_order, "display_order")
  });
}

export function parseRecordAnswerParams(
  params: Record<string, unknown>
): RecordAnswerInput {
  assertOnlyKeys(
    params,
    [
      "harness_id",
      "source_conversation_id",
      "source_thread_id",
      "node_id",
      "question_source_message_id",
      "question_was_absent",
      "question_role",
      "question_source_author_id",
      "question_visible_at",
      "question_display_order",
      "text",
      "role",
      "source_message_id",
      "source_author_id",
      "source_agent_id",
      "source_access_agent_id",
      "visible_at",
      "display_order"
    ],
    "record_answer params"
  );
  const questionWasAbsent = optionalBoolean(
    params.question_was_absent,
    "question_was_absent"
  );
  return compactOptional({
    harness_id: requireNonEmptyString(params.harness_id, "harness_id"),
    source_conversation_id: requireNonEmptyString(
      params.source_conversation_id,
      "source_conversation_id"
    ),
    source_thread_id: optionalNonEmptyString(params.source_thread_id, "source_thread_id"),
    node_id: optionalNonEmptyString(params.node_id, "node_id"),
    question_source_message_id: optionalNonEmptyString(
      params.question_source_message_id,
      "question_source_message_id"
    ),
    question_was_absent: questionWasAbsent,
    question_role: optionalNonEmptyString(params.question_role, "question_role"),
    question_source_author_id: optionalNonEmptyString(
      params.question_source_author_id,
      "question_source_author_id"
    ),
    question_visible_at: optionalNonEmptyString(
      params.question_visible_at,
      "question_visible_at"
    ),
    question_display_order: requireNonNegativeInteger(
      params.question_display_order,
      "question_display_order"
    ),
    text: optionalNonEmptyString(params.text, "text"),
    role: optionalNonEmptyString(params.role, "role"),
    source_message_id: optionalNonEmptyString(params.source_message_id, "source_message_id"),
    source_author_id: optionalNonEmptyString(params.source_author_id, "source_author_id"),
    source_agent_id: optionalNonEmptyString(params.source_agent_id, "source_agent_id"),
    source_access_agent_id: optionalNonEmptyString(
      params.source_access_agent_id,
      "source_access_agent_id"
    ),
    visible_at: optionalNonEmptyString(params.visible_at, "visible_at"),
    display_order: requireNonNegativeInteger(params.display_order, "display_order")
  });
}

export function parseRecordReplyParams(
  params: Record<string, unknown>
): RecordReplyInput {
  assertOnlyKeys(
    params,
    ["harness_id", "from_source_message_id", "to_source_message_id"],
    "record_reply params"
  );
  return {
    harness_id: requireNonEmptyString(params.harness_id, "harness_id"),
    from_source_message_id: requireNonEmptyString(
      params.from_source_message_id,
      "from_source_message_id"
    ),
    to_source_message_id: requireNonEmptyString(
      params.to_source_message_id,
      "to_source_message_id"
    )
  };
}

export function parseGetNodeParams(params: Record<string, unknown>): {
  harness_id: string;
  node_id: string;
} {
  assertOnlyKeys(params, ["harness_id", "node_id"], "get_node params");
  return {
    harness_id: requireNonEmptyString(params.harness_id, "harness_id"),
    node_id: requireNonEmptyString(params.node_id, "node_id")
  };
}

export interface InvokeToolParams {
  harness_id: string;
  source_conversation_id: string;
  source_agent_id?: string | undefined;
  tool_name: ModelVisibleToolName;
  arguments: Record<string, unknown>;
}

export function parseInvokeToolParams(
  params: Record<string, unknown>
): InvokeToolParams {
  assertOnlyKeys(
    params,
    [
      "harness_id",
      "source_conversation_id",
      "source_agent_id",
      "tool_name",
      "arguments"
    ],
    "invoke_tool params"
  );
  const toolName = requireNonEmptyString(params.tool_name, "tool_name");
  if (!MODEL_VISIBLE_TOOL_NAMES.includes(toolName as ModelVisibleToolName)) {
    throw new RuntimeInputError(`Unknown model-visible tool: ${toolName}`);
  }
  const sourceAgentId = optionalNonEmptyString(
    params.source_agent_id,
    "source_agent_id"
  );
  return {
    harness_id: requireNonEmptyString(params.harness_id, "harness_id"),
    source_conversation_id: requireNonEmptyString(
      params.source_conversation_id,
      "source_conversation_id"
    ),
    ...(sourceAgentId === null ? {} : { source_agent_id: sourceAgentId }),
    tool_name: toolName as ModelVisibleToolName,
    arguments: requireObject(params.arguments, "arguments")
  };
}

function isRuntimeCommand(value: string): value is RuntimeCommand {
  return [
    "register_harness",
    "record_question",
    "record_answer",
    "record_reply",
    "invoke_tool",
    "get_node"
  ].includes(value);
}

function requireObject(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new RuntimeInputError(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function assertOnlyKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
  field: string
): void {
  const allowed = new Set(allowedKeys);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new RuntimeInputError(`${field} contains unknown fields: ${unknown.join(",")}`);
  }
}

function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") {
    throw new RuntimeInputError(`${field} must be a boolean`);
  }
  return value;
}

function compactOptional<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, fieldValue]) => fieldValue !== null && fieldValue !== undefined)
  ) as T;
}
