import { describe, expect, it } from "vitest";
import { buildEvidencePacket } from "../../src/evidence/evidence-packet-builder.js";
import { hashText } from "../../src/core/hash.js";

describe("EvidencePacketBuilder", () => {
  it("formats verified raw items without using summary text", () => {
    const sourceHash = hashText("original");
    const packet = buildEvidencePacket(
      [
        {
          node: {
            node_id: "raw-1",
            agent_id: "agent-1",
            session_id: "session-1",
            node_type: "raw_message",
            status: "active",
            created_at: "2026-01-01T00:00:00.000Z",
            updated_at: "2026-01-01T00:00:00.000Z",
            observed_at: "2026-01-01T00:00:00.000Z",
            valid_from: null,
            valid_to: null,
            invalidated_at: null,
            content_hash: sourceHash,
            metadata_json: "{}"
          },
          payload: {
            node_id: "raw-1",
            role: "user",
            text: "original",
            normalized_text: "original",
            token_count: 1,
            turn_id: "turn-1",
            turn_index: 0,
            message_index: 0,
            source_hash: sourceHash
          },
          path: []
        }
      ],
      [],
      "query-1",
      "2026-01-01T00:00:00.000Z"
    );

    expect(packet).toMatchObject({
      result_class: "evidence",
      query_id: "query-1",
      evidence_items: [
        {
          raw_node_id: "raw-1",
          text: "original",
          source_hash: sourceHash,
          path: []
        }
      ],
      blocked_paths: []
    });
  });
});
