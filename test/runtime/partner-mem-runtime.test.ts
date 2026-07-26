import { afterEach, describe, expect, it } from "vitest";
import { PartnerMemRuntime } from "../../src/runtime/partner-mem-runtime.js";
import { createTestDatabase } from "../helpers/database.js";

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

describe("PartnerMemRuntime", () => {
  it("registers a Harness and transports question/answer writes internally", async () => {
    const fixture = createTestDatabase();
    const runtime = new PartnerMemRuntime(fixture.db, () => "2026-07-26T02:00:00Z");
    cleanups.push(fixture.close);

    const registration = await runtime.handle({
      id: "register",
      command: "register_harness",
      params: { harness_type: "runtime-test" }
    });
    expect(registration.ok).toBe(true);
    if (!registration.ok) throw new Error("registration failed");
    const harnessId = (registration.result as { harness_id: string }).harness_id;

    const question = await runtime.handle({
      id: "question",
      command: "record_question",
      params: {
        harness_id: harnessId,
        source_conversation_id: "runtime-conversation",
        source_message_id: "runtime-question",
        text: "runtime 问题"
      }
    });
    expect(question.ok).toBe(true);
    if (!question.ok) throw new Error("question failed");
    const nodeId = (question.result as { node_id: string }).node_id;

    const answer = await runtime.handle({
      id: "answer",
      command: "record_answer",
      params: {
        harness_id: harnessId,
        source_conversation_id: "runtime-conversation",
        node_id: nodeId,
        source_message_id: "runtime-answer",
        text: "runtime 回答"
      }
    });
    expect(answer).toMatchObject({
      id: "answer",
      ok: true,
      result: { node_id: nodeId }
    });

    expect(
      await runtime.handle({
        id: "read-own",
        command: "get_node",
        params: { harness_id: harnessId, node_id: nodeId }
      })
    ).toMatchObject({
      id: "read-own",
      ok: true,
      result: { node_id: nodeId, answer_text: "runtime 回答" }
    });
    expect(
      await runtime.handle({
        id: "read-other",
        command: "get_node",
        params: { harness_id: "another-harness", node_id: nodeId }
      })
    ).toMatchObject({
      id: "read-other",
      ok: false,
      error: { code: "NOT_FOUND" }
    });
  });

  it("resolves source identity inside the core before invoking a Tool", async () => {
    const fixture = createTestDatabase();
    const runtime = new PartnerMemRuntime(fixture.db);
    cleanups.push(fixture.close);

    const registration = await runtime.handle({
      id: "register",
      command: "register_harness",
      params: { harness_type: "runtime-test" }
    });
    if (!registration.ok) throw new Error("registration failed");
    const harnessId = (registration.result as { harness_id: string }).harness_id;

    await runtime.handle({
      id: "question",
      command: "record_question",
      params: {
        harness_id: harnessId,
        source_conversation_id: "raw-conversation",
        source_access_agent_id: "raw-agent",
        text: "runtime keyword"
      }
    });
    const result = await runtime.handle({
      id: "tool",
      command: "invoke_tool",
      params: {
        harness_id: harnessId,
        source_conversation_id: "raw-conversation",
        source_agent_id: "raw-agent",
        tool_name: "partner_mem_keyword_search",
        arguments: { query: "runtime keyword" }
      }
    });

    expect(result).toMatchObject({
      id: "tool",
      ok: true,
      result: {
        status: "ok",
        retrieval_type: "keyword",
        evidence_items: [
          {
            question: { text: "runtime keyword" }
          }
        ]
      }
    });
    const evidence = (
      result as {
        result: { evidence_items: Array<{ conversation_id: string }> };
      }
    ).result.evidence_items[0];
    expect(evidence?.conversation_id).not.toBe("raw-conversation");
  });

  it("grants an answer Agent access to that conversation for later Agent-history retrieval", async () => {
    const fixture = createTestDatabase();
    const runtime = new PartnerMemRuntime(fixture.db);
    cleanups.push(fixture.close);

    const registration = await runtime.handle({
      id: "register",
      command: "register_harness",
      params: { harness_type: "openclaw" }
    });
    if (!registration.ok) throw new Error("registration failed");
    const harnessId = (registration.result as { harness_id: string }).harness_id;

    const question = await runtime.handle({
      id: "prior-question",
      command: "record_question",
      params: {
        harness_id: harnessId,
        source_conversation_id: "prior-conversation",
        source_message_id: "prior-question-message",
        text: "agent-owned history"
      }
    });
    if (!question.ok) throw new Error("question failed");
    const nodeId = (question.result as { node_id: string }).node_id;

    expect(
      await runtime.handle({
        id: "prior-answer",
        command: "record_answer",
        params: {
          harness_id: harnessId,
          source_conversation_id: "prior-conversation",
          node_id: nodeId,
          source_message_id: "prior-answer-message",
          source_agent_id: "openclaw-agent",
          source_access_agent_id: "openclaw-agent",
          text: "remembered by the agent"
        }
      })
    ).toMatchObject({ ok: true });

    const stored = await runtime.handle({
      id: "stored",
      command: "get_node",
      params: { harness_id: harnessId, node_id: nodeId }
    });
    expect(stored).toMatchObject({
      ok: true,
      result: { node_id: nodeId }
    });
    if (!stored.ok) throw new Error("node read failed");
    expect((stored.result as { answer_agent_id: string }).answer_agent_id).not.toBe(
      "openclaw-agent"
    );

    const result = await runtime.handle({
      id: "agent-history",
      command: "invoke_tool",
      params: {
        harness_id: harnessId,
        source_conversation_id: "later-conversation",
        source_agent_id: "openclaw-agent",
        tool_name: "partner_mem_keyword_search",
        arguments: {
          query: "agent-owned history",
          scope: "agent_conversations"
        }
      }
    });

    expect(result).toMatchObject({
      ok: true,
      result: {
        status: "ok",
        retrieval_type: "keyword",
        evidence_items: [
          {
            node_id: nodeId,
            question: { text: "agent-owned history" }
          }
        ]
      }
    });
  });

  it("returns vector unavailability as a Tool envelope when evidence needs embedding", async () => {
    const fixture = createTestDatabase();
    const runtime = new PartnerMemRuntime(fixture.db);
    cleanups.push(fixture.close);
    const registration = await runtime.handle({
      id: "register",
      command: "register_harness",
      params: { harness_type: "runtime-test" }
    });
    if (!registration.ok) throw new Error("registration failed");
    const harnessId = (registration.result as { harness_id: string }).harness_id;
    await runtime.handle({
      id: "question",
      command: "record_question",
      params: {
        harness_id: harnessId,
        source_conversation_id: "raw-conversation",
        text: "vector candidate"
      }
    });

    const result = await runtime.handle({
      id: "tool",
      command: "invoke_tool",
      params: {
        harness_id: harnessId,
        source_conversation_id: "raw-conversation",
        tool_name: "partner_mem_vector_search",
        arguments: { query: "anything" }
      }
    });

    expect(result).toMatchObject({
      ok: true,
      result: {
        status: "error",
        retrieval_type: "vector",
        error_code: "embedding_unavailable",
        evidence_items: []
      }
    });
  });

  it("keeps model arguments from injecting trusted retrieval identity", async () => {
    const fixture = createTestDatabase();
    const runtime = new PartnerMemRuntime(fixture.db);
    cleanups.push(fixture.close);
    const registration = await runtime.handle({
      id: "register",
      command: "register_harness",
      params: { harness_type: "runtime-test" }
    });
    if (!registration.ok) throw new Error("registration failed");
    const harnessId = (registration.result as { harness_id: string }).harness_id;

    const result = await runtime.handle({
      id: "tool",
      command: "invoke_tool",
      params: {
        harness_id: harnessId,
        source_conversation_id: "trusted-source-conversation",
        source_agent_id: "trusted-source-agent",
        tool_name: "partner_mem_keyword_search",
        arguments: {
          query: "anything",
          harness_id: "model-controlled-harness",
          conversation_id: "model-controlled-conversation",
          agent_id: "model-controlled-agent"
        }
      }
    });

    expect(result).toMatchObject({
      id: "tool",
      ok: true,
      result: {
        status: "error",
        retrieval_type: "keyword",
        error_code: "invalid_tool_input",
        evidence_items: []
      }
    });
  });

  it("rejects unknown fields and commands without poisoning later requests", async () => {
    const fixture = createTestDatabase();
    const runtime = new PartnerMemRuntime(fixture.db);
    cleanups.push(fixture.close);

    expect(
      await runtime.handle({
        id: "old-command",
        command: "tools.invoke",
        params: {}
      })
    ).toMatchObject({
      id: "old-command",
      ok: false,
      error: { code: "UNKNOWN_COMMAND" }
    });
    expect(
      await runtime.handle({
        id: "extra",
        command: "register_harness",
        params: { harness_type: "test", final_visible: true }
      })
    ).toMatchObject({
      ok: false,
      error: { code: "INVALID_REQUEST" }
    });
    expect(
      await runtime.handle({
        id: "valid",
        command: "register_harness",
        params: { harness_type: "still-works" }
      })
    ).toMatchObject({ id: "valid", ok: true });
  });
});
