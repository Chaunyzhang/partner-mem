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

export interface EdgeFilter {
  edge_class?: EdgeClass;
  edge_type?: EdgeType;
}

export class GraphStore {
  constructor(private readonly db: SqliteDatabase) {}

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
