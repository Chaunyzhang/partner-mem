import type { FtsSearchRow, MemoryNode } from "../storage/graph-store.js";
import { GraphStore } from "../storage/graph-store.js";

export interface SearchQuery {
  query: string;
  agent_id: string;
  session_id?: string;
  time_window?: {
    since?: string;
    until?: string;
  };
  limit: number;
}

export interface CandidateRoute {
  result_class: "candidate";
  seed_node_id: string;
  score: number;
  route: string[];
  why: string;
}

const GRAPH_EXPANDABLE_NODE_TYPES = new Set(["entity", "event", "task", "decision"]);

export class SeedIndex {
  constructor(private readonly store: GraphStore) {}

  search(input: SearchQuery): CandidateRoute[] {
    if (input.query.trim().length === 0) return [];
    const rows = this.store.searchFts(
      input.query,
      input.agent_id,
      input.session_id,
      input.time_window,
      input.limit
    );
    const directCandidates: CandidateRoute[] = [];
    const graphCandidates: CandidateRoute[] = [];
    const seenNodeIds = new Set<string>();

    for (const row of rows) {
      appendCandidate(directCandidates, seenNodeIds, toCandidateRoute(row));
    }

    for (const row of rows) {
      for (const graphCandidate of this.expandRawSeedToTypedCandidates(row, input.agent_id)) {
        appendCandidate(graphCandidates, seenNodeIds, graphCandidate);
      }
      if (graphCandidates.length >= input.limit) break;
    }

    return [...directCandidates, ...graphCandidates.slice(0, input.limit)];
  }

  private expandRawSeedToTypedCandidates(row: FtsSearchRow, agentId: string): CandidateRoute[] {
    if (row.node_type !== "raw_message") return [];

    const source = this.store.getNode(row.node_id);
    if (!source || source.agent_id !== agentId || source.status !== "active") return [];

    return this.store
      .listIncomingEdges(row.node_id, { edge_class: "evidence", edge_type: "EVIDENCED_BY_RAW" })
      .filter((edge) => edge.agent_id === agentId)
      .flatMap((edge) => {
        const typedNode = this.store.getNode(edge.from_node_id);
        if (!isGraphExpansionCandidate(typedNode, agentId)) return [];
        return [
          {
            result_class: "candidate",
            seed_node_id: typedNode.node_id,
            score: row.score + 1,
            route: [row.node_id, typedNode.node_id],
            why: `FTS seed matched raw_message; graph-expanded via ${edge.edge_type} to ${typedNode.node_type}`
          }
        ];
      });
  }
}

function appendCandidate(candidates: CandidateRoute[], seenNodeIds: Set<string>, candidate: CandidateRoute): void {
  if (seenNodeIds.has(candidate.seed_node_id)) return;
  candidates.push(candidate);
  seenNodeIds.add(candidate.seed_node_id);
}

function toCandidateRoute(row: FtsSearchRow): CandidateRoute {
  return {
    result_class: "candidate",
    seed_node_id: row.node_id,
    score: row.score,
    route: [row.node_id],
    why: `FTS seed matched ${row.node_type}`
  };
}

function isGraphExpansionCandidate(node: MemoryNode | undefined, agentId: string): node is MemoryNode {
  return Boolean(
    node &&
      node.agent_id === agentId &&
      node.status === "active" &&
      GRAPH_EXPANDABLE_NODE_TYPES.has(node.node_type)
  );
}
