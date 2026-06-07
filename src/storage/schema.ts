import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildFtsIndexText } from "./fts-text.js";

export interface SqliteDatabase {
  exec(sql: string): unknown;
  prepare(sql: string): {
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
    run(...params: unknown[]): unknown;
  };
}

const MIGRATION_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "migrations",
  "001_init_graph.sql"
);

export const REQUIRED_TABLES = [
  "memory_nodes",
  "memory_edges",
  "raw_payloads",
  "summary_payloads",
  "node_fts",
  "retrieval_runs",
  "evidence_packets",
  "schema_migrations"
] as const;

export function initializeSchema(db: SqliteDatabase): void {
  db.exec(readFileSync(MIGRATION_PATH, "utf8"));
  backfillCjkFtsIndexText(db);
}

function backfillCjkFtsIndexText(db: SqliteDatabase): void {
  const migrationVersion = "002_cjk_fts_index_text";
  const applied = db.prepare("SELECT version FROM schema_migrations WHERE version = ?").get(migrationVersion);
  if (applied) return;

  const rows = db
    .prepare(
      `SELECT
        n.node_id, n.agent_id, n.session_id, n.node_type, p.text
       FROM memory_nodes n
       JOIN raw_payloads p ON p.node_id = n.node_id
       WHERE n.node_type = 'raw_message'`
    )
    .all() as Array<{
      node_id: string;
      agent_id: string;
      session_id: string | null;
      node_type: string;
      text: string;
    }>;

  for (const row of rows) {
    db.prepare("DELETE FROM node_fts WHERE node_id = ?").run(row.node_id);
    db
      .prepare("INSERT INTO node_fts(node_id, agent_id, session_id, node_type, text) VALUES (?, ?, ?, ?, ?)")
      .run(row.node_id, row.agent_id, row.session_id, row.node_type, buildFtsIndexText(row.text));
  }

  db
    .prepare("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (?, ?)")
    .run(migrationVersion, new Date().toISOString());
}
