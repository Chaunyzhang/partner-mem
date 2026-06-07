import { describe, expect, it } from "vitest";
import { DEFAULT_PARTNER_MEM_OPENCLAW_CONFIG } from "../src/config.js";
import {
  extractOpenClawVisibleMessages,
  formatContextBlockForOpenClaw,
  normalizeHostTurn,
  normalizeOpenClawTurn,
  selectCapturableMessages
} from "../src/openclaw-adapter.js";

describe("OpenClaw adapter", () => {
  it("extracts string content exactly and maps only visible user/assistant roles", () => {
    const messages = extractOpenClawVisibleMessages([
      { role: "system", content: "hidden system" },
      { role: "user", content: "  exact user text  " },
      { role: "assistant", text: "exact assistant text" },
      { role: "tool", content: "tool output" }
    ]);

    expect(messages.map((message) => [message.role, message.text])).toEqual([
      ["user", "  exact user text  "],
      ["assistant", "exact assistant text"]
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

  it("produces an OpenClaw host envelope and core normalization preserves exact text", () => {
    const envelope = normalizeOpenClawTurn(
      {
        runId: "run-1",
        messages: [{ role: "user", content: "OpenClaw exact raw text" }]
      },
      { agentId: "agent-1", sessionKey: "session-1" },
      {
        config: DEFAULT_PARTNER_MEM_OPENCLAW_CONFIG,
        nextTurnIndex: () => 7
      }
    );

    expect(envelope?.host).toBe("openclaw");
    expect(envelope?.turn_id).toBe("run-1");
    expect(envelope?.turn_index).toBe(7);
    expect(normalizeHostTurn(envelope!).messages[0]?.text).toBe("OpenClaw exact raw text");
  });

  it("stops at complete message boundaries for char and count limits", () => {
    const messages = extractOpenClawVisibleMessages([
      { role: "user", content: "first" },
      { role: "assistant", content: "second" },
      { role: "user", content: "third" }
    ]);

    expect(
      selectCapturableMessages(messages, {
        ...DEFAULT_PARTNER_MEM_OPENCLAW_CONFIG,
        captureMaxCompleteMessages: 2
      }).map((message) => message.text)
    ).toEqual(["second", "third"]);
    expect(
      selectCapturableMessages(messages, {
        ...DEFAULT_PARTNER_MEM_OPENCLAW_CONFIG,
        captureMaxCharsPerTurn: 11
      }).map((message) => message.text)
    ).toEqual(["second", "third"]);
  });

  it("skips a long single message without slicing it", () => {
    const longText = "x".repeat(1001);
    const selected = selectCapturableMessages(
      extractOpenClawVisibleMessages([{ role: "user", content: longText }]),
      {
        ...DEFAULT_PARTNER_MEM_OPENCLAW_CONFIG,
        captureMaxCharsPerTurn: 1000
      }
    );

    expect(selected).toEqual([]);
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
