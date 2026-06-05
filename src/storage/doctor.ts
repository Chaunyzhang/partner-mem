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

  return {
    status: missingTables.length === 0 && fts ? "healthy" : "unhealthy",
    missingTables,
    fts: {
      available: fts
    },
    graph: {
      hasNodesTable: existingTables.has("memory_nodes"),
      hasEdgesTable: existingTables.has("memory_edges")
    },
    evidence: {
      hasPacketsTable: existingTables.has("evidence_packets")
    },
    config: {
      defaultsLoaded: true
    }
  };
}
