import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { TurnIngestService } from "../../src/ingest/turn-ingest-service.js";
import { PartnerMemStore } from "../../src/storage/partner-mem-store.js";
import { RetrievalFacade } from "../../src/tools/retrieval-facade.js";
import {
  MODEL_VISIBLE_TOOL_NAMES,
  MODEL_VISIBLE_TOOL_SCHEMAS
} from "../../src/tools/tool-contracts.js";
import { createTestDatabase } from "../helpers/database.js";

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

describe("model-visible retrieval tool contracts", () => {
  it("exposes exactly three schemas and keeps the generated artifact identical", () => {
    const artifact = JSON.parse(
      readFileSync(
        fileURLToPath(
          new URL(
            "../../src/tools/generated/tool-schemas.json",
            import.meta.url
          )
        ),
        "utf8"
      )
    );
    expect(artifact).toEqual(MODEL_VISIBLE_TOOL_SCHEMAS);
    expect(MODEL_VISIBLE_TOOL_NAMES).toEqual([
      "partner_mem_keyword_search",
      "partner_mem_vector_search",
      "partner_mem_graph_traverse"
    ]);
    const serialized = JSON.stringify(artifact);
    expect(serialized).not.toMatch(
      /partner_mem_(search|recall|timeline|status)|get_node|hybrid|edge_type/
    );
  });

  it("rejects identity injection, vector controls, graph query fields, and limits", async () => {
    const fixture = createTestDatabase();
    cleanups.push(fixture.close);
    const store = new PartnerMemStore(fixture.db);
    const harness = store.registerHarness("tool-input-test");
    const node = new TurnIngestService(store).recordQuestion({
      harness_id: harness.harness_id,
      source_conversation_id: "current",
      text: "可检索内容"
    });
    const facade = new RetrievalFacade(store);
    const identity = {
      harness_id: harness.harness_id,
      conversation_id: node.conversation_id
    };
    const invalidCalls = [
      facade.invoke(
        "partner_mem_keyword_search",
        { query: "内容", harness_id: harness.harness_id },
        identity
      ),
      facade.invoke(
        "partner_mem_vector_search",
        { query: "内容", vector: [1, 2], model: "forbidden" },
        identity
      ),
      facade.invoke(
        "partner_mem_graph_traverse",
        {
          start_node_id: node.node_id,
          direction: "both",
          query: "forbidden",
          scope: "current_conversation",
          edge_type: "reply"
        },
        identity
      ),
      facade.invoke(
        "partner_mem_keyword_search",
        { query: "内容", limit: 21 },
        identity
      ),
      facade.invoke(
        "partner_mem_graph_traverse",
        {
          start_node_id: node.node_id,
          direction: "both",
          max_depth: 4
        },
        identity
      ),
      facade.invoke(
        "partner_mem_keyword_search",
        { query: "   " },
        identity
      ),
      facade.invoke(
        "partner_mem_keyword_search",
        { query: "内容", scope: "all_harnesses" },
        identity
      ),
      facade.invoke(
        "partner_mem_keyword_search",
        { query: "内容", limit: 0 },
        identity
      ),
      facade.invoke(
        "partner_mem_graph_traverse",
        {
          start_node_id: node.node_id,
          direction: "sideways",
          max_depth: 1
        },
        identity
      ),
      facade.invoke(
        "partner_mem_graph_traverse",
        {
          start_node_id: node.node_id,
          direction: "both",
          max_depth: 0
        },
        identity
      ),
      facade.invoke(
        "partner_mem_keyword_search",
        { query: "内容", scope: null },
        identity
      ),
      facade.invoke(
        "partner_mem_vector_search",
        { query: "内容", limit: null },
        identity
      ),
      facade.invoke(
        "partner_mem_graph_traverse",
        {
          start_node_id: node.node_id,
          direction: "both",
          max_depth: null,
          limit: null
        },
        identity
      )
    ];
    for (const result of await Promise.all(invalidCalls)) {
      expect(result).toMatchObject({
        status: "error",
        truncated: false,
        error_code: "invalid_tool_input",
        evidence_items: []
      });
    }
  });

  it("requires formal trusted identity and an Agent only for Agent history", async () => {
    const fixture = createTestDatabase();
    cleanups.push(fixture.close);
    const store = new PartnerMemStore(fixture.db);
    const harness = store.registerHarness("trusted-context-test");
    const node = new TurnIngestService(store).recordQuestion({
      harness_id: harness.harness_id,
      source_conversation_id: "current",
      text: "trusted identity"
    });
    const facade = new RetrievalFacade(store);

    expect(
      await facade.invoke(
        "partner_mem_keyword_search",
        { query: "trusted" },
        {
          harness_id: harness.harness_id,
          conversation_id: "raw-host-conversation"
        }
      )
    ).toMatchObject({
      status: "error",
      error_code: "trusted_identity_invalid"
    });
    expect(
      await facade.invoke(
        "partner_mem_keyword_search",
        { query: "trusted", scope: "agent_conversations" },
        {
          harness_id: harness.harness_id,
          conversation_id: node.conversation_id
        }
      )
    ).toMatchObject({
      status: "error",
      error_code: "trusted_identity_invalid"
    });

    const malformedIdentities: unknown[] = [
      null,
      [],
      { harness_id: "   ", conversation_id: node.conversation_id },
      { harness_id: harness.harness_id, conversation_id: "   " },
      {
        harness_id: harness.harness_id,
        conversation_id: node.conversation_id,
        agent_id: {}
      }
    ];
    for (const identity of malformedIdentities) {
      expect(
        await facade.invoke(
          "partner_mem_keyword_search",
          { query: "trusted" },
          identity
        )
      ).toMatchObject({
        status: "error",
        error_code: "trusted_identity_invalid"
      });
    }
  });
});
