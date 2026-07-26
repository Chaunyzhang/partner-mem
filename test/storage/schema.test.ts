import { DatabaseSync } from "@photostructure/sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  CANONICAL_TABLES,
  initializeSchema,
  listApplicationTables,
  openPartnerMemDatabase
} from "../../src/storage/schema.js";
import { PartnerMemStore } from "../../src/storage/partner-mem-store.js";
import { createTestDatabase } from "../helpers/database.js";

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

describe("V1 schema", () => {
  it("creates only the canonical durable truth tables", () => {
    const fixture = createTestDatabase();
    cleanups.push(fixture.close);

    expect(listApplicationTables(fixture.db)).toEqual([...CANONICAL_TABLES]);
    expect(
      fixture.db.prepare("SELECT version FROM schema_migrations ORDER BY version").all()
    ).toEqual([
      { version: "001_v1_foundation" },
      { version: "002_v1_immutability" }
    ]);
  });

  it("rejects a database with any non-canonical owner instead of migrating it", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE old_owner(id TEXT)");
    expect(() => initializeSchema(db)).toThrow("not the canonical Partner-Mem V1 schema");
    db.close();
  });

  it("rejects raw Harness identifiers even through direct SQL", () => {
    const fixture = createTestDatabase();
    cleanups.push(fixture.close);
    const harnessId = "harness-formal";
    fixture.db
      .prepare(
        "INSERT INTO harness_instances(harness_id, harness_type, registered_at) VALUES (?, ?, ?)"
      )
      .run(harnessId, "test", "2026-07-26T00:00:00Z");

    expect(() =>
      fixture.db
        .prepare(
          `INSERT INTO turn_nodes(
             node_id, harness_id, harness_type, conversation_id,
             question_text, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          "node-formal",
          harnessId,
          "test",
          "raw-host-conversation",
          "原文",
          "2026-07-26T00:00:00Z",
          "2026-07-26T00:00:00Z"
        )
    ).toThrow("turn node identifiers must be Partner-Mem formal IDs");
  });

  it("reopens an initialized database without changing its schema", () => {
    const fixture = createTestDatabase();
    fixture.closeDatabase();
    const reopened = openPartnerMemDatabase(fixture.path);
    expect(listApplicationTables(reopened)).toEqual([...CANONICAL_TABLES]);
    reopened.close();
    cleanups.push(fixture.close);
  });

  it("upgrades the PR #8 foundation by applying only the missing migration", () => {
    const fixture = createTestDatabase();
    const immutableTriggers = [
      "source_object_mappings_immutable_update",
      "source_object_mappings_immutable_delete",
      "turn_nodes_immutable_identity",
      "turn_nodes_thread_fill_once",
      "turn_nodes_immutable_question",
      "turn_nodes_immutable_answer",
      "turn_nodes_permanent",
      "explicit_reply_edges_immutable_update",
      "explicit_reply_edges_permanent"
    ];
    for (const trigger of immutableTriggers) {
      fixture.db.exec(`DROP TRIGGER ${trigger}`);
    }
    fixture.db
      .prepare("DELETE FROM schema_migrations WHERE version = ?")
      .run("002_v1_immutability");
    fixture.closeDatabase();

    const upgraded = openPartnerMemDatabase(fixture.path);
    expect(
      upgraded
        .prepare("SELECT version FROM schema_migrations WHERE version = ?")
        .get("002_v1_immutability")
    ).toEqual({ version: "002_v1_immutability" });
    expect(
      upgraded
        .prepare(
          "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'trigger' AND name IN (" +
            immutableTriggers.map(() => "?").join(",") +
            ")"
        )
        .get(...immutableTriggers)
    ).toEqual({ count: immutableTriggers.length });
    upgraded.close();
    cleanups.push(fixture.close);
  });

  it("rolls back every statement when an incremental migration fails", () => {
    const fixture = createTestDatabase();
    const immutableTriggers = [
      "source_object_mappings_immutable_update",
      "source_object_mappings_immutable_delete",
      "turn_nodes_immutable_identity",
      "turn_nodes_thread_fill_once",
      "turn_nodes_immutable_question",
      "turn_nodes_immutable_answer",
      "turn_nodes_permanent",
      "explicit_reply_edges_immutable_update",
      "explicit_reply_edges_permanent"
    ];
    for (const trigger of immutableTriggers) {
      fixture.db.exec(`DROP TRIGGER ${trigger}`);
    }
    fixture.db
      .prepare("DELETE FROM schema_migrations WHERE version = ?")
      .run("002_v1_immutability");
    fixture.db.exec(`
      CREATE TRIGGER turn_nodes_permanent
      BEFORE DELETE ON turn_nodes
      BEGIN
        SELECT RAISE(ABORT, 'preexisting migration conflict');
      END
    `);
    fixture.closeDatabase();

    expect(() => openPartnerMemDatabase(fixture.path)).toThrow(
      "trigger turn_nodes_permanent already exists"
    );
    const inspect = new DatabaseSync(fixture.path);
    expect(
      inspect
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name IN (" +
            immutableTriggers.map(() => "?").join(",") +
            ") ORDER BY name"
        )
        .all(...immutableTriggers)
    ).toEqual([{ name: "turn_nodes_permanent" }]);
    expect(
      inspect
        .prepare("SELECT version FROM schema_migrations WHERE version = ?")
        .get("002_v1_immutability")
    ).toBeUndefined();
    inspect.exec("DROP TRIGGER turn_nodes_permanent");
    inspect.close();

    const recovered = openPartnerMemDatabase(fixture.path);
    expect(
      recovered
        .prepare("SELECT version FROM schema_migrations WHERE version = ?")
        .get("002_v1_immutability")
    ).toEqual({ version: "002_v1_immutability" });
    recovered.close();
    cleanups.push(fixture.close);
  });

  it("forbids direct overwrite or deletion of stored original text", () => {
    const fixture = createTestDatabase();
    cleanups.push(fixture.close);
    const store = new PartnerMemStore(fixture.db);
    const harness = store.registerHarness("immutable-test");
    const conversation = store.resolveSourceObject({
      harness_id: harness.harness_id,
      object_kind: "conversation",
      source_object_id: "immutable-conversation"
    });
    const node = store.insertTurnNode({
      harness_id: harness.harness_id,
      conversation_id: conversation.formal_id,
      question_text: "永久问题原文"
    });

    expect(() =>
      fixture.db
        .prepare("UPDATE turn_nodes SET question_text = ? WHERE node_id = ?")
        .run("覆盖文字", node.node_id)
    ).toThrow("stored question fields are immutable");
    expect(() =>
      fixture.db.prepare("DELETE FROM turn_nodes WHERE node_id = ?").run(node.node_id)
    ).toThrow("turn nodes are permanent");
    expect(store.getTurnNode(node.node_id)?.question_text).toBe("永久问题原文");
  });
});
