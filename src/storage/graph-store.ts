import type { EdgeClass, EdgeType, NodeStatus, NodeType, RawMessageRole } from "../core/contracts.js";
import type { SqliteDatabase } from "./schema.js";

export interface MemoryNode {
  node_id: string;
  agent_id: string;
  session_id: string | null;
  node_type: NodeType;
  status: NodeStatus;
  created_at: string;
  updated_at: string;
  observed_at: string | null;
  valid_from: string | null;
  valid_to: string | null;
  invalidated_at: string | null;
  content_hash: string;
  metadata_json: string;
}

export interface MemoryEdge {
  edge_id: string;
  agent_id: string;
  from_node_id: string;
  to_node_id: string;
  edge_type: EdgeType;
  edge_class: EdgeClass;
  created_at: string;
  observed_at: string | null;
  valid_from: string | null;
  valid_to: string | null;
  invalidated_at: string | null;
  target_hash: string;
  weight: number;
  confidence: number;
  metadata_json: string;
}

export interface RawPayload {
  node_id: string;
  role: RawMessageRole;
  text: string;
  normalized_text: string;
  token_count: number;
  turn_id: string;
  turn_index: number;
  message_index: number;
  source_hash: string;
}

export interface SummaryPayload {
  node_id: string;
  text: string;
  source_node_count: number;
  summary_hash: string;
}

export interface EvidencePacketAuditInput {
  packet_id: string;
  query_id?: string | null;
  candidate_node_id?: string | null;
  result_class?: "evidence" | "status";
  evidence_count: number;
  blocked_count: number;
  created_at: string;
  metadata_json?: string;
}

export interface CreateNodeInput {
  node_id: string;
  agent_id: string;
  session_id?: string | null;
  node_type: NodeType;
  status?: NodeStatus;
  created_at: string;
  updated_at?: string;
  observed_at?: string | null;
  valid_from?: string | null;
  valid_to?: string | null;
  invalidated_at?: string | null;
  content_hash: string;
  metadata_json?: string;
}

export interface CreateEdgeInput {
  edge_id: string;
  agent_id: string;
  from_node_id: string;
  to_node_id: string;
  edge_type: EdgeType;
  edge_class: EdgeClass;
  created_at: string;
  observed_at?: string | null;
  valid_from?: string | null;
  valid_to?: string | null;
  invalidated_at?: string | null;
  target_hash: string;
  weight?: number;
  confidence?: number;
  metadata_json?: string;
}

export interface CreateRawPayloadInput {
  node_id: string;
  role: RawMessageRole;
  text: string;
  normalized_text: string;
  token_count: number;
  turn_id: string;
  turn_index: number;
  message_index: number;
  source_hash: string;
}

export interface FtsNodeInput {
  node_id: string;
  agent_id: string;
  session_id?: string | null;
  node_type: NodeType;
  text: string;
}

export interface FtsSearchRow {
  node_id: string;
  node_type: NodeType;
  score: number;
}

export interface RawTimelineItem {
  node: MemoryNode;
  payload: RawPayload;
}

export interface RetrievalRunAuditInput {
  run_id: string;
  agent_id: string;
  session_id?: string | null;
  query?: string | null;
  result_class: "candidate" | "evidence" | "status";
  seed_count?: number;
  evidence_count?: number;
  blocked_count?: number;
  created_at: string;
  metadata_json?: string;
}

export interface EdgeFilter {
  edge_class?: EdgeClass;
  edge_type?: EdgeType;
}

export class GraphStore {
  constructor(private readonly db: SqliteDatabase) {}

  rawDb(): SqliteDatabase {
    return this.db;
  }

  transaction<T>(work: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  createNode(input: CreateNodeInput): void {
    this.db
      .prepare(
        `INSERT INTO memory_nodes (
          node_id, agent_id, session_id, node_type, status, created_at, updated_at,
          observed_at, valid_from, valid_to, invalidated_at, content_hash, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.node_id,
        input.agent_id,
        input.session_id ?? null,
        input.node_type,
        input.status ?? "active",
        input.created_at,
        input.updated_at ?? input.created_at,
        input.observed_at ?? null,
        input.valid_from ?? null,
        input.valid_to ?? null,
        input.invalidated_at ?? null,
        input.content_hash,
        input.metadata_json ?? "{}"
      );
  }

  createEdge(input: CreateEdgeInput): void {
    this.db
      .prepare(
        `INSERT INTO memory_edges (
          edge_id, agent_id, from_node_id, to_node_id, edge_type, edge_class,
          created_at, observed_at, valid_from, valid_to, invalidated_at,
          target_hash, weight, confidence, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.edge_id,
        input.agent_id,
        input.from_node_id,
        input.to_node_id,
        input.edge_type,
        input.edge_class,
        input.created_at,
        input.observed_at ?? null,
        input.valid_from ?? null,
        input.valid_to ?? null,
        input.invalidated_at ?? null,
        input.target_hash,
        input.weight ?? 1,
        input.confidence ?? 1,
        input.metadata_json ?? "{}"
      );
  }

  createRawPayload(input: CreateRawPayloadInput): void {
    this.db
      .prepare(
        `INSERT INTO raw_payloads (
          node_id, role, text, normalized_text, token_count,
          turn_id, turn_index, message_index, source_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.node_id,
        input.role,
        input.text,
        input.normalized_text,
        input.token_count,
        input.turn_id,
        input.turn_index,
        input.message_index,
        input.source_hash
      );
  }

  createSummaryPayload(input: SummaryPayload): void {
    this.db
      .prepare(
        `INSERT INTO summary_payloads (
          node_id, text, source_node_count, summary_hash
        ) VALUES (?, ?, ?, ?)`
      )
      .run(input.node_id, input.text, input.source_node_count, input.summary_hash);
  }

  insertFtsNode(input: FtsNodeInput): void {
    this.db
      .prepare(
        "INSERT INTO node_fts(node_id, agent_id, session_id, node_type, text) VALUES (?, ?, ?, ?, ?)"
      )
      .run(input.node_id, input.agent_id, input.session_id ?? null, input.node_type, input.text);
  }

  insertEvidencePacketAudit(input: EvidencePacketAuditInput): void {
    this.db
      .prepare(
        `INSERT INTO evidence_packets (
          packet_id, query_id, candidate_node_id, result_class,
          evidence_count, blocked_count, created_at, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.packet_id,
        input.query_id ?? null,
        input.candidate_node_id ?? null,
        input.result_class ?? "evidence",
        input.evidence_count,
        input.blocked_count,
        input.created_at,
        input.metadata_json ?? "{}"
      );
  }

  insertRetrievalRun(input: RetrievalRunAuditInput): void {
    this.db
      .prepare(
        `INSERT INTO retrieval_runs (
          run_id, agent_id, session_id, query, result_class, seed_count,
          evidence_count, blocked_count, created_at, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.run_id,
        input.agent_id,
        input.session_id ?? null,
        input.query ?? null,
        input.result_class,
        input.seed_count ?? 0,
        input.evidence_count ?? 0,
        input.blocked_count ?? 0,
        input.created_at,
        input.metadata_json ?? "{}"
      );
  }

  searchFts(query: string, agentId: string, sessionId: string | undefined, limit: number): FtsSearchRow[] {
    const sessionClause = sessionId ? "AND session_id = ?" : "";
    const params: unknown[] = [escapeFtsQuery(query), agentId];
    if (sessionId) params.push(sessionId);
    params.push(limit);

    return this.db
      .prepare(
        `SELECT node_id, node_type, rank AS score
         FROM node_fts
         WHERE node_fts MATCH ? AND agent_id = ? ${sessionClause}
         ORDER BY rank
         LIMIT ?`
      )
      .all(...params) as FtsSearchRow[];
  }

  listRawTimeline(input: {
    agent_id: string;
    session_id?: string;
    since?: string;
    until?: string;
    limit: number;
  }): RawTimelineItem[] {
    const clauses = ["n.agent_id = ?", "n.node_type = 'raw_message'"];
    const params: unknown[] = [input.agent_id];
    if (input.session_id) {
      clauses.push("n.session_id = ?");
      params.push(input.session_id);
    }
    if (input.since) {
      clauses.push("n.observed_at >= ?");
      params.push(input.since);
    }
    if (input.until) {
      clauses.push("n.observed_at <= ?");
      params.push(input.until);
    }
    params.push(input.limit);

    const rows = this.db
      .prepare(
        `SELECT
          n.node_id, n.agent_id, n.session_id, n.node_type, n.status, n.created_at,
          n.updated_at, n.observed_at, n.valid_from, n.valid_to, n.invalidated_at,
          n.content_hash, n.metadata_json,
          p.role, p.text, p.normalized_text, p.token_count, p.turn_id,
          p.turn_index, p.message_index, p.source_hash
        FROM memory_nodes n
        JOIN raw_payloads p ON p.node_id = n.node_id
        WHERE ${clauses.join(" AND ")}
        ORDER BY n.observed_at, p.turn_index, p.message_index
        LIMIT ?`
      )
      .all(...params) as Array<MemoryNode & RawPayload>;

    return rows.map((row) => ({
      node: {
        node_id: row.node_id,
        agent_id: row.agent_id,
        session_id: row.session_id,
        node_type: row.node_type,
        status: row.status,
        created_at: row.created_at,
        updated_at: row.updated_at,
        observed_at: row.observed_at,
        valid_from: row.valid_from,
        valid_to: row.valid_to,
        invalidated_at: row.invalidated_at,
        content_hash: row.content_hash,
        metadata_json: row.metadata_json
      },
      payload: {
        node_id: row.node_id,
        role: row.role,
        text: row.text,
        normalized_text: row.normalized_text,
        token_count: row.token_count,
        turn_id: row.turn_id,
        turn_index: row.turn_index,
        message_index: row.message_index,
        source_hash: row.source_hash
      }
    }));
  }

  getNode(nodeId: string): MemoryNode | undefined {
    return this.db.prepare("SELECT * FROM memory_nodes WHERE node_id = ?").get(nodeId) as
      | MemoryNode
      | undefined;
  }

  getRawPayload(nodeId: string): RawPayload | undefined {
    return this.db.prepare("SELECT * FROM raw_payloads WHERE node_id = ?").get(nodeId) as
      | RawPayload
      | undefined;
  }

  getSummaryPayload(nodeId: string): SummaryPayload | undefined {
    return this.db.prepare("SELECT * FROM summary_payloads WHERE node_id = ?").get(nodeId) as
      | SummaryPayload
      | undefined;
  }

  listOutgoingEdges(nodeId: string, filter: EdgeFilter = {}): MemoryEdge[] {
    return this.listEdges("from_node_id", nodeId, filter);
  }

  listIncomingEdges(nodeId: string, filter: EdgeFilter = {}): MemoryEdge[] {
    return this.listEdges("to_node_id", nodeId, filter);
  }

  countRows(tableName: string): number {
    if (!/^[a-z_]+$/.test(tableName)) {
      throw new TypeError(`Unsafe table name: ${tableName}`);
    }
    const row = this.db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get() as {
      count: number;
    };
    return row.count;
  }

  private listEdges(column: "from_node_id" | "to_node_id", nodeId: string, filter: EdgeFilter): MemoryEdge[] {
    const clauses = [`${column} = ?`];
    const params: unknown[] = [nodeId];
    if (filter.edge_class) {
      clauses.push("edge_class = ?");
      params.push(filter.edge_class);
    }
    if (filter.edge_type) {
      clauses.push("edge_type = ?");
      params.push(filter.edge_type);
    }

    return this.db
      .prepare(`SELECT * FROM memory_edges WHERE ${clauses.join(" AND ")} ORDER BY created_at, edge_id`)
      .all(...params) as MemoryEdge[];
  }
}

function escapeFtsQuery(query: string): string {
  return query
    .split(/\s+/u)
    .filter((term) => term.length > 0)
    .map((term) => `"${term.replaceAll('"', '""')}"`)
    .join(" ");
}
