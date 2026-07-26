import { afterEach, describe, expect, it } from "vitest";
import type { EmbeddingProvider } from "../../src/embedding/embedding-provider.js";
import { TurnIngestService } from "../../src/ingest/turn-ingest-service.js";
import { PartnerMemStore } from "../../src/storage/partner-mem-store.js";
import { RetrievalFacade } from "../../src/tools/retrieval-facade.js";
import { createTestDatabase } from "../helpers/database.js";

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

class RecordingProvider implements EmbeddingProvider {
  readonly provider_id = "fixed-test-provider";
  readonly model = "fixed-test-model";
  readonly inputs: string[] = [];

  async embed(text: string): Promise<readonly number[]> {
    this.inputs.push(text);
    if (text.includes("alpha") || text.includes("相近语义")) return [1, 0];
    return [0, 1];
  }
}

describe("vector retrieval", () => {
  it("creates one rebuildable vector per turn in question-then-answer order", async () => {
    const fixture = createTestDatabase();
    cleanups.push(fixture.close);
    const store = new PartnerMemStore(fixture.db);
    const harness = store.registerHarness("vector-test");
    const ingest = new TurnIngestService(store);
    const question = ingest.recordQuestion({
      harness_id: harness.harness_id,
      source_conversation_id: "vector-current",
      text: "alpha question",
      source_message_id: "vector-question",
      source_access_agent_id: "vector-agent"
    });
    const complete = ingest.recordAnswer({
      harness_id: harness.harness_id,
      source_conversation_id: "vector-current",
      node_id: question.node_id,
      text: "alpha answer",
      source_message_id: "vector-answer",
      source_access_agent_id: "vector-agent"
    });
    const other = ingest.recordQuestion({
      harness_id: harness.harness_id,
      source_conversation_id: "vector-current",
      text: "unrelated beta turn",
      source_message_id: "vector-other"
    });
    const answerOnly = ingest.recordAnswer({
      harness_id: harness.harness_id,
      source_conversation_id: "vector-current",
      question_was_absent: true,
      text: "answer-only gamma turn",
      source_message_id: "vector-answer-only"
    });
    const agentId = store.findSourceObject({
      harness_id: harness.harness_id,
      object_kind: "agent",
      source_object_id: "vector-agent"
    })?.formal_id;
    if (!agentId) throw new Error("missing formal agent");
    const provider = new RecordingProvider();
    const facade = new RetrievalFacade(
      store,
      provider,
      () => "2026-07-26T03:00:00Z"
    );
    const identity = {
      harness_id: harness.harness_id,
      conversation_id: complete.conversation_id,
      agent_id: agentId
    };

    const result = await facade.invoke(
      "partner_mem_vector_search",
      { query: "相近语义", limit: 1 },
      identity
    );
    expect(result.status).toBe("ok");
    expect(result.truncated).toBe(true);
    expect(result.evidence_items[0]?.node_id).toBe(complete.node_id);
    expect(provider.inputs).toContain("alpha question\nalpha answer");
    expect(provider.inputs).toContain("unrelated beta turn");
    expect(provider.inputs).toContain("answer-only gamma turn");
    expect(
      fixture.db.prepare("SELECT COUNT(*) AS count FROM node_vectors").get()
    ).toEqual({ count: 3 });
    expect(
      fixture.db
        .prepare(
          "SELECT COUNT(DISTINCT node_id) AS count FROM node_vectors"
        )
        .get()
    ).toEqual({ count: 3 });
    expect(JSON.stringify(result)).not.toMatch(
      /score|distance|similarity|provider|model|dimensions/
    );

    const callsBeforeRepeat = provider.inputs.length;
    await facade.invoke(
      "partner_mem_vector_search",
      { query: "相近语义", limit: 2 },
      identity
    );
    expect(provider.inputs.length).toBe(callsBeforeRepeat + 1);
    expect(store.getNodeVector(other.node_id)).toBeDefined();
    expect(store.getNodeVector(answerOnly.node_id)).toBeDefined();
  });

  it("uses the same explicit Agent history boundary as keyword retrieval", async () => {
    const fixture = createTestDatabase();
    cleanups.push(fixture.close);
    const store = new PartnerMemStore(fixture.db);
    const harness = store.registerHarness("vector-scope");
    const ingest = new TurnIngestService(store);
    const current = ingest.recordQuestion({
      harness_id: harness.harness_id,
      source_conversation_id: "current",
      text: "unrelated beta current",
      source_access_agent_id: "vector-agent"
    });
    const history = ingest.recordQuestion({
      harness_id: harness.harness_id,
      source_conversation_id: "history",
      text: "alpha authorized history",
      source_access_agent_id: "vector-agent"
    });
    ingest.recordQuestion({
      harness_id: harness.harness_id,
      source_conversation_id: "hidden",
      text: "alpha hidden history"
    });
    const agentId = store.findSourceObject({
      harness_id: harness.harness_id,
      object_kind: "agent",
      source_object_id: "vector-agent"
    })?.formal_id;
    if (!agentId) throw new Error("missing formal agent");
    const facade = new RetrievalFacade(store, new RecordingProvider());
    const identity = {
      harness_id: harness.harness_id,
      conversation_id: current.conversation_id,
      agent_id: agentId
    };

    const currentOnly = await facade.invoke(
      "partner_mem_vector_search",
      { query: "相近语义" },
      identity
    );
    expect(currentOnly.evidence_items.map((item) => item.node_id)).toEqual([
      current.node_id
    ]);
    const agentHistory = await facade.invoke(
      "partner_mem_vector_search",
      {
        query: "相近语义",
        scope: "agent_conversations"
      },
      identity
    );
    expect(agentHistory.evidence_items[0]?.node_id).toBe(history.node_id);
    expect(agentHistory.evidence_items).toHaveLength(2);
  });

  it("invalidates a question-only vector when the exact answer is attached", async () => {
    const fixture = createTestDatabase();
    cleanups.push(fixture.close);
    const store = new PartnerMemStore(fixture.db);
    const harness = store.registerHarness("vector-invalidation");
    const ingest = new TurnIngestService(store);
    const question = ingest.recordQuestion({
      harness_id: harness.harness_id,
      source_conversation_id: "vector-update",
      text: "alpha before answer",
      source_message_id: "vector-update-question"
    });
    const provider = new RecordingProvider();
    const facade = new RetrievalFacade(store, provider);
    const identity = {
      harness_id: harness.harness_id,
      conversation_id: question.conversation_id
    };
    await facade.invoke(
      "partner_mem_vector_search",
      { query: "相近语义" },
      identity
    );
    expect(store.getNodeVector(question.node_id)).toBeDefined();

    ingest.recordAnswer({
      harness_id: harness.harness_id,
      source_conversation_id: "vector-update",
      node_id: question.node_id,
      text: "alpha attached answer",
      source_message_id: "vector-update-answer"
    });
    expect(store.getNodeVector(question.node_id)).toBeUndefined();
    await facade.invoke(
      "partner_mem_vector_search",
      { query: "相近语义" },
      identity
    );
    expect(provider.inputs).toContain(
      "alpha before answer\nalpha attached answer"
    );
  });

  it("returns a stable error only for vector when embedding is unavailable", async () => {
    const fixture = createTestDatabase();
    cleanups.push(fixture.close);
    const store = new PartnerMemStore(fixture.db);
    const harness = store.registerHarness("vector-unavailable");
    const ingest = new TurnIngestService(store);
    const node = ingest.recordQuestion({
      harness_id: harness.harness_id,
      source_conversation_id: "vector-error",
      text: "keyword remains usable"
    });
    const facade = new RetrievalFacade(store);
    const identity = {
      harness_id: harness.harness_id,
      conversation_id: node.conversation_id
    };

    expect(
      await facade.invoke(
        "partner_mem_vector_search",
        { query: "semantic" },
        identity
      )
    ).toEqual({
      status: "error",
      retrieval_type: "vector",
      truncated: false,
      error_code: "embedding_unavailable",
      evidence_items: []
    });
    expect(
      (
        await facade.invoke(
          "partner_mem_keyword_search",
          { query: "keyword" },
          identity
        )
      ).status
    ).toBe("ok");

    const throwingProvider: EmbeddingProvider = {
      provider_id: "throwing-provider",
      model: "throwing-model",
      async embed() {
        throw new Error("provider implementation failure");
      }
    };
    expect(
      await new RetrievalFacade(store, throwingProvider).invoke(
        "partner_mem_vector_search",
        { query: "semantic" },
        identity
      )
    ).toMatchObject({
      status: "error",
      error_code: "embedding_unavailable",
      evidence_items: []
    });
  });

  it("rejects embeddings that overflow Float32 and corrupt stored vectors", async () => {
    const fixture = createTestDatabase();
    cleanups.push(fixture.close);
    const store = new PartnerMemStore(fixture.db);
    const harness = store.registerHarness("vector-float32");
    const node = new TurnIngestService(store).recordQuestion({
      harness_id: harness.harness_id,
      source_conversation_id: "current",
      text: "alpha finite source"
    });
    const identity = {
      harness_id: harness.harness_id,
      conversation_id: node.conversation_id
    };
    const overflowingProvider: EmbeddingProvider = {
      provider_id: "overflow",
      model: "overflow-model",
      async embed() {
        return [1e300, 1];
      }
    };
    expect(
      await new RetrievalFacade(store, overflowingProvider).invoke(
        "partner_mem_vector_search",
        { query: "semantic" },
        identity
      )
    ).toMatchObject({
      status: "error",
      error_code: "embedding_unavailable",
      evidence_items: []
    });
    expect(
      fixture.db.prepare("SELECT COUNT(*) AS count FROM node_vectors").get()
    ).toEqual({ count: 0 });

    const validProvider = new RecordingProvider();
    const facade = new RetrievalFacade(store, validProvider);
    expect(
      (
        await facade.invoke(
          "partner_mem_vector_search",
          { query: "相近语义" },
          identity
        )
      ).status
    ).toBe("ok");
    const corrupt = Buffer.alloc(8);
    corrupt.writeFloatLE(Number.POSITIVE_INFINITY, 0);
    corrupt.writeFloatLE(1, 4);
    fixture.db
      .prepare("UPDATE node_vectors SET vector = ? WHERE node_id = ?")
      .run(corrupt, node.node_id);

    expect(
      await facade.invoke(
        "partner_mem_vector_search",
        { query: "相近语义" },
        identity
      )
    ).toMatchObject({
      status: "error",
      error_code: "embedding_unavailable",
      evidence_items: []
    });
  });
});
