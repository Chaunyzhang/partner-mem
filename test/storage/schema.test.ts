import { DatabaseSync } from "@photostructure/sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  CANONICAL_TABLES,
  initializeSchema,
  listApplicationTables,
  openPartnerMemDatabase
} from "../../src/storage/schema.js";
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
      fixture.db.prepare("SELECT version FROM schema_migrations").all()
    ).toEqual([{ version: "001_v1_foundation" }]);
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
});
