import { afterEach, describe, expect, it } from "vitest";
import { PartnerMemRuntime } from "../../src/runtime/partner-mem-runtime.js";
import { createTestDatabase } from "../helpers/database.js";

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

describe("PartnerMemRuntime", () => {
  it("registers a Harness and transports question/answer writes internally", () => {
    const fixture = createTestDatabase();
    const runtime = new PartnerMemRuntime(fixture.db, () => "2026-07-26T02:00:00Z");
    cleanups.push(fixture.close);

    const registration = runtime.handle({
      id: "register",
      command: "register_harness",
      params: { harness_type: "runtime-test" }
    });
    expect(registration.ok).toBe(true);
    if (!registration.ok) throw new Error("registration failed");
    const harnessId = (registration.result as { harness_id: string }).harness_id;

    const question = runtime.handle({
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

    const answer = runtime.handle({
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
      runtime.handle({
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
      runtime.handle({
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

  it("rejects unknown fields and commands without poisoning later requests", () => {
    const fixture = createTestDatabase();
    const runtime = new PartnerMemRuntime(fixture.db);
    cleanups.push(fixture.close);

    expect(
      runtime.handle({
        id: "old-command",
        command: "partner_mem_status",
        params: {}
      })
    ).toMatchObject({
      id: "old-command",
      ok: false,
      error: { code: "UNKNOWN_COMMAND" }
    });
    expect(
      runtime.handle({
        id: "extra",
        command: "register_harness",
        params: { harness_type: "test", final_visible: true }
      })
    ).toMatchObject({
      ok: false,
      error: { code: "INVALID_REQUEST" }
    });
    expect(
      runtime.handle({
        id: "valid",
        command: "register_harness",
        params: { harness_type: "still-works" }
      })
    ).toMatchObject({ id: "valid", ok: true });
  });
});
