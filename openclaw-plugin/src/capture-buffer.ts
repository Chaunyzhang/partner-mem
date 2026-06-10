import { hashText } from "../../src/core/hash.js";
import type { RawMessageInput, RawTurnInput } from "../../src/ingest/raw-ingest.js";
import type { PartnerMemOpenClawConfig } from "./config.js";

export interface OpenClawCaptureState {
  bufferCursor: number;
  pendingMessages: RawMessageInput[];
}

export interface OpenClawCaptureIdentity {
  agent_id: string;
  session_id: string;
}

export type OpenClawCapturedTurn = RawTurnInput;

export function createOpenClawCaptureState(): OpenClawCaptureState {
  return {
    bufferCursor: -1,
    pendingMessages: []
  };
}

export function selectNewCaptureMessages(
  messages: RawMessageInput[],
  cursor: number,
  config: Pick<PartnerMemOpenClawConfig, "captureMaxCharsPerMessage">
): RawMessageInput[] {
  const byMessageIndex = new Map<number, RawMessageInput>();

  for (const message of messages) {
    if (message.message_index <= cursor) continue;
    if (isOpenClawChannelMetadataMessage(message)) continue;
    if (message.text.length > config.captureMaxCharsPerMessage) continue;
    if (byMessageIndex.has(message.message_index)) continue;
    byMessageIndex.set(message.message_index, message);
  }

  return [...byMessageIndex.values()].sort((left, right) => left.message_index - right.message_index);
}

function isOpenClawChannelMetadataMessage(message: RawMessageInput): boolean {
  return message.text.startsWith("Conversation info (untrusted metadata)");
}

export function appendCaptureMessages(state: OpenClawCaptureState, messages: RawMessageInput[]): void {
  if (messages.length === 0) return;

  const pendingIndexes = new Set(state.pendingMessages.map((message) => message.message_index));
  for (const message of messages) {
    if (pendingIndexes.has(message.message_index)) continue;
    state.pendingMessages.push(message);
    pendingIndexes.add(message.message_index);
    state.bufferCursor = Math.max(state.bufferCursor, message.message_index);
  }

  state.pendingMessages.sort((left, right) => left.message_index - right.message_index);
}

export function estimateCaptureTokens(messages: RawMessageInput[]): number {
  return messages.reduce((sum, message) => sum + message.text.length, 0);
}

export function collectFlushableTurns(
  state: OpenClawCaptureState,
  identity: OpenClawCaptureIdentity,
  config: Pick<PartnerMemOpenClawConfig, "captureFlushMaxTokens" | "captureFlushMaxTurns">
): OpenClawCapturedTurn[] {
  const completeTurns = collectUserAnchoredTurnMessages(state.pendingMessages);
  if (completeTurns.length === 0) return [];

  const completeMessages = completeTurns.flat();
  if (
    completeTurns.length < config.captureFlushMaxTurns &&
    estimateCaptureTokens(completeMessages) < config.captureFlushMaxTokens
  ) {
    return [];
  }

  return completeTurns.map((messages) => ({
    agent_id: identity.agent_id,
    session_id: identity.session_id,
    turn_id: createCapturedTurnId(identity, messages),
    turn_index: messages[0]?.message_index ?? 0,
    messages
  }));
}

export function markCaptureTurnsFlushed(
  state: OpenClawCaptureState,
  flushedTurns: OpenClawCapturedTurn[]
): void {
  if (flushedTurns.length === 0) return;

  const flushedIndexes = new Set(
    flushedTurns.flatMap((turn) => turn.messages.map((message) => message.message_index))
  );
  const lastFlushedIndex = Math.max(...flushedIndexes);
  state.pendingMessages = state.pendingMessages.filter(
    (message) => message.message_index > lastFlushedIndex && !flushedIndexes.has(message.message_index)
  );
}

function collectUserAnchoredTurnMessages(messages: RawMessageInput[]): RawMessageInput[][] {
  const turns: RawMessageInput[][] = [];
  let index = 0;

  while (index < messages.length) {
    while (index < messages.length && messages[index]?.role !== "user") {
      index += 1;
    }
    if (index >= messages.length) break;

    const turnStart = index;
    index += 1;
    while (index < messages.length && messages[index]?.role === "assistant") {
      index += 1;
    }

    turns.push(messages.slice(turnStart, index));
  }

  return turns;
}

function createCapturedTurnId(identity: OpenClawCaptureIdentity, messages: RawMessageInput[]): string {
  const firstMessageIndex = messages[0]?.message_index ?? -1;
  const lastMessageIndex = messages[messages.length - 1]?.message_index ?? firstMessageIndex;

  return `openclaw-turn-${hashText(
    JSON.stringify({
      agent_id: identity.agent_id,
      session_id: identity.session_id,
      first_message_index: firstMessageIndex,
      last_message_index: lastMessageIndex,
      message_hashes: messages.map((message) => hashText(`${message.role}\n${message.text}`))
    })
  )}`;
}
