import { describe, expect, it } from "vitest";
import { DEFAULT_PARTNER_MEM_OPENCLAW_CONFIG } from "../src/config.js";
import {
  extractOpenClawVisibleMessages,
  formatContextBlockForOpenClaw,
  normalizeHostTurn
} from "../src/openclaw-adapter.js";

describe("OpenClaw adapter", () => {
  it("reads roles from message.role without guessing from position", () => {
    const messages = extractOpenClawVisibleMessages([
      { role: "assistant", content: "assistant can be first" },
      { role: "user", content: "  exact user text  " },
      { content: "missing role must not become assistant by position" },
      { role: "assistant", text: "assistant can follow user" },
      { role: "tool", content: "tool output" },
      { role: "user", content: "final user stays user" }
    ]);

    expect(messages.map((message) => [message.role, message.text])).toEqual([
      ["assistant", "assistant can be first"],
      ["user", "  exact user text  "],
      ["assistant", "assistant can follow user"],
      ["user", "final user stays user"]
    ]);
  });

  it("extracts array text blocks in order and drops empty text", () => {
    const [message] = extractOpenClawVisibleMessages([
      {
        role: "user",
        content: [
          { type: "text", text: "first " },
          { type: "image", url: "ignored" },
          { type: "text", text: "second" }
        ]
      },
      { role: "assistant", content: "   " }
    ]);

    expect(message?.text).toBe("first second");
  });

  it("keeps only screen-visible text and drops hidden/internal message parts", () => {
    const messages = extractOpenClawVisibleMessages([
      { role: "user", content: "hidden top-level user text", visibility: "hidden" },
      { role: "assistant", content: "hidden assistant text", hidden: true },
      {
        role: "user",
        content: [
          { type: "text", text: "visible first " },
          { type: "text", text: "hidden text", visibility: "hidden" },
          { type: "thinking", text: "hidden reasoning" },
          { type: "tool_result", text: "hidden tool output" },
          { type: "text", text: "visible second", audience: "screen" }
        ]
      },
      {
        role: "assistant",
        content: [
          { type: "text", text: "internal assistant text", audience: "internal" },
          { type: "text", text: "visible assistant text", channel: "screen" }
        ]
      }
    ]);

    expect(messages.map((message) => [message.role, message.text])).toEqual([
      ["user", "visible first visible second"],
      ["assistant", "visible assistant text"]
    ]);
  });

  it("strips leading Partner-Mem injected context blocks before raw capture", () => {
    const messages = extractOpenClawVisibleMessages([
      {
        role: "user",
        content:
          "Partner-Mem verified raw evidence:\n- user: hidden evidence\nPartner-Mem recent raw timeline:\n- assistant: hidden timeline\n\n我屏幕上真正发送的话"
      },
      {
        role: "assistant",
        content: "Partner-Mem verified raw evidence:\n- user: only hidden evidence"
      },
      {
        role: "assistant",
        content: "我正在解释 Partner-Mem verified raw evidence 这个可见词组，不应该被整条删除。"
      }
    ]);

    expect(messages.map((message) => [message.role, message.text])).toEqual([
      ["user", "我屏幕上真正发送的话"],
      ["assistant", "我正在解释 Partner-Mem verified raw evidence 这个可见词组，不应该被整条删除。"]
    ]);
  });

  it("core normalization preserves exact OpenClaw text", () => {
    const envelope = {
      host: "openclaw" as const,
      agent_id: "agent-1",
      session_id: "session-1",
      turn_id: "turn-1",
      turn_index: 7,
      messages: extractOpenClawVisibleMessages([
        { role: "user", content: "OpenClaw exact raw text" }
      ])
    };

    expect(normalizeHostTurn(envelope).messages[0]?.text).toBe("OpenClaw exact raw text");
  });

  it("extracts an oversized message as a whole so capture can skip it without slicing", () => {
    const longText = "x".repeat(1001);
    const [message] = extractOpenClawVisibleMessages([{ role: "user", content: longText }]);

    expect(message?.text).toBe(longText);
    expect(DEFAULT_PARTNER_MEM_OPENCLAW_CONFIG.captureMaxCharsPerMessage).toBe(200000);
  });

  it("does not format empty context into prompt injection", () => {
    expect(
      formatContextBlockForOpenClaw({
        recent_raw_timeline: [],
        verified_evidence: [],
        safety_instructions: ["Use verified evidence."]
      })
    ).toBe("");
  });
});
