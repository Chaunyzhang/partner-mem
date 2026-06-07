import { randomUUID } from "node:crypto";
import { buildEvidencePacket, type EvidenceItem, type EvidencePacket } from "../evidence/evidence-packet-builder.js";
import { EvidenceResolver } from "../evidence/evidence-resolver.js";
import { SeedIndex, type CandidateRoute, type SearchQuery } from "../search/seed-index.js";
import { GraphStore } from "../storage/graph-store.js";

export interface RecallQuery {
  query: string;
  agent_id: string;
  session_id?: string;
  time_window?: {
    since?: string;
    until?: string;
  };
  limit: number;
  /** When true, traversal may follow edges owned by other agents. Default false. */
  allow_cross_agent?: boolean;
}

export interface TimelineQuery {
  agent_id: string;
  session_id?: string;
  since?: string;
  until?: string;
  limit: number;
}

export interface TimelineResult {
  result_class: "evidence";
  evidence_items: EvidenceItem[];
}

export class RecallRouter {
  private readonly seedIndex: SeedIndex;
  private readonly resolver: EvidenceResolver;

  constructor(private readonly store: GraphStore) {
    this.seedIndex = new SeedIndex(store);
    this.resolver = new EvidenceResolver(store);
  }

  search(input: SearchQuery): CandidateRoute[] {
    const candidates = this.seedIndex.search(input);
    this.store.insertRetrievalRun({
      run_id: randomUUID(),
      agent_id: input.agent_id,
      ...(input.session_id ? { session_id: input.session_id } : {}),
      query: input.query,
      result_class: "candidate",
      seed_count: candidates.length,
      created_at: new Date().toISOString()
    });
    return candidates;
  }

  recall(input: RecallQuery): EvidencePacket {
    const candidates = this.seedIndex.search(input);
    const evidenceItems: EvidenceItem[] = [];
    const seenRawNodeIds = new Set<string>();
    const blockedPaths: EvidencePacket["blocked_paths"] = [];

    for (const candidate of candidates) {
      const evidenceInput: Parameters<typeof this.resolver.resolveEvidence>[0] = {
        candidate_node_id: candidate.seed_node_id,
        max_evidence_items: input.limit,
        agent_id: input.agent_id
      };
      if (input.allow_cross_agent !== undefined) evidenceInput.allow_cross_agent = input.allow_cross_agent;
      const packet = this.resolver.resolveEvidence(evidenceInput);
      for (const item of packet.evidence_items) {
        if (seenRawNodeIds.has(item.raw_node_id)) continue;
        evidenceItems.push(item);
        seenRawNodeIds.add(item.raw_node_id);
      }
      blockedPaths.push(...packet.blocked_paths);
      if (evidenceItems.length >= input.limit) break;
    }

    const packet = {
      ...buildEvidencePacket([], blockedPaths, randomUUID()),
      evidence_items: evidenceItems.slice(0, input.limit)
    };
    this.store.insertRetrievalRun({
      run_id: randomUUID(),
      agent_id: input.agent_id,
      ...(input.session_id ? { session_id: input.session_id } : {}),
      query: input.query,
      result_class: "evidence",
      seed_count: candidates.length,
      evidence_count: packet.evidence_items.length,
      blocked_count: packet.blocked_paths.length,
      created_at: packet.created_at
    });
    return packet;
  }

  timeline(input: TimelineQuery): TimelineResult {
    const rows = this.store.listRawTimeline(input);
    return {
      result_class: "evidence",
      evidence_items: rows.map(({ node, payload }) => ({
        raw_node_id: node.node_id,
        role: payload.role,
        text: payload.text,
        observed_at: node.observed_at,
        session_id: node.session_id,
        turn_id: payload.turn_id,
        turn_index: payload.turn_index,
        message_index: payload.message_index,
        source_hash: payload.source_hash,
        path: []
      }))
    };
  }
}
