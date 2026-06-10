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

  it("creates revision tracking node fields, indexes, and semantic edge types", () => {
    const db = createDb();
    initializeSchema(db);

    const columns = new Set(
      db
        .prepare("PRAGMA table_info(memory_nodes)")
        .all()
        .map((row: unknown) => String((row as { name: unknown }).name))
    );
    expect(columns.has("topic_group")).toBe(true);
    expect(columns.has("sequence")).toBe(true);
    expect(columns.has("supersedes")).toBe(true);
    expect(columns.has("superseded_by")).toBe(true);

    const indexes = new Set(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
        .all()
        .map((row: unknown) => String((row as { name: unknown }).name))
    );
    expect(indexes.has("idx_memory_nodes_topic_sequence")).toBe(true);
    expect(indexes.has("idx_memory_nodes_supersedes")).toBe(true);
    expect(indexes.has("idx_memory_nodes_superseded_by")).toBe(true);

    db.prepare(
      `INSERT INTO memory_nodes (
        node_id, agent_id, session_id, node_type, status, created_at, updated_at,
        observed_at, topic_group, sequence, content_hash, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "raw-1",
      "agent-1",
      "session-1",
      "raw_message",
      "active",
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
      "topic_plan",
      1,
      "hash-1",
      "{}"
    );
    db.prepare(
      `INSERT INTO memory_nodes (
        node_id, agent_id, session_id, node_type, status, created_at, updated_at,
        observed_at, topic_group, sequence, supersedes, content_hash, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "raw-2",
      "agent-1",
      "session-1",
      "raw_message",
      "active",
      "2026-01-02T00:00:00.000Z",
      "2026-01-02T00:00:00.000Z",
      "2026-01-02T00:00:00.000Z",
      "topic_plan",
      2,
      "raw-1",
      "hash-2",
      "{}"
    );
    db.prepare(
      `INSERT INTO memory_edges (
        edge_id, agent_id, from_node_id, to_node_id, edge_type, edge_class,
        created_at, target_hash, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "edge-revision",
      "agent-1",
      "raw-2",
      "raw-1",
      "correction",
      "semantic",
      "2026-01-02T00:00:00.000Z",
      "hash-1",
      "{}"
    );

    expect(db.prepare("SELECT edge_type FROM memory_edges WHERE edge_id = ?").get("edge-revision")).toEqual({
      edge_type: "correction"
    });
  });

  it("migrates an existing edge table so revision edge types can be inserted", () => {
    const db = createDb();
    db.exec(`
      CREATE TABLE memory_nodes (
        node_id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        session_id TEXT,
        node_type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        observed_at TEXT,
        valid_from TEXT,
        valid_to TEXT,
        invalidated_at TEXT,
        content_hash TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        CHECK (node_type IN ('raw_message', 'summary', 'entity', 'task', 'event', 'decision', 'artifact')),
        CHECK (status IN ('active', 'invalidated'))
      );
      CREATE TABLE memory_edges (
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
          'FOLLOWS',
          'INDEXES',
          'ROLLS_UP'
        ))
      );
    `);

    initializeSchema(db);

    const columns = new Set(
      db
        .prepare("PRAGMA table_info(memory_nodes)")
        .all()
        .map((row: unknown) => String((row as { name: unknown }).name))
    );
    expect(columns.has("topic_group")).toBe(true);

    db.prepare(
      `INSERT INTO memory_nodes (
        node_id, agent_id, session_id, node_type, status, created_at, updated_at,
        observed_at, topic_group, sequence, content_hash, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "raw-1",
      "agent-1",
      "session-1",
      "raw_message",
      "active",
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
      "topic_plan",
      1,
      "hash-1",
      "{}"
    );
    db.prepare(
      `INSERT INTO memory_nodes (
        node_id, agent_id, session_id, node_type, status, created_at, updated_at,
        observed_at, topic_group, sequence, content_hash, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "raw-2",
      "agent-1",
      "session-1",
      "raw_message",
      "active",
      "2026-01-02T00:00:00.000Z",
      "2026-01-02T00:00:00.000Z",
      "2026-01-02T00:00:00.000Z",
      "topic_plan",
      2,
      "hash-2",
      "{}"
    );
    db.prepare(
      `INSERT INTO memory_edges (
        edge_id, agent_id, from_node_id, to_node_id, edge_type, edge_class,
        created_at, target_hash, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "revision-after-migration",
      "agent-1",
      "raw-2",
      "raw-1",
      "correction",
      "semantic",
      "2026-01-02T00:00:00.000Z",
      "hash-1",
      "{}"
    );

    expect(db.prepare("SELECT version FROM schema_migrations WHERE version = ?").get("002_revision_tracking")).toEqual({
      version: "002_revision_tracking"
    });
    const indexes = new Set(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
        .all()
        .map((row: unknown) => String((row as { name: unknown }).name))
    );
    expect(indexes.has("idx_memory_edges_from_class_type")).toBe(true);
    expect(indexes.has("idx_memory_edges_to_class_type")).toBe(true);
    expect(indexes.has("idx_memory_edges_class_type")).toBe(true);
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
