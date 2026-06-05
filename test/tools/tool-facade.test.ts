import { describe, expect, it } from "vitest";
import { RawIngestService } from "../../src/ingest/raw-ingest.js";
import { ToolFacade } from "../../src/tools/tool-facade.js";
import { createInitializedStore } from "../helpers/db.js";

describe("ToolFacade", () => {
  it("exposes search, recall, timeline, and status through host-neutral methods", () => {
    const store = createInitializedStore();
    new RawIngestService(store).ingestTurn({
      agent_id: "agent-1",
      session_id: "session-1",
      turn_id: "turn-1",
      turn_index: 0,
      messages: [
        {
          role: "user",
          text: "Timeline first.",
          observed_at: "2026-01-01T00:00:00.000Z",
          message_index: 0
        },
        {
          role: "assistant",
          text: "Timeline second.",
          observed_at: "2026-01-01T00:00:01.000Z",
          message_index: 1
        }
      ]
    });
    const facade = new ToolFacade(store);

    expect(
      facade.partner_mem_search({
        query: "Timeline",
        agent_id: "agent-1",
        limit: 5
      })[0]?.result_class
    ).toBe("candidate");
    expect(
      facade.partner_mem_recall({
        query: "first",
        agent_id: "agent-1",
        limit: 5
      }).evidence_items[0]?.text
    ).toBe("Timeline first.");
    expect(
      facade
        .partner_mem_timeline({
          agent_id: "agent-1",
          limit: 5
        })
        .evidence_items.map((item) => item.text)
    ).toEqual(["Timeline first.", "Timeline second."]);
    expect(facade.partner_mem_status()).toMatchObject({
      result_class: "status",
      schema: "healthy",
      fts: { available: true }
    });
  });

  it("does not expose private database paths in status", () => {
    const statusText = JSON.stringify(new ToolFacade(createInitializedStore()).partner_mem_status());

    expect(statusText).not.toContain(".sqlite");
    expect(statusText).not.toContain("dbPath");
    expect(statusText).not.toContain("databasePath");
  });
});
