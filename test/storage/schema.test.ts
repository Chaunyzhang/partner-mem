import { DatabaseSync } from "@photostructure/sqlite";
import { describe, expect, it } from "vitest";
import { initializeSchema, REQUIRED_TABLES, type SqliteDatabase } from "../../src/storage/schema.js";
import { runSchemaDoctor } from "../../src/storage/doctor.js";

function createDb(): SqliteDatabase {
  return new DatabaseSync(":memory:") as SqliteDatabase;
}

describe("SQLite graph schema", () => {
  it("creates every required table", () => {
    const db = createDb();
    initializeSchema(db);

    const tables = new Set(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'virtual table')")
        .all()
        .map((row: unknown) => String((row as { name: unknown }).name))
    );

    for (const table of REQUIRED_TABLES) {
      expect(tables.has(table)).toBe(true);
    }
  });

  it("supports FTS5 seed search without making it a fact source", () => {
    const db = createDb();
    initializeSchema(db);

    db.prepare(
      "INSERT INTO node_fts(node_id, agent_id, session_id, node_type, text) VALUES (?, ?, ?, ?, ?)"
    ).run("node-1", "agent-1", "session-1", "raw_message", "remember every visible message");

    const rows = db
      .prepare("SELECT node_id FROM node_fts WHERE node_fts MATCH ? ORDER BY rank")
      .all("visible");

    expect(rows).toEqual([{ node_id: "node-1" }]);
  });

  it("backfills old raw FTS rows with Chinese substring index terms", () => {
    const db = createDb();
    initializeSchema(db);
    db.prepare("DELETE FROM schema_migrations WHERE version = ?").run("002_cjk_fts_index_text");
    db
      .prepare(
        `INSERT INTO memory_nodes (
          node_id, agent_id, session_id, node_type, status, created_at, updated_at,
          observed_at, content_hash, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        "raw-1",
        "agent-1",
        "session-1",
        "raw_message",
        "active",
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z",
        "hash-1",
        "{}"
      );
    db
      .prepare(
        `INSERT INTO raw_payloads (
          node_id, role, text, normalized_text, token_count,
          turn_id, turn_index, message_index, source_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run("raw-1", "user", "你再出一个绕口令", "你再出一个绕口令", 1, "turn-1", 0, 0, "hash-1");
    db.prepare(
      "INSERT INTO node_fts(node_id, agent_id, session_id, node_type, text) VALUES (?, ?, ?, ?, ?)"
    ).run("raw-1", "agent-1", "session-1", "raw_message", "你再出一个绕口令");

    initializeSchema(db);

    const rows = db
      .prepare("SELECT node_id FROM node_fts WHERE node_fts MATCH ?")
      .all("绕口令");

    expect(rows).toEqual([{ node_id: "raw-1" }]);
  });

  it("does not create a standalone host message ledger", () => {
    const db = createDb();
    initializeSchema(db);

    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'messages'")
      .get();

    expect(row).toBeUndefined();
  });

  it("reports healthy after initialization and unhealthy when a table is missing", () => {
    const healthyDb = createDb();
    initializeSchema(healthyDb);
    expect(runSchemaDoctor(healthyDb)).toEqual({
      status: "healthy",
      missingTables: [],
      fts: { available: true },
      graph: {
        hasNodesTable: true,
        hasEdgesTable: true
      },
      evidence: {
        hasPacketsTable: true,
        badHashCount: 0,
        missingRawPayloadCount: 0
      },
      config: {
        defaultsLoaded: true
      }
    });

    const incompleteDb = createDb();
    incompleteDb.exec("CREATE TABLE memory_nodes (node_id TEXT PRIMARY KEY)");
    const result = runSchemaDoctor(incompleteDb);

    expect(result.status).toBe("unhealthy");
    expect(result.missingTables).toContain("memory_edges");
  });
});
