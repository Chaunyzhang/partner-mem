import type { RawIngestResult } from "../ingest/raw-ingest.js";
import type { ToolName } from "../tools/tool-contracts.js";

export const PARTNER_MEM_RUNTIME_PROTOCOL_VERSION = 1 as const;

export const PARTNER_MEM_RUNTIME_CAPABILITIES = [
  "context.assemble.v1",
  "turn.capture.v1",
  "tools.invoke.v1"
] as const;

export type PartnerMemRuntimeCapability = (typeof PARTNER_MEM_RUNTIME_CAPABILITIES)[number];

export interface PartnerMemRuntimeClient {
  name: string;
  version: string;
  host: string;
  host_version: string;
}

export interface PartnerMemRuntimeStartInput {
  protocol_version: typeof PARTNER_MEM_RUNTIME_PROTOCOL_VERSION;
  state_dir: string;
  client: PartnerMemRuntimeClient;
}

export interface PartnerMemRuntimeDescriptor {
  protocol_version: typeof PARTNER_MEM_RUNTIME_PROTOCOL_VERSION;
  runtime_version: "0.1.0";
  capabilities: PartnerMemRuntimeCapability[];
  tool_schema_digest: string;
}

export type PartnerMemAgentContext = "primary" | "subagent" | "cron" | "flush";

export interface PartnerMemRuntimeIdentity {
  host: string;
  agent_id: string;
  session_id: string;
  agent_context: PartnerMemAgentContext;
}

export interface CaptureTurnCommand {
  kind: "capture_turn";
  operation_id: string;
  identity: PartnerMemRuntimeIdentity;
  user_content: string;
  assistant_content: string;
  observed_at: string;
}

export interface AssembleContextCommand {
  kind: "assemble_context";
  identity: PartnerMemRuntimeIdentity;
  query: string;
  limit: number;
}

export interface InvokeToolCommand {
  kind: "invoke_tool";
  identity: PartnerMemRuntimeIdentity;
  tool_name: ToolName;
  arguments: unknown;
}

export type PartnerMemRuntimeCommand = CaptureTurnCommand | AssembleContextCommand | InvokeToolCommand;

export interface CaptureTurnResult extends RawIngestResult {
  turn_index: number;
}

export interface AssembleContextResult {
  text: string;
}

export interface InvokeToolResult {
  result: unknown;
}

export type PartnerMemRuntimeResult = CaptureTurnResult | AssembleContextResult | InvokeToolResult;

export type PartnerMemRuntimeErrorCode =
  | "protocol_mismatch"
  | "invalid_request"
  | "runtime_not_started"
  | "runtime_already_started"
  | "runtime_closed"
  | "untrusted_identity"
  | "idempotency_conflict"
  | "unknown_method"
  | "internal_error";

export class PartnerMemRuntimeError extends Error {
  constructor(
    public readonly code: PartnerMemRuntimeErrorCode,
    public readonly retryable: boolean,
    message: string
  ) {
    super(message);
    this.name = "PartnerMemRuntimeError";
  }
}

export interface PartnerMemRuntime {
  start(input: PartnerMemRuntimeStartInput): Promise<PartnerMemRuntimeDescriptor>;
  execute(command: PartnerMemRuntimeCommand): Promise<PartnerMemRuntimeResult>;
  close(): Promise<void>;
}
