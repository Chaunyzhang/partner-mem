import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "@photostructure/sqlite";
import { hashText } from "../core/hash.js";
import { RawIngestService } from "../ingest/raw-ingest.js";
import { GraphStore } from "../storage/graph-store.js";
import { initializeSchema, type SqliteDatabase } from "../storage/schema.js";
import { TOOL_NAMES, toolSchemas, type ToolName } from "../tools/tool-contracts.js";
import { readMemoryScope, sessionIdForMemoryScope } from "../tools/tool-scope.js";
import { ToolFacade } from "../tools/tool-facade.js";
import {
  PARTNER_MEM_RUNTIME_CAPABILITIES,
  PARTNER_MEM_RUNTIME_PROTOCOL_VERSION,
  PartnerMemRuntimeError,
  type AssembleContextCommand,
  type AssembleContextResult,
  type CaptureTurnCommand,
  type CaptureTurnResult,
  type InvokeToolCommand,
  type InvokeToolResult,
  type PartnerMemRuntime,
  type PartnerMemRuntimeCommand,
  type PartnerMemRuntimeDescriptor,
  type PartnerMemRuntimeIdentity,
  type PartnerMemRuntimeResult,
  type PartnerMemRuntimeStartInput
} from "./runtime-contracts.js";

type RuntimeDatabase = SqliteDatabase & { close?: () => void };
const RUNTIME_DATABASE_BUSY_TIMEOUT_MS = 5_000;
const ASSEMBLE_CONTEXT_BUSY_TIMEOUT_MS = 25;

export function createPartnerMemRuntime(): PartnerMemRuntime {
  return new PartnerMemRuntimeImplementation();
}

export type {
  AssembleContextCommand,
  AssembleContextResult,
  CaptureTurnCommand,
  CaptureTurnResult,
  InvokeToolCommand,
  InvokeToolResult,
  PartnerMemRuntime,
  PartnerMemRuntimeCommand,
  PartnerMemRuntimeDescriptor,
  PartnerMemRuntimeIdentity,
  PartnerMemRuntimeResult,
  PartnerMemRuntimeStartInput
} from "./runtime-contracts.js";

class PartnerMemRuntimeImplementation implements PartnerMemRuntime {
  private state: "new" | "started" | "closed" = "new";
  private db: RuntimeDatabase | undefined;
  private store: GraphStore | undefined;
  private ingest: RawIngestService | undefined;
  private facade: ToolFacade | undefined;
  private clientHost: string | undefined;

  async start(input: PartnerMemRuntimeStartInput): Promise<PartnerMemRuntimeDescriptor> {
    if (this.state === "closed") {
      throw new PartnerMemRuntimeError("runtime_closed", false, "Partner-Mem runtime is closed");
    }
    if (this.state === "started") {
      throw new PartnerMemRuntimeError("runtime_already_started", false, "Partner-Mem runtime is already started");
    }
    validateStartInput(input);
    const clientHost = input.client.host.trim();

    const stateDir = input.state_dir.trim();
    mkdirSync(stateDir, { recursive: true });
    const db = new DatabaseSync(join(stateDir, "partner-mem.db"), {
      timeout: RUNTIME_DATABASE_BUSY_TIMEOUT_MS
    }) as RuntimeDatabase;
    try {
      initializeSchema(db);
      const store = new GraphStore(db);
      this.db = db;
      this.store = store;
      this.ingest = new RawIngestService(store);
      this.facade = new ToolFacade(store);
      this.clientHost = clientHost;
      this.state = "started";
    } catch (error) {
      db.close?.();
      throw error;
    }

    return runtimeDescriptor();
  }

  async execute(command: PartnerMemRuntimeCommand): Promise<PartnerMemRuntimeResult> {
    this.requireStarted();
    if (!isRecord(command)) {
      throw new PartnerMemRuntimeError("invalid_request", false, "Runtime command must be an object");
    }

    switch (command.kind) {
      case "capture_turn":
        return this.captureTurn(command);
      case "assemble_context":
        return this.assembleContext(command);
      case "invoke_tool":
        return this.invokeTool(command);
      default:
        return assertNever(command);
    }
  }

  async close(): Promise<void> {
    if (this.state === "closed") return;
    this.db?.close?.();
    this.db = undefined;
    this.store = undefined;
    this.ingest = undefined;
    this.facade = undefined;
    this.clientHost = undefined;
    this.state = "closed";
  }

  private captureTurn(command: CaptureTurnCommand): CaptureTurnResult {
    const identity = this.validateIdentity(command.identity);
    if (identity.agent_context !== "primary") {
      throw new PartnerMemRuntimeError(
        "untrusted_identity",
        false,
        "Partner-Mem automatic capture requires a primary agent context"
      );
    }
    const operationId = requireNonEmptyString(command.operation_id, "operation_id");
    const userContent = requireString(command.user_content, "user_content");
    const assistantContent = requireString(command.assistant_content, "assistant_content");
    const observedAt = requireNonEmptyString(command.observed_at, "observed_at");
    if (!userContent.trim() && !assistantContent.trim()) {
      throw new PartnerMemRuntimeError("invalid_request", false, "capture_turn requires visible content");
    }

    const payloadHash = hashText(
      canonicalJson({
        kind: "capture_turn",
        identity,
        user_content: userContent,
        assistant_content: assistantContent,
        observed_at: observedAt
      })
    );
    const store = this.requireStore();
    const ingest = this.requireIngest();

    return store.transaction(() => {
      const receipt = store.getRuntimeOperationReceipt({
        operation_id: operationId,
        host: identity.host,
        agent_id: identity.agent_id
      });
      if (receipt) {
        if (receipt.payload_hash !== payloadHash) {
          throw new PartnerMemRuntimeError(
            "idempotency_conflict",
            false,
            `Operation ${operationId} was already committed with a different payload`
          );
        }
        return parseCaptureResult(receipt.result_json);
      }

      const committedAt = new Date().toISOString();
      const turnIndex = store.allocateRuntimeTurnIndex({
        agent_id: identity.agent_id,
        session_id: identity.session_id,
        updated_at: committedAt
      });
      const messages = [
        ...(userContent.trim()
          ? [{ role: "user" as const, text: userContent, observed_at: observedAt, message_index: 0 }]
          : []),
        ...(assistantContent.trim()
          ? [{ role: "assistant" as const, text: assistantContent, observed_at: observedAt, message_index: 1 }]
          : [])
      ];
      const ingestResult = ingest.ingestTurn({
        agent_id: identity.agent_id,
        session_id: identity.session_id,
        turn_id: operationId,
        turn_index: turnIndex,
        messages
      });
      const result: CaptureTurnResult = { turn_index: turnIndex, ...ingestResult };

      store.insertRuntimeOperationReceipt({
        operation_id: operationId,
        host: identity.host,
        agent_id: identity.agent_id,
        session_id: identity.session_id,
        operation_kind: "capture_turn",
        payload_hash: payloadHash,
        result_json: JSON.stringify(result),
        committed_at: committedAt
      });
      return result;
    });
  }

  private assembleContext(command: AssembleContextCommand): AssembleContextResult {
    const identity = this.validateIdentity(command.identity);
    const query = requireNonEmptyString(command.query, "query");
    const limit = requireLimit(command.limit);
    return this.withDatabaseBusyTimeout(ASSEMBLE_CONTEXT_BUSY_TIMEOUT_MS, () => {
      const packet = this.requireFacade().partner_mem_recall({
        query,
        agent_id: identity.agent_id,
        limit
      });
      const lines = packet.evidence_items.map((item) => `- ${item.role}: ${oneLine(item.text)}`);
      return {
        text: lines.length > 0 ? ["## Partner-Mem verified raw evidence", ...lines].join("\n") : ""
      };
    });
  }

  private invokeTool(command: InvokeToolCommand): InvokeToolResult {
    const identity = this.validateIdentity(command.identity);
    if (!TOOL_NAMES.includes(command.tool_name)) {
      throw new PartnerMemRuntimeError("invalid_request", false, `Unknown Partner-Mem tool: ${String(command.tool_name)}`);
    }
    rejectCallerControlledIdentity(command.arguments);
    const arguments_ = validateToolArguments(command.tool_name, command.arguments);
    const input = bindTrustedToolIdentity(command.tool_name, arguments_, identity);
    const facade = this.requireFacade();

    switch (command.tool_name) {
      case "partner_mem_search":
        return {
          result: facade.partner_mem_search(input as unknown as Parameters<ToolFacade["partner_mem_search"]>[0])
        };
      case "partner_mem_recall":
        return {
          result: facade.partner_mem_recall(input as unknown as Parameters<ToolFacade["partner_mem_recall"]>[0])
        };
      case "partner_mem_timeline":
        return {
          result: facade.partner_mem_timeline(input as unknown as Parameters<ToolFacade["partner_mem_timeline"]>[0])
        };
      case "partner_mem_status":
        return { result: facade.partner_mem_status() };
    }
  }

  private requireStarted(): void {
    if (this.state === "new") {
      throw new PartnerMemRuntimeError("runtime_not_started", false, "Partner-Mem runtime has not been started");
    }
    if (this.state === "closed") {
      throw new PartnerMemRuntimeError("runtime_closed", false, "Partner-Mem runtime is closed");
    }
  }

  private requireStore(): GraphStore {
    if (!this.store) throw new PartnerMemRuntimeError("runtime_not_started", false, "Runtime store is unavailable");
    return this.store;
  }

  private requireIngest(): RawIngestService {
    if (!this.ingest) throw new PartnerMemRuntimeError("runtime_not_started", false, "Runtime ingest is unavailable");
    return this.ingest;
  }

  private requireFacade(): ToolFacade {
    if (!this.facade) throw new PartnerMemRuntimeError("runtime_not_started", false, "Runtime tools are unavailable");
    return this.facade;
  }

  private withDatabaseBusyTimeout<T>(timeoutMs: number, operation: () => T): T {
    const db = this.requireStore().rawDb();
    db.exec(`PRAGMA busy_timeout = ${timeoutMs}`);
    try {
      return operation();
    } finally {
      db.exec(`PRAGMA busy_timeout = ${RUNTIME_DATABASE_BUSY_TIMEOUT_MS}`);
    }
  }

  private validateIdentity(identity: PartnerMemRuntimeIdentity): PartnerMemRuntimeIdentity {
    const validated = validateIdentity(identity);
    if (!this.clientHost || validated.host !== this.clientHost) {
      throw new PartnerMemRuntimeError(
        "untrusted_identity",
        false,
        "Runtime identity host does not match the started client host"
      );
    }
    return validated;
  }
}

function validateStartInput(input: PartnerMemRuntimeStartInput): void {
  if (!isRecord(input)) {
    throw new PartnerMemRuntimeError("invalid_request", false, "Runtime start input must be an object");
  }
  if (input.protocol_version !== PARTNER_MEM_RUNTIME_PROTOCOL_VERSION) {
    throw new PartnerMemRuntimeError(
      "protocol_mismatch",
      false,
      `Unsupported runtime protocol version: ${String(input.protocol_version)}`
    );
  }
  requireNonEmptyString(input.state_dir, "state_dir");
  if (!isRecord(input.client)) {
    throw new PartnerMemRuntimeError("invalid_request", false, "client must be an object");
  }
  requireNonEmptyString(input.client.name, "client.name");
  requireNonEmptyString(input.client.version, "client.version");
  requireNonEmptyString(input.client.host, "client.host");
  requireNonEmptyString(input.client.host_version, "client.host_version");
}

function validateIdentity(identity: PartnerMemRuntimeIdentity): PartnerMemRuntimeIdentity {
  if (!isRecord(identity)) {
    throw new PartnerMemRuntimeError("untrusted_identity", false, "Trusted runtime identity is required");
  }
  const host = requireIdentityString(identity.host, "host");
  const agentId = requireIdentityString(identity.agent_id, "agent_id");
  const sessionId = requireIdentityString(identity.session_id, "session_id");
  if (!["primary", "subagent", "cron", "flush"].includes(String(identity.agent_context))) {
    throw new PartnerMemRuntimeError("untrusted_identity", false, "Unknown trusted agent context");
  }
  return {
    host,
    agent_id: agentId,
    session_id: sessionId,
    agent_context: identity.agent_context
  };
}

function requireIdentityString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new PartnerMemRuntimeError("untrusted_identity", false, `${name} must be a non-empty trusted string`);
  }
  return value.trim();
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

function requireLimit(value: unknown): number {
  if (!Number.isInteger(value) || typeof value !== "number" || value < 1 || value > 50) {
    throw new PartnerMemRuntimeError("invalid_request", false, "limit must be an integer between 1 and 50");
  }
  return value;
}

function parseCaptureResult(resultJson: string): CaptureTurnResult {
  const result = JSON.parse(resultJson) as CaptureTurnResult;
  if (!Number.isInteger(result.turn_index) || !Array.isArray(result.raw_node_ids)) {
    throw new PartnerMemRuntimeError("internal_error", false, "Stored operation receipt is invalid");
  }
  return result;
}

function bindTrustedToolIdentity(
  name: ToolName,
  input: Record<string, unknown>,
  identity: PartnerMemRuntimeIdentity
): Record<string, unknown> {
  if (name === "partner_mem_status") return {};

  switch (name) {
    case "partner_mem_search":
    case "partner_mem_recall": {
      const scope = readMemoryScope(input.scope);
      const sessionId = sessionIdForMemoryScope(scope, identity.session_id);
      return {
        ...pick(input, ["query", "time_window", "limit"]),
        agent_id: identity.agent_id,
        ...(sessionId ? { session_id: sessionId } : {})
      };
    }
    case "partner_mem_timeline":
      return {
        ...pick(input, ["since", "until", "limit"]),
        agent_id: identity.agent_id,
        session_id: identity.session_id
      };
  }
}

function validateToolArguments(name: ToolName, value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new PartnerMemRuntimeError("invalid_request", false, `${name} arguments must be an object`);
  }

  switch (name) {
    case "partner_mem_search":
    case "partner_mem_recall":
      assertToolArgumentKeys(value, ["query", "scope", "time_window", "limit"], name);
      requireNonEmptyString(value.query, `${name}.query`);
      requirePositiveInteger(value.limit, `${name}.limit`);
      if (value.scope !== undefined) requireMemoryScope(value.scope);
      validateTimeWindow(value.time_window, name);
      return value;
    case "partner_mem_timeline":
      assertToolArgumentKeys(value, ["since", "until", "limit"], name);
      requirePositiveInteger(value.limit, `${name}.limit`);
      validateOptionalString(value.since, `${name}.since`);
      validateOptionalString(value.until, `${name}.until`);
      return value;
    case "partner_mem_status":
      assertToolArgumentKeys(value, [], name);
      return value;
  }
}

function validateTimeWindow(value: unknown, toolName: ToolName): void {
  if (value === undefined) return;
  if (!isRecord(value)) {
    throw new PartnerMemRuntimeError("invalid_request", false, `${toolName}.time_window must be an object`);
  }
  assertToolArgumentKeys(value, ["since", "until"], `${toolName}.time_window`);
  validateOptionalString(value.since, `${toolName}.time_window.since`);
  validateOptionalString(value.until, `${toolName}.time_window.until`);
}

function validateOptionalString(value: unknown, name: string): void {
  if (value !== undefined && typeof value !== "string") {
    throw new PartnerMemRuntimeError("invalid_request", false, `${name} must be a string`);
  }
}

function requirePositiveInteger(value: unknown, name: string): number {
  if (!Number.isInteger(value) || typeof value !== "number" || value < 1 || value > 50) {
    throw new PartnerMemRuntimeError("invalid_request", false, `${name} must be an integer between 1 and 50`);
  }
  return value;
}

function requireMemoryScope(value: unknown): void {
  try {
    readMemoryScope(value);
  } catch {
    throw new PartnerMemRuntimeError(
      "invalid_request",
      false,
      "scope must be current_session or agent_memory"
    );
  }
}

function assertToolArgumentKeys(value: Record<string, unknown>, allowed: string[], name: string): void {
  const allowedKeys = new Set(allowed);
  const unexpected = Object.keys(value).filter((key) => !allowedKeys.has(key));
  if (unexpected.length > 0) {
    throw new PartnerMemRuntimeError(
      "invalid_request",
      false,
      `${name} arguments contain unsupported fields: ${unexpected.join(", ")}`
    );
  }
}

function pick(input: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const key of keys) {
    if (input[key] !== undefined) output[key] = input[key];
  }
  return output;
}

function runtimeDescriptor(): PartnerMemRuntimeDescriptor {
  const hermesSchemas = TOOL_NAMES.map((name) => ({
    name,
    description: toolSchemas[name].description,
    parameters: toolSchemas[name].inputSchema
  }));
  return {
    protocol_version: PARTNER_MEM_RUNTIME_PROTOCOL_VERSION,
    runtime_version: "0.1.0",
    capabilities: [...PARTNER_MEM_RUNTIME_CAPABILITIES],
    tool_schema_digest: hashText(canonicalJson(hermesSchemas))
  };
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortJsonValue(value));
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (!isRecord(value)) return value;

  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    sorted[key] = sortJsonValue(value[key]);
  }
  return sorted;
}

function oneLine(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

function rejectCallerControlledIdentity(args: unknown): void {
  if (!isRecord(args)) return;
  if (Object.hasOwn(args, "agent_id") || Object.hasOwn(args, "session_id") || Object.hasOwn(args, "identity")) {
    throw new PartnerMemRuntimeError(
      "untrusted_identity",
      false,
      "Tool arguments must not provide agent_id or session_id"
    );
  }
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertNever(value: never): never {
  throw new PartnerMemRuntimeError("unknown_method", false, `Unknown runtime command: ${JSON.stringify(value)}`);
}
