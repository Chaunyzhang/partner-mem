import { describe, expect, it, vi } from "vitest";
import { RawIngestService } from "../../src/ingest/raw-ingest.js";
import {
  EXTRACTION_SCHEMA_VERSION,
  ModelExtractionError,
  type ExtractorModelClient
} from "../../src/extraction/extraction-contracts.js";
import { ExtractorService } from "../../src/extraction/extractor-service.js";
import { createInitializedStore } from "../helpers/db.js";

describe("ExtractorService", () => {
  it("orchestrates model proposal validation and typed graph writes for raw nodes", async () => {
    const store = createInitializedStore();
    const rawId = ingest(store, "Remember Project Quartz password is QZ-8842.");
    const service = new ExtractorService(store, {
      async extractRawMessage(input) {
        return {
          schema_version: EXTRACTION_SCHEMA_VERSION,
          raw_node_id: input.raw_node_id,
          items: [
            {
              provisional_id: "item-1",
              node_type: "entity",
              label: "Project Quartz",
              text: "Project Quartz password is QZ-8842",
              evidence_text: "QZ-8842",
              attributes: [{ key: "password", value: "QZ-8842", evidence_text: "QZ-8842" }],
              temporal: { source_text: null, valid_from: null, valid_to: null, granularity: "none" },
              confidence: 0.9
            }
          ]
        };
      }
    });

    const result = await service.extractRawNodes([rawId]);

    expect(result.rejected_items).toEqual([]);
    expect(result.accepted_items).toHaveLength(1);
    expect(store.countRows("memory_nodes")).toBe(2);
    expect(store.countRows("memory_edges")).toBe(1);
  });

  it("writes nothing when the model is unavailable or returns invalid JSON", async () => {
    const store = createInitializedStore();
    const rawId = ingest(store, "Remember Project Quartz password is QZ-8842.");
    const client: ExtractorModelClient = {
      async extractRawMessage() {
        throw new ModelExtractionError("model_invalid_json", "LLM returned invalid JSON");
      }
    };

    const result = await new ExtractorService(store, client).extractRawNodes([rawId]);

    expect(result.accepted_items).toEqual([]);
    expect(result.rejected_items[0]?.reason).toBe("model_invalid_json");
    expect(store.countRows("memory_nodes")).toBe(1);
    expect(store.countRows("memory_edges")).toBe(0);
    expect(store.countRows("node_fts")).toBe(1);
  });

  it("rejects missing raw nodes before calling the model", async () => {
    let called = false;
    const result = await new ExtractorService(createInitializedStore(), {
      async extractRawMessage() {
        called = true;
        throw new Error("should not call model");
      }
    }).extractRawNodes(["missing-raw"]);

    expect(called).toBe(false);
    expect(result.rejected_items[0]?.reason).toBe("missing_raw_node");
  });

  it("surfaces core write failures instead of reporting them as model JSON errors", async () => {
    const store = createInitializedStore();
    const rawId = ingest(store, "Remember Project Quartz password is QZ-8842.");
    vi.spyOn(store, "replaceFtsNode").mockImplementation(() => {
      throw new Error("fts write failed");
    });

    const service = new ExtractorService(store, {
      async extractRawMessage(input) {
        return {
          schema_version: EXTRACTION_SCHEMA_VERSION,
          raw_node_id: input.raw_node_id,
          items: [
            {
              provisional_id: "item-1",
              node_type: "entity",
              label: "Project Quartz",
              text: "Project Quartz password is QZ-8842",
              evidence_text: "QZ-8842",
              attributes: [],
              temporal: { source_text: null, valid_from: null, valid_to: null, granularity: "none" },
              confidence: 0.9
            }
          ]
        };
      }
    });

    await expect(service.extractRawNodes([rawId])).rejects.toThrow("fts write failed");
  });
});

function ingest(store: ReturnType<typeof createInitializedStore>, text: string): string {
  const result = new RawIngestService(store).ingestTurn({
    agent_id: "agent-1",
    session_id: "session-1",
    turn_id: "turn-1",
    turn_index: 0,
    messages: [{ role: "user", text, observed_at: "2026-06-01T00:00:00.000Z", message_index: 0 }]
  });
  return result.raw_node_ids[0] ?? "";
}
