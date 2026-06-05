import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
}
