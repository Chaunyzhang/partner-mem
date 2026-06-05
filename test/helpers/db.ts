import { DatabaseSync } from "@photostructure/sqlite";
import { GraphStore } from "../../src/storage/graph-store.js";
import { initializeSchema, type SqliteDatabase } from "../../src/storage/schema.js";

export function createInitializedStore(): GraphStore {
  const db = new DatabaseSync(":memory:") as SqliteDatabase;
  initializeSchema(db);
  return new GraphStore(db);
}
