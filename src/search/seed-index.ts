import type { FtsSearchRow } from "../storage/graph-store.js";
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
    return rows.map((row) => toCandidateRoute(row));
  }
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
