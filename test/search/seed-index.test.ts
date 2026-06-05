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
});
