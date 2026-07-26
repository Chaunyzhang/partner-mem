import { afterEach, describe, expect, it } from "vitest";
import { PartnerMemStore } from "../../src/storage/partner-mem-store.js";
import { openPartnerMemDatabase } from "../../src/storage/schema.js";
import { createTestDatabase } from "../helpers/database.js";

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

describe("PartnerMemStore V1 foundation", () => {
  it("generates and durably reuses one formal ID for one source object", () => {
    const fixture = createTestDatabase();
    cleanups.push(fixture.close);
    const store = new PartnerMemStore(fixture.db);
    const harness = store.registerHarness("OpenClaw", "2026-07-26T00:00:00Z");

    const first = store.resolveSourceObject({
      harness_id: harness.harness_id,
      object_kind: "conversation",
      source_object_id: "host-conversation-1"
    });
    const second = store.resolveSourceObject({
      harness_id: harness.harness_id,
      object_kind: "conversation",
      source_object_id: "host-conversation-1"
    });
    expect(second.formal_id).toBe(first.formal_id);

    fixture.closeDatabase();
    const reopened = openPartnerMemDatabase(fixture.path);
    const restartedStore = new PartnerMemStore(reopened);
    expect(
      restartedStore.findSourceObject({
        harness_id: harness.harness_id,
        object_kind: "conversation",
        source_object_id: "host-conversation-1"
      })?.formal_id
    ).toBe(first.formal_id);
    reopened.close();
  });

  it("isolates equal source IDs across Harness instances", () => {
    const fixture = createTestDatabase();
    cleanups.push(fixture.close);
    const store = new PartnerMemStore(fixture.db);
    const firstHarness = store.registerHarness("OpenClaw");
    const secondHarness = store.registerHarness("OpenClaw");

    const first = store.resolveSourceObject({
      harness_id: firstHarness.harness_id,
      object_kind: "conversation",
      source_object_id: "same-host-id"
    });
    const second = store.resolveSourceObject({
      harness_id: secondHarness.harness_id,
      object_kind: "conversation",
      source_object_id: "same-host-id"
    });
    expect(second.formal_id).not.toBe(first.formal_id);
  });

  it("stores one exact turn node using only Partner-Mem formal IDs", () => {
    const fixture = createTestDatabase();
    cleanups.push(fixture.close);
    const store = new PartnerMemStore(fixture.db);
    const harness = store.registerHarness("Hermes");
    const conversation = store.resolveSourceObject({
      harness_id: harness.harness_id,
      object_kind: "conversation",
      source_object_id: "session-source"
    });
    const questionMessage = store.resolveSourceObject({
      harness_id: harness.harness_id,
      object_kind: "message",
      source_object_id: "question-source"
    });
    const answerMessage = store.resolveSourceObject({
      harness_id: harness.harness_id,
      object_kind: "message",
      source_object_id: "answer-source"
    });

    const node = store.insertTurnNode({
      harness_id: harness.harness_id,
      conversation_id: conversation.formal_id,
      question_text: "  完整问题原文  ",
      question_role: "user",
      question_message_id: questionMessage.formal_id,
      answer_text: "完整回答原文",
      answer_role: "assistant",
      answer_message_id: answerMessage.formal_id
    });

    expect(node.question_text).toBe("  完整问题原文  ");
    expect(node.answer_text).toBe("完整回答原文");
    expect(node.harness_type).toBe("Hermes");
  });

  it("rejects raw Harness IDs and nodes without text", () => {
    const fixture = createTestDatabase();
    cleanups.push(fixture.close);
    const store = new PartnerMemStore(fixture.db);
    const harness = store.registerHarness("Hermes");
    const conversation = store.resolveSourceObject({
      harness_id: harness.harness_id,
      object_kind: "conversation",
      source_object_id: "source-conversation"
    });

    expect(() =>
      store.insertTurnNode({
        harness_id: harness.harness_id,
        conversation_id: "source-conversation",
        question_text: "question"
      })
    ).toThrow("not a Partner-Mem conversation ID");
    expect(() =>
      store.insertTurnNode({
        harness_id: harness.harness_id,
        conversation_id: conversation.formal_id
      })
    ).toThrow("requires question_text or answer_text");
  });
});
