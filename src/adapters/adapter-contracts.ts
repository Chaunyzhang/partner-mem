import type { RawMessageInput, RawTurnInput } from "../ingest/raw-ingest.js";

export const HOSTS = ["mcp", "codex", "claude_code", "openclaw", "generic"] as const;
export type Host = (typeof HOSTS)[number];

export interface HostTurnEnvelope {
  host: Host;
  agent_id: string;
  session_id: string;
  turn_id: string;
  turn_index: number;
  messages: RawMessageInput[];
}

export type CoreTurn = RawTurnInput;

export function normalizeHostTurn(envelope: HostTurnEnvelope): CoreTurn {
  if (!HOSTS.includes(envelope.host)) {
    throw new TypeError(`Unknown host: ${String(envelope.host)}`);
  }

  return {
    agent_id: envelope.agent_id,
    session_id: envelope.session_id,
    turn_id: envelope.turn_id,
    turn_index: envelope.turn_index,
    messages: envelope.messages.map((message) => ({
      role: message.role,
      text: message.text,
      observed_at: message.observed_at,
      message_index: message.message_index
    }))
  };
}
