import type { RawMessageInput } from "../../src/ingest/raw-ingest.js";
import { normalizeHostTurn } from "../../src/adapters/adapter-contracts.js";

export interface OpenClawSessionIdentity {
  agent_id: string;
  session_id: string;
}

export interface OpenClawVisibleMessageExtractionDiagnostics {
  injection_stripped_count: number;
}

export function extractOpenClawVisibleMessages(
  messages: unknown[],
  diagnostics?: OpenClawVisibleMessageExtractionDiagnostics
): RawMessageInput[] {
  const observedAt = new Date().toISOString();
  const visibleMessages: RawMessageInput[] = [];

  messages.forEach((message, sourceIndex) => {
    if (!isRecord(message)) return;
    if (!isScreenVisibleRecord(message)) return;
    const role = message.role;
    if (role !== "user" && role !== "assistant") return;

    const { text, stripped_count } = extractMessageText(message);
    if (diagnostics) diagnostics.injection_stripped_count += stripped_count;
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

export function resolveOpenClawSessionIdentity(_event: unknown, ctx: unknown): OpenClawSessionIdentity | undefined {
  const ctxRecord = isRecord(ctx) ? ctx : {};
  const agentId = readString(ctxRecord.agentId);
  const sessionId =
    readString(ctxRecord.sessionKey) ??
    readString(ctxRecord.sessionId);

  if (!agentId || !sessionId) return undefined;

  return {
    agent_id: agentId,
    session_id: sessionId
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

function extractMessageText(message: Record<string, unknown>): { text: string; stripped_count: number } {
  const content = message.content;
  if (typeof content === "string") return removePartnerMemInjectedContext(content);
  if (Array.isArray(content)) {
    const text = content
      .map((block) => {
        if (!isRecord(block)) return "";
        if (!isScreenVisibleRecord(block)) return "";
        return block.type === "text" && typeof block.text === "string" ? block.text : "";
      })
      .join("");
    return removePartnerMemInjectedContext(text);
  }

  return removePartnerMemInjectedContext(readString(message.text) ?? readString(message.message) ?? "");
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

export function removePartnerMemInjectedContext(text: string): { text: string; stripped_count: number } {
  const lines = text.split(/\r?\n/u);
  const keptLines: string[] = [];
  let index = 0;
  let strippedCount = 0;

  while (index < lines.length) {
    const header = lines[index]?.trim();
    if (!header || !PARTNER_MEM_CONTEXT_HEADERS.has(header)) {
      keptLines.push(lines[index] ?? "");
      index += 1;
      continue;
    }

    strippedCount += 1;
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

  return {
    text: keptLines.join("\n"),
    stripped_count: strippedCount
  };
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
