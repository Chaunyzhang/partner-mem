import { REQUIRED_TABLES, type SqliteDatabase } from "./schema.js";

export type SchemaDoctorStatus = "healthy" | "unhealthy";

export interface SchemaDoctorResult {
  status: SchemaDoctorStatus;
  missingTables: string[];
  fts: {
    available: boolean;
  };
  graph: {
    hasNodesTable: boolean;
    hasEdgesTable: boolean;
  };
  evidence: {
    hasPacketsTable: boolean;
    badHashCount: number;
    missingRawPayloadCount: number;
  };
  config: {
    defaultsLoaded: boolean;
  };
}

export function runSchemaDoctor(db: SqliteDatabase): SchemaDoctorResult {
  const existingTables = new Set(
    db
      .prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'virtual table')")
      .all()
      .map((row) => String((row as { name: unknown }).name))
  );

  const missingTables = REQUIRED_TABLES.filter((table) => !existingTables.has(table));
  const fts = existingTables.has("node_fts");

  const badHashCount = existingTables.has("memory_edges") && existingTables.has("memory_nodes")
    ? countBadEvidenceHashes(db)
    : 0;
  const missingRawPayloadCount = existingTables.has("memory_nodes") && existingTables.has("raw_payloads")
    ? countMissingRawPayloads(db)
    : 0;

  return {
    status: missingTables.length === 0 && fts && badHashCount === 0 && missingRawPayloadCount === 0 ? "healthy" : "unhealthy",
    missingTables,
    fts: {
      available: fts
    },
    graph: {
      hasNodesTable: existingTables.has("memory_nodes"),
      hasEdgesTable: existingTables.has("memory_edges")
    },
    evidence: {
      hasPacketsTable: existingTables.has("evidence_packets"),
      badHashCount,
      missingRawPayloadCount
    },
    config: {
      defaultsLoaded: true
    }
  };
}

function countBadEvidenceHashes(db: SqliteDatabase): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM memory_edges e
       JOIN memory_nodes target ON target.node_id = e.to_node_id
       LEFT JOIN raw_payloads raw ON raw.node_id = target.node_id
       WHERE e.edge_class = 'evidence'
       AND e.target_hash != COALESCE(raw.source_hash, target.content_hash)`
    )
    .get() as { count: number };
  return row.count;
}

function countMissingRawPayloads(db: SqliteDatabase): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM memory_nodes n
       LEFT JOIN raw_payloads raw ON raw.node_id = n.node_id
       WHERE n.node_type = 'raw_message' AND raw.node_id IS NULL`
    )
    .get() as { count: number };
  return row.count;
}
