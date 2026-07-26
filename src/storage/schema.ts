import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "@photostructure/sqlite";

const MIGRATION_DIRECTORY = join(dirname(fileURLToPath(import.meta.url)), "migrations");
const MIGRATIONS = [
  ["001_v1_foundation", "001_v1_foundation.sql"],
  ["002_v1_immutability", "002_v1_immutability.sql"]
] as const;

export const CANONICAL_TABLES = [
  "agent_conversation_access",
  "explicit_reply_edges",
  "harness_instances",
  "schema_migrations",
  "source_object_mappings",
  "turn_nodes"
] as const;

export type PartnerMemDatabase = InstanceType<typeof DatabaseSync>;

export function openPartnerMemDatabase(path: string): PartnerMemDatabase {
  const db = new DatabaseSync(path, { timeout: 5_000 });
  try {
    db.exec("PRAGMA foreign_keys = ON");
    db.exec("PRAGMA busy_timeout = 5000");
    if (path !== ":memory:") db.exec("PRAGMA journal_mode = WAL");
    initializeSchema(db);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

export function initializeSchema(db: PartnerMemDatabase): void {
  const existing = listApplicationTables(db);
  if (existing.length > 0) {
    assertOnlyCanonicalTables(existing);
    const foundation = db
      .prepare("SELECT version FROM schema_migrations WHERE version = ?")
      .get(MIGRATIONS[0][0]);
    if (!foundation) {
      throw new Error("Database has an incomplete Partner-Mem V1 schema");
    }
  } else {
    applyMigration(db, MIGRATIONS[0][1]);
    assertOnlyCanonicalTables(listApplicationTables(db));
  }

  for (const [version, filename] of MIGRATIONS.slice(1)) {
    const applied = db
      .prepare("SELECT version FROM schema_migrations WHERE version = ?")
      .get(version);
    if (!applied) applyMigration(db, filename);
  }
}

function applyMigration(db: PartnerMemDatabase, filename: string): void {
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(readFileSync(join(MIGRATION_DIRECTORY, filename), "utf8"));
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function listApplicationTables(db: PartnerMemDatabase): string[] {
  return (
    db
      .prepare(
        `SELECT name
         FROM sqlite_master
         WHERE type = 'table'
           AND name NOT LIKE 'sqlite_%'
         ORDER BY name`
      )
      .all() as Array<{ name: string }>
  ).map((row) => row.name);
}

function assertOnlyCanonicalTables(tables: string[]): void {
  const allowed = new Set<string>(CANONICAL_TABLES);
  const unexpected = tables.filter((table) => !allowed.has(table));
  const missing = CANONICAL_TABLES.filter((table) => !tables.includes(table));
  if (unexpected.length > 0 || missing.length > 0) {
    throw new Error(
      `Database is not the canonical Partner-Mem V1 schema; unexpected=${unexpected.join(",") || "none"}; missing=${missing.join(",") || "none"}`
    );
  }
}
