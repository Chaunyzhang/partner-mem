import { hashText } from "../../src/core/hash.js";
import type { RawMessageInput } from "../../src/ingest/raw-ingest.js";
import {
  normalizeHostTurn,
  type HostTurnEnvelope
} from "../../src/adapters/adapter-contracts.js";
import type { PartnerMemOpenClawConfig } from "./config.js";
import type { PartnerMemOpenClawRuntime } from "./runtime.js";

export interface OpenClawTurnIdentity {
  agent_id: string;
  session_id: string;
  turn_id: string;
  turn_index: number;
}

export function extractOpenClawVisibleMessages(messages: unknown[]): RawMessageInput[] {
  const observedAt = new Date().toISOString();
  const visibleMessages: RawMessageInput[] = [];

  messages.forEach((message, sourceIndex) => {
    if (!isRecord(message)) return;
    if (!isScreenVisibleRecord(message)) return;
    const role = message.role;
    if (role !== "user" && role !== "assistant") return;

    const text = extractMessageText(message);
    if (text.trim().length === 0) return;

    visibleMessages.push({
      role,
      text,
      observed_at: readString(message.observed_at) ?? readString(message.createdAt) ?? readString(message.timestamp) ?? observedAt,
      message_index: readNonNegativeInteger(message.message_index) ?? readNonNegativeInteger(message.index) ?? sourceIndex
    });
  });

  return visibleMessages;
}

export function selectCapturableMessages(
  messages: RawMessageInput[],
  config: PartnerMemOpenClawConfig
): RawMessageInput[] {
  const selected: RawMessageInput[] = [];
  let selectedChars = 0;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message) continue;
    const messageChars = message.text.length;
    if (messageChars > config.captureMaxCharsPerTurn) continue;
    if (selected.length + 1 > config.captureMaxCompleteMessages) break;
    if (selectedChars + messageChars > config.captureMaxCharsPerTurn) break;
    selected.push(message);
    selectedChars += messageChars;
  }

  return selected.reverse();
}

export function resolveOpenClawTurnIdentity(
  event: unknown,
  ctx: unknown,
  runtime: Pick<PartnerMemOpenClawRuntime, "nextTurnIndex">,
  messages: RawMessageInput[] = []
): OpenClawTurnIdentity {
  const eventRecord = isRecord(event) ? event : {};
  const ctxRecord = isRecord(ctx) ? ctx : {};
  const agentId =
    readString(ctxRecord.agentId) ??
    readString(eventRecord.agentId) ??
    readString(eventRecord.agent_id) ??
    "openclaw-default-agent";
  const sessionId =
    readString(ctxRecord.sessionKey) ??
    readString(ctxRecord.sessionId) ??
    readString(eventRecord.sessionKey) ??
    readString(eventRecord.sessionId) ??
    readString(eventRecord.session_id) ??
    "openclaw-default-session";
  const turnId =
    readString(eventRecord.turnId) ??
    readString(eventRecord.turn_id) ??
    readString(eventRecord.runId) ??
    readString(eventRecord.run_id) ??
    readString(eventRecord.id) ??
    deterministicTurnId(agentId, sessionId, messages);
  const turnIndex =
    readNonNegativeInteger(eventRecord.turnIndex) ??
    readNonNegativeInteger(eventRecord.turn_index) ??
    runtime.nextTurnIndex(sessionId);

  return {
    agent_id: agentId,
    session_id: sessionId,
    turn_id: turnId,
    turn_index: turnIndex
  };
}

export function normalizeOpenClawTurn(
  event: unknown,
  ctx: unknown,
  runtime: Pick<PartnerMemOpenClawRuntime, "config" | "nextTurnIndex">,
  config: PartnerMemOpenClawConfig = runtime.config
): HostTurnEnvelope | undefined {
  const eventRecord = isRecord(event) ? event : {};
  const rawMessages = Array.isArray(eventRecord.messages) ? eventRecord.messages : [];
  const visibleMessages = extractOpenClawVisibleMessages(rawMessages);
  const messages = selectCapturableMessages(visibleMessages, config);
  if (messages.length === 0) return undefined;

  return {
    host: "openclaw",
    ...resolveOpenClawTurnIdentity(event, ctx, runtime, messages),
    messages
  };
}

export function formatContextBlockForOpenClaw(block: {
  recent_raw_timeline: Array<{ role: string; text: string }>;
  verified_evidence: Array<{ role: string; text: string }>;
  safety_instructions: string[];
}): string {
  if (block.verified_evidence.length === 0 && block.recent_raw_timeline.length === 0) {
    return "";
  }

  const sections: string[] = [];

  if (block.verified_evidence.length > 0) {
    sections.push(
      "Partner-Mem verified raw evidence:",
      ...block.verified_evidence.map((item) => `- ${item.role}: ${item.text}`)
    );
  }

  if (block.recent_raw_timeline.length > 0) {
    sections.push(
      "Partner-Mem recent raw timeline:",
      ...block.recent_raw_timeline.map((item) => `- ${item.role}: ${item.text}`)
    );
  }

  if (block.safety_instructions.length > 0) {
    sections.push(
      "Partner-Mem safety instructions:",
      ...block.safety_instructions.map((instruction) => `- ${instruction}`)
    );
  }

  return sections.join("\n").trim();
}

export { normalizeHostTurn };

function extractMessageText(message: Record<string, unknown>): string {
  const content = message.content;
  if (typeof content === "string") return stripLeadingPartnerMemContextBlocks(content);
  if (Array.isArray(content)) {
    const text = content
      .map((block) => {
        if (!isRecord(block)) return "";
        if (!isScreenVisibleRecord(block)) return "";
        return block.type === "text" && typeof block.text === "string" ? block.text : "";
      })
      .join("");
    return stripLeadingPartnerMemContextBlocks(text);
  }

  return stripLeadingPartnerMemContextBlocks(readString(message.text) ?? readString(message.message) ?? "");
}

const INTERNAL_VISIBILITY_VALUES = new Set([
  "debug",
  "hidden",
  "internal",
  "metadata",
  "model",
  "private",
  "reasoning",
  "system",
  "thinking",
  "tool",
  "tools",
  "trace"
]);

const PARTNER_MEM_CONTEXT_HEADERS = new Set([
  "Partner-Mem verified raw evidence:",
  "Partner-Mem recent raw timeline:",
  "Partner-Mem safety instructions:"
]);

function isScreenVisibleRecord(record: Record<string, unknown>): boolean {
  if (record.hidden === true || record.isHidden === true || record.private === true) return false;
  if (record.visible === false || record.isVisible === false) return false;

  for (const key of ["visibility", "audience", "channel", "scope", "kind"]) {
    const value = readString(record[key]);
    if (value && INTERNAL_VISIBILITY_VALUES.has(value.toLowerCase())) return false;
  }

  return true;
}

function stripLeadingPartnerMemContextBlocks(text: string): string {
  const lines = text.split(/\r?\n/u);
  let index = 0;
  let removed = false;

  while (index < lines.length) {
    while (index < lines.length && lines[index]?.trim() === "") {
      index += 1;
    }

    const header = lines[index]?.trim();
    if (!header || !PARTNER_MEM_CONTEXT_HEADERS.has(header)) break;

    removed = true;
    index += 1;

    while (index < lines.length) {
      const trimmed = lines[index]?.trim() ?? "";
      if (PARTNER_MEM_CONTEXT_HEADERS.has(trimmed)) break;
      if (trimmed === "" || trimmed.startsWith("- ")) {
        index += 1;
        continue;
      }
      break;
    }
  }

  if (!removed) return text;

  while (index < lines.length && lines[index]?.trim() === "") {
    index += 1;
  }

  return lines.slice(index).join("\n");
}

function deterministicTurnId(agentId: string, sessionId: string, messages: RawMessageInput[]): string {
  return `openclaw-${hashText(
    JSON.stringify({
      agentId,
      sessionId,
      messages: messages.map((message) => ({
        role: message.role,
        text: message.text,
        message_index: message.message_index
      }))
    })
  )}`;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readNonNegativeInteger(value: unknown): number | undefined {
  return Number.isInteger(value) && typeof value === "number" && value >= 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
