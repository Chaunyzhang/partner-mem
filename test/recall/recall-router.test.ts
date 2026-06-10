import { describe, expect, it } from "vitest";
import { hashText } from "../../src/core/hash.js";
import { RawIngestService } from "../../src/ingest/raw-ingest.js";
import { RecallRouter } from "../../src/recall/recall-router.js";
import { createInitializedStore } from "../helpers/db.js";

describe("RecallRouter", () => {
  it("returns original raw text after FTS seed plus resolver", () => {
    const store = createInitializedStore();
    new RawIngestService(store).ingestTurn({
      agent_id: "agent-1",
      session_id: "session-1",
      turn_id: "turn-1",
      turn_index: 0,
      messages: [
        {
          role: "user",
          text: "Recall must return this exact original sentence.",
          observed_at: "2026-01-01T00:00:00.000Z",
          message_index: 0
        }
      ]
    });

    const packet = new RecallRouter(store).recall({
      query: "exact original",
      agent_id: "agent-1",
      limit: 3
    });

    expect(packet.evidence_items[0]?.text).toBe("Recall must return this exact original sentence.");
    expect(store.countRows("retrieval_runs")).toBe(1);
  });

  it("excludes out-of-window FTS seeds before resolving recall evidence", () => {
    const store = createInitializedStore();
    const service = new RawIngestService(store);
    service.ingestTurn({
      agent_id: "agent-1",
      session_id: "session-1",
      turn_id: "turn-1",
      turn_index: 0,
      messages: [
        {
          role: "user",
          text: "windowed recall target old",
          observed_at: "2026-01-01T00:00:00.000Z",
          message_index: 0
        }
      ]
    });
    service.ingestTurn({
      agent_id: "agent-1",
      session_id: "session-1",
      turn_id: "turn-2",
      turn_index: 1,
      messages: [
        {
          role: "user",
          text: "windowed recall target new",
          observed_at: "2026-02-01T00:00:00.000Z",
          message_index: 0
        }
      ]
    });

    const packet = new RecallRouter(store).recall({
      query: "windowed target",
      agent_id: "agent-1",
      time_window: {
        since: "2026-01-15T00:00:00.000Z",
        until: "2026-02-15T00:00:00.000Z"
      },
      limit: 5
    });

    expect(packet.evidence_items.map((item) => item.text)).toEqual(["windowed recall target new"]);
  });

  it("adds revision context so recalled old evidence points at the current correction", () => {
    const store = createInitializedStore();
    const service = new RawIngestService(store);
    service.ingestTurn({
      agent_id: "agent-1",
      session_id: "session-1",
      turn_id: "turn-1",
      turn_index: 0,
      messages: [
        {
          role: "user",
          text: "Project Quartz plan A",
          observed_at: "2026-01-01T00:00:00.000Z",
          message_index: 0
        }
      ]
    });
    service.ingestTurn({
      agent_id: "agent-1",
      session_id: "session-1",
      turn_id: "turn-2",
      turn_index: 1,
      messages: [
        {
          role: "user",
          text: "Project Quartz change plan B",
          observed_at: "2026-01-02T00:00:00.000Z",
          message_index: 0
        }
      ]
    });

    const packet = new RecallRouter(store).recall({
      query: "Project Quartz plan",
      agent_id: "agent-1",
      limit: 5
    });
    const oldEvidence = packet.evidence_items.find((item) => item.text === "Project Quartz plan A");
    if (!oldEvidence) throw new Error("missing old evidence");

    expect(oldEvidence.revision_context?.topic_group).toBe("topic_project_quartz");
    expect(oldEvidence.revision_context?.sequence).toBe(1);
    expect(oldEvidence.revision_context?.current_effective_text).toBe("Project Quartz change plan B");
    expect(oldEvidence.revision_context?.is_current_effective).toBe(false);
    expect(oldEvidence.revision_context?.chain.map((step) => step.relation_to_previous)).toEqual([
      null,
      "correction"
    ]);
  });

  it("returns candidate-only or blocked when an FTS entity seed has no valid evidence path", () => {
    const store = createInitializedStore();
    const contentHash = hashText("entity without proof");
    store.createNode({
      node_id: "entity-1",
      agent_id: "agent-1",
      session_id: "session-1",
      node_type: "entity",
      created_at: "2026-01-01T00:00:00.000Z",
      content_hash: contentHash
    });
    store.insertFtsNode({
      node_id: "entity-1",
      agent_id: "agent-1",
      session_id: "session-1",
      node_type: "entity",
      text: "unproven entity route"
    });

    const router = new RecallRouter(store);

    expect(
      router.search({
        query: "unproven",
        agent_id: "agent-1",
        limit: 3
      })[0]?.result_class
    ).toBe("candidate");
    expect(
      router.recall({
        query: "unproven",
        agent_id: "agent-1",
        limit: 3
      }).evidence_items
    ).toEqual([]);
  });

  it("returns blocked evidence instead of a best effort answer on hash mismatch", () => {
    const store = createInitializedStore();
    const rawHash = hashText("raw proof");
    store.createNode({
      node_id: "decision-1",
      agent_id: "agent-1",
      session_id: "session-1",
      node_type: "decision",
      created_at: "2026-01-01T00:00:00.000Z",
      content_hash: hashText("decision")
    });
    store.insertFtsNode({
      node_id: "decision-1",
      agent_id: "agent-1",
      session_id: "session-1",
      node_type: "decision",
      text: "corrupt evidence"
    });
    store.createNode({
      node_id: "raw-1",
      agent_id: "agent-1",
      session_id: "session-1",
      node_type: "raw_message",
      created_at: "2026-01-01T00:00:00.000Z",
      content_hash: rawHash
    });
    store.createRawPayload({
      node_id: "raw-1",
      role: "user",
      text: "raw proof",
      normalized_text: "raw proof",
      token_count: 2,
      turn_id: "turn-1",
      turn_index: 0,
      message_index: 0,
      source_hash: rawHash
    });
    store.createEdge({
      edge_id: "bad-edge",
      agent_id: "agent-1",
      from_node_id: "decision-1",
      to_node_id: "raw-1",
      edge_type: "EVIDENCED_BY_RAW",
      edge_class: "evidence",
      created_at: "2026-01-01T00:00:00.000Z",
      target_hash: "wrong"
    });

    const packet = new RecallRouter(store).recall({
      query: "corrupt",
      agent_id: "agent-1",
      limit: 3
    });

    expect(packet.evidence_items).toEqual([]);
    expect(packet.blocked_paths.map((path) => path.reason)).toContain("target_hash_mismatch");
  });
});
