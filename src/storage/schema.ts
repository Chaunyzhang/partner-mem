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
  ensureRevisionTrackingSchema(db);
  backfillCjkFtsIndexText(db);
}

function ensureRevisionTrackingSchema(db: SqliteDatabase): void {
  const migrationVersion = "002_revision_tracking";
  const columns = new Set(
    (db.prepare("PRAGMA table_info(memory_nodes)").all() as Array<{ name: string }>).map((column) => column.name)
  );
  const additions = [
    ["topic_group", "TEXT"],
    ["sequence", "INTEGER"],
    ["supersedes", "TEXT"],
    ["superseded_by", "TEXT"]
  ] as const;

  for (const [name, definition] of additions) {
    if (!columns.has(name)) {
      db.exec(`ALTER TABLE memory_nodes ADD COLUMN ${name} ${definition}`);
    }
  }

  ensureRevisionEdgeTypes(db);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_memory_edges_from_class_type
      ON memory_edges(from_node_id, edge_class, edge_type);
    CREATE INDEX IF NOT EXISTS idx_memory_edges_to_class_type
      ON memory_edges(to_node_id, edge_class, edge_type);
    CREATE INDEX IF NOT EXISTS idx_memory_edges_class_type
      ON memory_edges(edge_class, edge_type);
    CREATE INDEX IF NOT EXISTS idx_memory_nodes_topic_sequence
      ON memory_nodes(agent_id, topic_group, sequence);
    CREATE INDEX IF NOT EXISTS idx_memory_nodes_supersedes
      ON memory_nodes(supersedes);
    CREATE INDEX IF NOT EXISTS idx_memory_nodes_superseded_by
      ON memory_nodes(superseded_by);
  `);
  db
    .prepare("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (?, ?)")
    .run(migrationVersion, new Date().toISOString());
}

function ensureRevisionEdgeTypes(db: SqliteDatabase): void {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'memory_edges'").get() as
    | { sql: string }
    | undefined;
  if (!row || row.sql.includes("'correction'")) return;

  db.exec(`
    DROP TABLE IF EXISTS memory_edges_revision_migration;
    CREATE TABLE memory_edges_revision_migration (
      edge_id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      from_node_id TEXT NOT NULL,
      to_node_id TEXT NOT NULL,
      edge_type TEXT NOT NULL,
      edge_class TEXT NOT NULL,
      created_at TEXT NOT NULL,
      observed_at TEXT,
      valid_from TEXT,
      valid_to TEXT,
      invalidated_at TEXT,
      target_hash TEXT NOT NULL,
      weight REAL NOT NULL DEFAULT 1,
      confidence REAL NOT NULL DEFAULT 1,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY (from_node_id) REFERENCES memory_nodes(node_id) ON DELETE CASCADE,
      FOREIGN KEY (to_node_id) REFERENCES memory_nodes(node_id) ON DELETE CASCADE,
      CHECK (edge_class IN ('evidence', 'semantic', 'temporal', 'navigation')),
      CHECK (edge_type IN (
        'RAW_NEAR_RAW',
        'SUMMARY_COVERS_RAW',
        'SUMMARY_ROLLS_UP_SUMMARY',
        'MENTIONED_IN_RAW',
        'EVIDENCED_BY_RAW',
        'RELATED_TO',
        'SIMILAR_TO',
        'CAUSED_BY',
        'USED_TOOL',
        'SOLVED_BY',
        'correction',
        'extension',
        'contradiction',
        'FOLLOWS',
        'INDEXES',
        'ROLLS_UP'
      ))
    );
    INSERT INTO memory_edges_revision_migration (
      edge_id, agent_id, from_node_id, to_node_id, edge_type, edge_class,
      created_at, observed_at, valid_from, valid_to, invalidated_at,
      target_hash, weight, confidence, metadata_json
    )
    SELECT
      edge_id, agent_id, from_node_id, to_node_id, edge_type, edge_class,
      created_at, observed_at, valid_from, valid_to, invalidated_at,
      target_hash, weight, confidence, metadata_json
    FROM memory_edges;
    DROP TABLE memory_edges;
    ALTER TABLE memory_edges_revision_migration RENAME TO memory_edges;
  `);
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
