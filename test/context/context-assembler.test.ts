import { describe, expect, it } from "vitest";
import { ContextAssembler } from "../../src/context/context-assembler.js";
import { RawIngestService } from "../../src/ingest/raw-ingest.js";
import { ToolFacade } from "../../src/tools/tool-facade.js";
import { createInitializedStore } from "../helpers/db.js";

describe("ContextAssembler", () => {
  it("includes recent raw timeline when enabled", () => {
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

    expect(block.recent_raw_timeline[0]?.text).toBe("recent raw only");
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
});
