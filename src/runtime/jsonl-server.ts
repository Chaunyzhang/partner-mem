import { once } from "node:events";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { TOOL_NAMES, type ToolName } from "../tools/tool-contracts.js";
import { createPartnerMemRuntime } from "./partner-mem-runtime.js";
import {
  PARTNER_MEM_RUNTIME_PROTOCOL_VERSION,
  PartnerMemRuntimeError,
  type PartnerMemRuntime,
  type PartnerMemRuntimeClient,
  type PartnerMemRuntimeIdentity
} from "./runtime-contracts.js";

export interface PartnerMemJsonlServerIo {
  input: Readable;
  output: Writable;
  error: Writable;
}

interface WireRequest {
  protocol_version: unknown;
  request_id: unknown;
  method: unknown;
  params: unknown;
}

interface WireSuccessResponse {
  protocol_version: typeof PARTNER_MEM_RUNTIME_PROTOCOL_VERSION;
  request_id: string;
  ok: true;
  result: unknown;
}

interface WireErrorResponse {
  protocol_version: typeof PARTNER_MEM_RUNTIME_PROTOCOL_VERSION;
  request_id: string | null;
  ok: false;
  error: {
    code: string;
    message: string;
    retryable: boolean;
  };
}

type WireResponse = WireSuccessResponse | WireErrorResponse;

interface HandledLine {
  response: WireResponse;
  closeRequested: boolean;
}

export async function runPartnerMemJsonlServer(io: PartnerMemJsonlServerIo): Promise<void> {
  const runtime = createPartnerMemRuntime();
  const lines = createInterface({ input: io.input, crlfDelay: Infinity });

  try {
    for await (const line of lines) {
      if (!line.trim()) continue;
      const handled = await handleLine(runtime, line, io.error);
      await writeJsonLine(io.output, handled.response);
      if (handled.closeRequested) {
        lines.close();
        break;
      }
    }
  } finally {
    await runtime.close();
  }
}

async function handleLine(runtime: PartnerMemRuntime, line: string, errorOutput: Writable): Promise<HandledLine> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return {
      response: wireError(null, new PartnerMemRuntimeError("invalid_request", false, "Request line must be valid JSON")),
      closeRequested: false
    };
  }

  const requestId = readRequestId(parsed);
  try {
    const request = validateEnvelope(parsed);
    const result = await dispatch(runtime, request);
    return {
      response: {
        protocol_version: PARTNER_MEM_RUNTIME_PROTOCOL_VERSION,
        request_id: request.request_id as string,
        ok: true,
        result
      },
      closeRequested: request.method === "runtime.close"
    };
  } catch (error) {
    if (!(error instanceof PartnerMemRuntimeError)) {
      errorOutput.write(`Partner-Mem JSONL internal error: ${error instanceof Error ? error.message : String(error)}\n`);
    }
    return { response: wireError(requestId, normalizeRuntimeError(error)), closeRequested: false };
  }
}

function validateEnvelope(value: unknown): WireRequest {
  if (!isRecord(value)) {
    throw new PartnerMemRuntimeError("invalid_request", false, "Request envelope must be an object");
  }
  assertOnlyKeys(value, ["protocol_version", "request_id", "method", "params"], "request envelope");
  requireRequestId(value.request_id);
  if (value.protocol_version !== PARTNER_MEM_RUNTIME_PROTOCOL_VERSION) {
    throw new PartnerMemRuntimeError(
      "protocol_mismatch",
      false,
      `Unsupported protocol version: ${String(value.protocol_version)}`
    );
  }
  requireNonEmptyString(value.method, "method");
  requireRecord(value.params, "params");
  return value as unknown as WireRequest;
}

async function dispatch(runtime: PartnerMemRuntime, request: WireRequest): Promise<unknown> {
  const method = request.method as string;
  const params = request.params as Record<string, unknown>;

  switch (method) {
    case "runtime.start": {
      assertOnlyKeys(params, ["state_dir", "client"], "runtime.start params");
      const client = requireRecord(params.client, "client");
      assertOnlyKeys(client, ["name", "version", "host", "host_version"], "runtime client");
      return runtime.start({
        protocol_version: PARTNER_MEM_RUNTIME_PROTOCOL_VERSION,
        state_dir: requireNonEmptyString(params.state_dir, "state_dir"),
        client: client as unknown as PartnerMemRuntimeClient
      });
    }
    case "memory.capture_turn":
      assertOnlyKeys(
        params,
        ["operation_id", "identity", "user_content", "assistant_content", "observed_at"],
        "memory.capture_turn params"
      );
      return runtime.execute({
        kind: "capture_turn",
        operation_id: requireNonEmptyString(params.operation_id, "operation_id"),
        identity: requireIdentity(params.identity),
        user_content: requireString(params.user_content, "user_content"),
        assistant_content: requireString(params.assistant_content, "assistant_content"),
        observed_at: requireNonEmptyString(params.observed_at, "observed_at")
      });
    case "memory.assemble_context":
      assertOnlyKeys(params, ["identity", "query", "limit"], "memory.assemble_context params");
      return runtime.execute({
        kind: "assemble_context",
        identity: requireIdentity(params.identity),
        query: requireNonEmptyString(params.query, "query"),
        limit: requireInteger(params.limit, "limit")
      });
    case "tools.invoke": {
      assertOnlyKeys(params, ["identity", "tool_name", "arguments"], "tools.invoke params");
      const toolName = requireNonEmptyString(params.tool_name, "tool_name");
      if (!TOOL_NAMES.includes(toolName as ToolName)) {
        throw new PartnerMemRuntimeError("invalid_request", false, `Unknown Partner-Mem tool: ${toolName}`);
      }
      return runtime.execute({
        kind: "invoke_tool",
        identity: requireIdentity(params.identity),
        tool_name: toolName as ToolName,
        arguments: params.arguments
      });
    }
    case "runtime.close":
      assertOnlyKeys(params, [], "runtime.close params");
      await runtime.close();
      return { closed: true };
    default:
      throw new PartnerMemRuntimeError("unknown_method", false, `Unknown JSONL method: ${method}`);
  }
}

function requireIdentity(value: unknown): PartnerMemRuntimeIdentity {
  const identity = requireRecord(value, "identity");
  assertOnlyKeys(identity, ["host", "agent_id", "session_id", "agent_context"], "identity");
  return identity as unknown as PartnerMemRuntimeIdentity;
}

function readRequestId(value: unknown): string | null {
  if (!isRecord(value)) return null;
  return typeof value.request_id === "string" && value.request_id.trim() ? value.request_id : null;
}

function requireRequestId(value: unknown): string {
  return requireNonEmptyString(value, "request_id");
}

function requireRecord(value: unknown, name: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new PartnerMemRuntimeError("invalid_request", false, `${name} must be an object`);
  }
  return value;
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string") {
    throw new PartnerMemRuntimeError("invalid_request", false, `${name} must be a string`);
  }
  return value;
}

function requireNonEmptyString(value: unknown, name: string): string {
  const text = requireString(value, name).trim();
  if (!text) {
    throw new PartnerMemRuntimeError("invalid_request", false, `${name} must not be empty`);
  }
  return text;
}

function requireInteger(value: unknown, name: string): number {
  if (!Number.isInteger(value) || typeof value !== "number") {
    throw new PartnerMemRuntimeError("invalid_request", false, `${name} must be an integer`);
  }
  return value;
}

function assertOnlyKeys(value: Record<string, unknown>, allowed: string[], name: string): void {
  const allowedKeys = new Set(allowed);
  const unexpected = Object.keys(value).filter((key) => !allowedKeys.has(key));
  if (unexpected.length > 0) {
    throw new PartnerMemRuntimeError(
      "invalid_request",
      false,
      `${name} contains unsupported fields: ${unexpected.join(", ")}`
    );
  }
}

function normalizeRuntimeError(error: unknown): PartnerMemRuntimeError {
  if (error instanceof PartnerMemRuntimeError) return error;
  return new PartnerMemRuntimeError("internal_error", false, "Partner-Mem runtime failed unexpectedly");
}

function wireError(requestId: string | null, error: PartnerMemRuntimeError): WireErrorResponse {
  return {
    protocol_version: PARTNER_MEM_RUNTIME_PROTOCOL_VERSION,
    request_id: requestId,
    ok: false,
    error: {
      code: error.code,
      message: error.message,
      retryable: error.retryable
    }
  };
}

async function writeJsonLine(output: Writable, response: WireResponse): Promise<void> {
  if (!output.write(`${JSON.stringify(response)}\n`)) {
    await once(output, "drain");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

if (isMainModule()) {
  runPartnerMemJsonlServer({ input: process.stdin, output: process.stdout, error: process.stderr }).catch(
    (error: unknown) => {
      process.stderr.write(`Partner-Mem JSONL server failed: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    }
  );
}

function isMainModule(): boolean {
  const argvPath = process.argv[1];
  if (!argvPath) return false;
  try {
    return realpathSync(argvPath) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}
