import { afterEach, describe, expect, it } from "vitest";
import { TurnIngestService } from "../../src/ingest/turn-ingest-service.js";
import { PartnerMemStore } from "../../src/storage/partner-mem-store.js";
import { openPartnerMemDatabase } from "../../src/storage/schema.js";
import { createTestDatabase } from "../helpers/database.js";

const cleanups: Array<() => void> = [];
const now = "2026-07-26T01:02:03.000Z";

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

function createIngest() {
  const fixture = createTestDatabase();
  cleanups.push(fixture.close);
  const store = new PartnerMemStore(fixture.db);
  const harness = store.registerHarness("test-harness", now);
  const ingest = new TurnIngestService(store, () => now);
  return { fixture, store, harness, ingest };
}

describe("TurnIngestService", () => {
  it("stores a final question and attaches one exact final answer", () => {
    const { fixture, harness, ingest } = createIngest();
    const question = ingest.recordQuestion({
      harness_id: harness.harness_id,
      source_conversation_id: "conversation-1",
      source_thread_id: "thread-1",
      text: "  完整问题原文  ",
      role: "user",
      source_message_id: "question-message-1",
      source_author_id: "user-1",
      visible_at: "2026-07-26T00:00:01Z",
      display_order: 4
    });
    expect(question.answer_text).toBeNull();

    const complete = ingest.recordAnswer({
      harness_id: harness.harness_id,
      source_conversation_id: "conversation-1",
      source_thread_id: "thread-1",
      node_id: question.node_id,
      text: "  完整回答原文  ",
      role: "assistant",
      source_message_id: "answer-message-1",
      source_author_id: "assistant-author-1",
      source_agent_id: "agent-1",
      source_access_agent_id: "access-agent-1",
      visible_at: "2026-07-26T00:00:02Z",
      display_order: 5
    });

    expect(complete.node_id).toBe(question.node_id);
    expect(complete.question_text).toBe("  完整问题原文  ");
    expect(complete.answer_text).toBe("  完整回答原文  ");
    expect(complete.answer_agent_id).not.toBe("agent-1");
    const access = fixture.db
      .prepare("SELECT agent_id FROM agent_conversation_access")
      .get() as { agent_id: string };
    expect(
      fixture.db
        .prepare("SELECT COUNT(*) AS count FROM agent_conversation_access")
        .get()
    ).toEqual({ count: 1 });
    expect(access.agent_id).not.toBe(complete.answer_agent_id);
  });

  it("grants trusted Agent history access for question-only turns and multiple Agents", () => {
    const { fixture, harness, ingest } = createIngest();
    const base = {
      harness_id: harness.harness_id,
      source_conversation_id: "question-only-access",
      text: "只有问题也属于可访问历史",
      source_message_id: "question-only-access-message"
    };
    const first = ingest.recordQuestion({
      ...base,
      source_access_agent_id: "access-agent-a"
    });
    const second = ingest.recordQuestion({
      ...base,
      source_access_agent_id: "access-agent-b"
    });

    expect(second.node_id).toBe(first.node_id);
    expect(
      fixture.db
        .prepare(
          "SELECT COUNT(*) AS count FROM agent_conversation_access WHERE conversation_id = ?"
        )
        .get(first.conversation_id)
    ).toEqual({ count: 2 });
  });

  it("creates answer-only only when the adapter explicitly confirms no question", () => {
    const { harness, ingest } = createIngest();

    expect(() =>
      ingest.recordAnswer({
        harness_id: harness.harness_id,
        source_conversation_id: "proactive-conversation",
        text: "主动发送的最终文字",
        source_message_id: "proactive-message"
      })
    ).toThrow("requires an exact node/message anchor or question_was_absent");

    const answerOnlyInput = {
      harness_id: harness.harness_id,
      source_conversation_id: "proactive-conversation",
      question_was_absent: true,
      question_source_message_id: "non-text-question-message",
      question_role: "user",
      question_source_author_id: "non-text-user",
      text: "主动发送的最终文字",
      source_message_id: "proactive-message"
    };
    const answerOnly = ingest.recordAnswer(answerOnlyInput);
    const repeated = ingest.recordAnswer(answerOnlyInput);
    expect(answerOnly.question_text).toBeNull();
    expect(answerOnly.question_message_id).not.toBeNull();
    expect(answerOnly.question_role).toBe("user");
    expect(answerOnly.answer_text).toBe("主动发送的最终文字");
    expect(repeated.node_id).toBe(answerOnly.node_id);

    ingest.recordQuestion({
      harness_id: harness.harness_id,
      source_conversation_id: "has-question-conversation",
      text: "确实存在的问题",
      source_message_id: "known-question-message"
    });
    expect(() =>
      ingest.recordAnswer({
        harness_id: harness.harness_id,
        source_conversation_id: "has-question-conversation",
        question_was_absent: true,
        question_source_message_id: "known-question-message",
        text: "矛盾的 answer-only 请求"
      })
    ).toThrow("conflicts with a stored question message");
  });

  it("recovers an exact question node after restart from its source message", () => {
    const { fixture, harness, ingest } = createIngest();
    const question = ingest.recordQuestion({
      harness_id: harness.harness_id,
      source_conversation_id: "conversation-restart",
      text: "重启前问题",
      source_message_id: "question-before-restart"
    });

    fixture.closeDatabase();
    const reopened = openPartnerMemDatabase(fixture.path);
    const restarted = new TurnIngestService(
      new PartnerMemStore(reopened),
      () => "2026-07-26T01:03:00.000Z"
    );
    const complete = restarted.recordAnswer({
      harness_id: harness.harness_id,
      source_conversation_id: "conversation-restart",
      question_source_message_id: "question-before-restart",
      text: "重启后回答",
      source_message_id: "answer-after-restart"
    });
    reopened.close();

    expect(complete.node_id).toBe(question.node_id);
    expect(complete.answer_text).toBe("重启后回答");
  });

  it("treats byte-identical source submissions as idempotent", () => {
    const { fixture, harness, ingest } = createIngest();
    const questionInput = {
      harness_id: harness.harness_id,
      source_conversation_id: "conversation-repeat",
      text: "同一个问题",
      source_message_id: "same-question-message",
      role: "user"
    };
    const firstQuestion = ingest.recordQuestion(questionInput);
    const secondQuestion = ingest.recordQuestion(questionInput);
    expect(secondQuestion.node_id).toBe(firstQuestion.node_id);

    const answerInput = {
      harness_id: harness.harness_id,
      source_conversation_id: "conversation-repeat",
      question_source_message_id: "same-question-message",
      text: "同一个回答",
      source_message_id: "same-answer-message",
      role: "assistant"
    };
    const firstAnswer = ingest.recordAnswer(answerInput);
    const secondAnswer = ingest.recordAnswer(answerInput);
    expect(secondAnswer.node_id).toBe(firstAnswer.node_id);
    expect(
      fixture.db.prepare("SELECT COUNT(*) AS count FROM turn_nodes").get()
    ).toEqual({ count: 1 });
  });

  it("rejects conflicting repeats, a second answer, and cross-conversation pairing", () => {
    const { fixture, store, harness, ingest } = createIngest();
    const question = ingest.recordQuestion({
      harness_id: harness.harness_id,
      source_conversation_id: "conversation-a",
      text: "不可覆盖的问题",
      source_message_id: "question-conflict"
    });

    expect(() =>
      ingest.recordAnswer({
        harness_id: harness.harness_id,
        source_conversation_id: "conversation-a",
        text: "正文很像也不能猜配对",
        visible_at: "2026-07-26T01:02:04.000Z"
      })
    ).toThrow("requires an exact node/message anchor or question_was_absent");

    expect(() =>
      ingest.recordQuestion({
        harness_id: harness.harness_id,
        source_conversation_id: "conversation-a",
        text: "篡改后的问题",
        source_message_id: "question-conflict"
      })
    ).toThrow("conflicts with an existing turn node");

    ingest.recordAnswer({
      harness_id: harness.harness_id,
      source_conversation_id: "conversation-a",
      node_id: question.node_id,
      text: "第一个回答",
      source_message_id: "first-answer"
    });
    expect(() =>
      ingest.recordAnswer({
        harness_id: harness.harness_id,
        source_conversation_id: "conversation-a",
        node_id: question.node_id,
        text: "第二个回答",
        source_message_id: "second-answer"
      })
    ).toThrow("already has a different answer");
    expect(() =>
      ingest.recordAnswer({
        harness_id: harness.harness_id,
        source_conversation_id: "conversation-b",
        node_id: question.node_id,
        text: "跨会话回答"
      })
    ).toThrow("different conversation");
    const otherHarness = store.registerHarness("other-harness", now);
    expect(() =>
      ingest.recordAnswer({
        harness_id: otherHarness.harness_id,
        source_conversation_id: "conversation-a",
        node_id: question.node_id,
        text: "跨 Harness 回答"
      })
    ).toThrow("different harness");

    expect(
      fixture.db
        .prepare("SELECT question_text, answer_text FROM turn_nodes WHERE node_id = ?")
        .get(question.node_id)
    ).toEqual({
      question_text: "不可覆盖的问题",
      answer_text: "第一个回答"
    });
  });

  it("records final host structure for a non-text answer exactly once", () => {
    const { fixture, harness, ingest } = createIngest();
    const question = ingest.recordQuestion({
      harness_id: harness.harness_id,
      source_conversation_id: "conversation-non-text-answer",
      text: "问题有文字",
      source_message_id: "question-before-non-text-answer"
    });
    const metadataInput = {
      harness_id: harness.harness_id,
      source_conversation_id: "conversation-non-text-answer",
      node_id: question.node_id,
      role: "assistant",
      source_message_id: "non-text-answer-message",
      source_author_id: "non-text-answer-author",
      source_agent_id: "non-text-answer-agent",
      visible_at: "2026-07-26T00:20:00Z",
      display_order: 9
    };

    expect(() =>
      ingest.recordAnswer({
        harness_id: harness.harness_id,
        source_conversation_id: "conversation-non-text-answer",
        node_id: question.node_id
      })
    ).toThrow("requires text or host structure fields");

    const metadataOnly = ingest.recordAnswer(metadataInput);
    const repeated = ingest.recordAnswer(metadataInput);
    expect(metadataOnly.answer_text).toBeNull();
    expect(metadataOnly.answer_message_id).not.toBeNull();
    expect(repeated.node_id).toBe(question.node_id);

    expect(() =>
      ingest.recordAnswer({
        ...metadataInput,
        text: "不得后来补成文字"
      })
    ).toThrow("already has a different answer");
    expect(() =>
      fixture.db
        .prepare("UPDATE turn_nodes SET answer_role = ? WHERE node_id = ?")
        .run("changed-role", question.node_id)
    ).toThrow("stored answer fields are immutable");
  });

  it("persists only explicit reply relations whose two message texts exist", () => {
    const { fixture, store, harness, ingest } = createIngest();
    ingest.recordAnswer({
      harness_id: harness.harness_id,
      source_conversation_id: "conversation-reply",
      question_was_absent: true,
      text: "父消息原文",
      source_message_id: "parent-message"
    });
    ingest.recordQuestion({
      harness_id: harness.harness_id,
      source_conversation_id: "conversation-reply",
      text: "回复消息原文",
      source_message_id: "reply-message"
    });

    const first = ingest.recordReply({
      harness_id: harness.harness_id,
      from_source_message_id: "reply-message",
      to_source_message_id: "parent-message"
    });
    const repeated = ingest.recordReply({
      harness_id: harness.harness_id,
      from_source_message_id: "reply-message",
      to_source_message_id: "parent-message"
    });
    expect(repeated.edge_id).toBe(first.edge_id);
    expect(
      fixture.db.prepare("SELECT COUNT(*) AS count FROM explicit_reply_edges").get()
    ).toEqual({ count: 1 });

    expect(() =>
      ingest.recordReply({
        harness_id: harness.harness_id,
        from_source_message_id: "missing-message",
        to_source_message_id: "parent-message"
      })
    ).toThrow("has no persisted Partner-Mem mapping");

    store.resolveSourceObject({
      harness_id: harness.harness_id,
      object_kind: "message",
      source_object_id: "mapped-without-text"
    });
    expect(() =>
      ingest.recordReply({
        harness_id: harness.harness_id,
        from_source_message_id: "mapped-without-text",
        to_source_message_id: "parent-message"
      })
    ).toThrow("does not resolve to stored text");
  });
});
