import { describe, expect, it } from "vitest";
import { RawIngestService } from "../../src/ingest/raw-ingest.js";
import { SeedIndex } from "../../src/search/seed-index.js";
import { createInitializedStore } from "../helpers/db.js";

describe("SeedIndex", () => {
  it("returns candidate routes from FTS seed rows", () => {
    const store = createInitializedStore();
    new RawIngestService(store).ingestTurn({
      agent_id: "agent-1",
      session_id: "session-1",
      turn_id: "turn-1",
      turn_index: 0,
      messages: [
        {
          role: "user",
          text: "Find graph kernel evidence later.",
          observed_at: "2026-01-01T00:00:00.000Z",
          message_index: 0
        }
      ]
    });

    const results = new SeedIndex(store).search({
      query: "kernel",
      agent_id: "agent-1",
      limit: 5
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.result_class).toBe("candidate");
  });

  it("filters FTS seeds by observed time window", () => {
    const store = createInitializedStore();
    new RawIngestService(store).ingestTurn({
      agent_id: "agent-1",
      session_id: "session-1",
      turn_id: "turn-1",
      turn_index: 0,
      messages: [
        {
          role: "user",
          text: "time filter target",
          observed_at: "2026-01-01T00:00:00.000Z",
          message_index: 0
        }
      ]
    });
    new RawIngestService(store).ingestTurn({
      agent_id: "agent-1",
      session_id: "session-1",
      turn_id: "turn-2",
      turn_index: 1,
      messages: [
        {
          role: "user",
          text: "time filter target",
          observed_at: "2026-02-01T00:00:00.000Z",
          message_index: 0
        }
      ]
    });

    const results = new SeedIndex(store).search({
      query: "target",
      agent_id: "agent-1",
      time_window: {
        since: "2026-01-15T00:00:00.000Z",
        until: "2026-02-15T00:00:00.000Z"
      },
      limit: 5
    });

    expect(results).toHaveLength(1);
    expect(store.getNode(results[0]?.seed_node_id ?? "")?.observed_at).toBe("2026-02-01T00:00:00.000Z");
  });
});
