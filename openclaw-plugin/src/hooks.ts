import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { hashText } from "../../src/core/hash.js";
import type { RawMessageInput } from "../../src/ingest/raw-ingest.js";
import {
  extractOpenClawVisibleMessages,
  formatContextBlockForOpenClaw,
  normalizeHostTurn,
  resolveOpenClawTurnIdentity,
  selectCapturableMessages
} from "./openclaw-adapter.js";
import type { PartnerMemOpenClawRuntime } from "./runtime.js";

export function registerPartnerMemHooks(
  api: Pick<OpenClawPluginApi, "on">,
  runtime: PartnerMemOpenClawRuntime
): void {
  api.on("agent_end", (event, ctx) => captureAgentEnd(event, ctx, runtime), {
    timeoutMs: runtime.config.hookTimeoutMs
  });
  api.on("before_prompt_build", (event, ctx) => recallBeforePromptBuild(event, ctx, runtime), {
    timeoutMs: runtime.config.hookTimeoutMs
  });
}

export function captureAgentEnd(
  event: unknown,
  ctx: unknown,
  runtime: PartnerMemOpenClawRuntime
): void {
  if (!runtime.config.autoCapture) return;
  if (isRecord(event) && event.success === false) return;
  if (isPartnerMemInternalEvent(event, ctx)) return;

  try {
    const eventRecord = isRecord(event) ? event : {};
    const rawMessages = Array.isArray(eventRecord.messages) ? eventRecord.messages : [];
    const visibleMessages = extractOpenClawVisibleMessages(rawMessages);
    const selectedMessages = selectCapturableMessages(visibleMessages, runtime.config);
    if (selectedMessages.length === 0) {
      logOversizedOmissions(visibleMessages, runtime);
      return;
    }

    const identity = resolveOpenClawTurnIdentity(event, ctx, runtime, selectedMessages);
    const unseenMessages = selectedMessages.filter(
      (message) => !runtime.hasSeenCapture(createCaptureKey(identity.session_id, identity.turn_id, message))
    );
    if (unseenMessages.length === 0) return;

    const result = runtime.ingest.ingestTurn(
      normalizeHostTurn({
        host: "openclaw",
        ...identity,
        messages: unseenMessages
      })
    );
    runtime.enqueueExtraction(result.raw_node_ids);

    for (const message of unseenMessages) {
      runtime.markCaptureSeen(createCaptureKey(identity.session_id, identity.turn_id, message));
    }
    logOversizedOmissions(visibleMessages, runtime);
    runtime.logger.debug?.("Partner-Mem captured OpenClaw messages", {
      raw_node_count: result.raw_node_ids.length
    });
  } catch (error) {
    runtime.logger.warn?.("Partner-Mem OpenClaw capture skipped after failure", {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

export function recallBeforePromptBuild(
  event: unknown,
  ctx: unknown,
  runtime: PartnerMemOpenClawRuntime
): { appendContext: string } | undefined {
  if (!runtime.config.autoRecall) return undefined;
  if (isPartnerMemInternalEvent(event, ctx)) return undefined;

  const eventRecord = isRecord(event) ? event : {};
  const rawMessages = Array.isArray(eventRecord.messages) ? eventRecord.messages : [];
  const query = latestUserText(rawMessages) ?? readString(eventRecord.prompt);
  if (!query || query.trim().length === 0) return undefined;

  const identity = resolveOpenClawTurnIdentity(event, ctx, runtime);
  const block = runtime.contextAssembler.assembleContext({
    agent_id: identity.agent_id,
    session_id: identity.session_id,
    current_prompt: query,
    budget_tokens: runtime.config.contextBudgetTokens,
    include_recent: true,
    auto_recall: true
  });
  const formatted = formatContextBlockForOpenClaw(block);
  if (formatted.length === 0) return undefined;

  return { appendContext: formatted };
}

function latestUserText(messages: unknown[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!isRecord(message) || message.role !== "user") continue;
    const [visible] = extractOpenClawVisibleMessages([message]);
    if (visible?.text.trim()) return visible.text;
  }
  return undefined;
}

const PARTNER_MEM_INTERNAL_RUN_PREFIX = "partner-mem-extraction-";
const INTERNAL_ID_KEYS = [
  "id",
  "runId",
  "run_id",
  "turnId",
  "turn_id",
  "sessionKey",
  "sessionId",
  "session_id"
];

function isPartnerMemInternalEvent(event: unknown, ctx: unknown): boolean {
  return [event, ctx].some((value) => {
    if (!isRecord(value)) return false;
    return INTERNAL_ID_KEYS.some((key) => readString(value[key])?.startsWith(PARTNER_MEM_INTERNAL_RUN_PREFIX));
  });
}

function createCaptureKey(sessionId: string, turnId: string, message: RawMessageInput): string {
  return `${sessionId}:${turnId}:${message.message_index}:${hashText(message.text)}`;
}

function logOversizedOmissions(
  messages: RawMessageInput[],
  runtime: PartnerMemOpenClawRuntime
): void {
  const omittedCount = messages.filter(
    (message) => message.text.length > runtime.config.captureMaxCharsPerTurn
  ).length;
  if (omittedCount > 0) {
    runtime.logger.warn?.("Partner-Mem skipped oversized OpenClaw messages", {
      omittedCount
    });
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
