import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { normalizeHostTurn } from "../../src/adapters/adapter-contracts.js";

describe("adapter contracts", () => {
  it("normalizes host turns while preserving exact message text", () => {
    const turn = normalizeHostTurn({
      host: "mcp",
      agent_id: "agent-1",
      session_id: "session-1",
      turn_id: "turn-1",
      turn_index: 0,
      messages: [
        {
          role: "user",
          text: "  exact text stays  ",
          observed_at: "2026-01-01T00:00:00.000Z",
          message_index: 0
        }
      ]
    });

    expect(turn.messages[0]?.text).toBe("  exact text stays  ");
  });

  it("does not import storage owners or drivers in adapter source", () => {
    const source = readFileSync("src/adapters/adapter-contracts.ts", "utf8");

    expect(source).not.toContain("GraphStore");
    expect(source).not.toContain("sqlite");
  });
});
