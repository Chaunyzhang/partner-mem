export const MEMORY_SCOPE_VALUES = ["current_session", "agent_memory"] as const;

export type MemoryScope = (typeof MEMORY_SCOPE_VALUES)[number];

export function readMemoryScope(value: unknown): MemoryScope {
  if (value === undefined) return "current_session";
  if (value === "current_session" || value === "agent_memory") return value;
  throw new TypeError("scope must be current_session or agent_memory");
}

export function sessionIdForMemoryScope(scope: MemoryScope, sessionId: string): string | undefined {
  return scope === "current_session" ? sessionId : undefined;
}
