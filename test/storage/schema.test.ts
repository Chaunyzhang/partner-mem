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
        hasPacketsTable: true
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
