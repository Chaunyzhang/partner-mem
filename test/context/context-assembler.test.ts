import { describe, expect, it } from "vitest";
import { hashText } from "../../src/core/hash.js";
import { ContextAssembler } from "../../src/context/context-assembler.js";
import { RawIngestService } from "../../src/ingest/raw-ingest.js";
import { ToolFacade } from "../../src/tools/tool-facade.js";
import { createInitializedStore } from "../helpers/db.js";

describe("ContextAssembler", () => {
  it("does not include recent raw timeline even when requested", () => {
    const store = createInitializedStore();
    new RawIngestService(store).ingestTurn({
      agent_id: "agent-1",
      session_id: "session-1",
      turn_id: "turn-1",
      turn_index: 0,
      messages: [
        {
          role: "user",
          text: "recent raw only",
          observed_at: "2026-01-01T00:00:00.000Z",
          message_index: 0
        }
      ]
    });

    const block = new ContextAssembler(new ToolFacade(store)).assembleContext({
      agent_id: "agent-1",
      session_id: "session-1",
      budget_tokens: 10,
      include_recent: true,
      auto_recall: false
    });

    expect(block.recent_raw_timeline).toEqual([]);
  });

  it("does not include recent raw timeline across sessions for the same agent", () => {
    const store = createInitializedStore();
    const ingest = new RawIngestService(store);
    ingest.ingestTurn({
      agent_id: "agent-1",
      session_id: "old-session",
      turn_id: "turn-1",
      turn_index: 0,
      messages: [
        {
          role: "user",
          text: "old setup memory",
          observed_at: "2026-01-01T00:00:00.000Z",
          message_index: 0
        }
      ]
    });
    ingest.ingestTurn({
      agent_id: "agent-1",
      session_id: "different-session",
      turn_id: "turn-2",
      turn_index: 1,
      messages: [
        {
          role: "user",
          text: "latest cross-session memory",
          observed_at: "2026-02-01T00:00:00.000Z",
          message_index: 0
        }
      ]
    });

    const block = new ContextAssembler(new ToolFacade(store), {
      context: {
        enabled: true,
        maxTokens: 100,
        recentTurns: 1,
        recentMessages: 1,
        autoRecallEnabled: false,
        autoRecallMaxQueries: 1,
        evidenceMaxItems: 2,
        evidenceMaxTokens: 100,
        includePathExplanations: true,
        candidatePreviewEnabled: false
      },
      summary: {
        schemaEnabled: true,
        resolverEnabled: true,
        autoBuildEnabled: false,
        mode: "manual",
        provider: "none"
      }
    }).assembleContext({
      agent_id: "agent-1",
      session_id: "new-session",
      budget_tokens: 100,
      include_recent: true,
      auto_recall: false
    });

    expect(block.recent_raw_timeline).toEqual([]);
  });

  it("includes verified evidence only when auto recall is enabled by config", () => {
    const store = createInitializedStore();
    new RawIngestService(store).ingestTurn({
      agent_id: "agent-1",
      session_id: "session-1",
      turn_id: "turn-1",
      turn_index: 0,
      messages: [
        {
          role: "user",
          text: "verified recall context",
          observed_at: "2026-01-01T00:00:00.000Z",
          message_index: 0
        }
      ]
    });

    const block = new ContextAssembler(new ToolFacade(store), {
      context: {
        enabled: true,
        maxTokens: 100,
        recentTurns: 1,
        recentMessages: 2,
        autoRecallEnabled: true,
        autoRecallMaxQueries: 1,
        evidenceMaxItems: 2,
        evidenceMaxTokens: 100,
        includePathExplanations: true,
        candidatePreviewEnabled: false
      },
      summary: {
        schemaEnabled: true,
        resolverEnabled: true,
        autoBuildEnabled: false,
        mode: "manual",
        provider: "none"
      }
    }).assembleContext({
      agent_id: "agent-1",
      session_id: "session-1",
      current_prompt: "verified recall",
      budget_tokens: 100,
      include_recent: false,
      auto_recall: true
    });

    expect(block.verified_evidence[0]?.text).toBe("verified recall context");
    expect(JSON.stringify(block)).not.toContain("candidate route as fact");
    expect(JSON.stringify(block)).not.toContain(".sqlite");
  });

  it("auto recall only searches current-session verified evidence", () => {
    const store = createInitializedStore();
    new RawIngestService(store).ingestTurn({
      agent_id: "agent-1",
      session_id: "old-session",
      turn_id: "turn-1",
      turn_index: 0,
      messages: [
        {
          role: "user",
          text: "密码：柚子茶8842",
          observed_at: "2026-01-01T00:00:00.000Z",
          message_index: 0
        }
      ]
    });

    const block = new ContextAssembler(new ToolFacade(store), {
      context: {
        enabled: true,
        maxTokens: 100,
        recentTurns: 1,
        recentMessages: 2,
        autoRecallEnabled: true,
        autoRecallMaxQueries: 1,
        evidenceMaxItems: 2,
        evidenceMaxTokens: 100,
        includePathExplanations: true,
        candidatePreviewEnabled: false
      },
      summary: {
        schemaEnabled: true,
        resolverEnabled: true,
        autoBuildEnabled: false,
        mode: "manual",
        provider: "none"
      }
    }).assembleContext({
      agent_id: "agent-1",
      session_id: "new-session",
      current_prompt: "我的密码是什么",
      budget_tokens: 100,
      include_recent: false,
      auto_recall: true
    });

    expect(block.verified_evidence.map((item) => item.text)).not.toContain("密码：柚子茶8842");
    expect(block.verified_evidence).toEqual([]);
  });

  it("auto recall blocks cross-agent evidence paths by default", () => {
    const store = createInitializedStore();
    const rawHash = hashText("auto recall cross agent proof");
    store.createNode({
      node_id: "decision-auto-cross-agent",
      agent_id: "agent-1",
      session_id: null,
      node_type: "decision",
      created_at: "2026-01-01T00:00:00.000Z",
      content_hash: hashText("auto recall decision")
    });
    store.insertFtsNode({
      node_id: "decision-auto-cross-agent",
      agent_id: "agent-1",
      session_id: null,
      node_type: "decision",
      text: "auto recall proof route"
    });
    store.createNode({
      node_id: "raw-auto-cross-agent",
      agent_id: "agent-2",
      session_id: "session-2",
      node_type: "raw_message",
      created_at: "2026-01-01T00:00:00.000Z",
      content_hash: rawHash
    });
    store.createRawPayload({
      node_id: "raw-auto-cross-agent",
      role: "user",
      text: "auto recall cross agent proof",
      normalized_text: "auto recall cross agent proof",
      token_count: 5,
      turn_id: "turn-2",
      turn_index: 0,
      message_index: 0,
      source_hash: rawHash
    });
    store.createEdge({
      edge_id: "edge-auto-cross-agent",
      agent_id: "agent-2",
      from_node_id: "decision-auto-cross-agent",
      to_node_id: "raw-auto-cross-agent",
      edge_type: "EVIDENCED_BY_RAW",
      edge_class: "evidence",
      created_at: "2026-01-01T00:00:00.000Z",
      target_hash: rawHash
    });

    const block = new ContextAssembler(new ToolFacade(store), {
      context: {
        enabled: true,
        maxTokens: 100,
        recentTurns: 1,
        recentMessages: 2,
        autoRecallEnabled: true,
        autoRecallMaxQueries: 1,
        evidenceMaxItems: 2,
        evidenceMaxTokens: 100,
        includePathExplanations: true,
        candidatePreviewEnabled: false
      },
      summary: {
        schemaEnabled: true,
        resolverEnabled: true,
        autoBuildEnabled: false,
        mode: "manual",
        provider: "none"
      }
    }).assembleContext({
      agent_id: "agent-1",
      session_id: "session-1",
      current_prompt: "auto recall proof",
      budget_tokens: 100,
      include_recent: false,
      auto_recall: true
    });

    expect(block.verified_evidence).toEqual([]);
  });
});
