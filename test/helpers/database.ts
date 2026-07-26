import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openPartnerMemDatabase } from "../../src/storage/schema.js";

export function createTestDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "partner-mem-v1-"));
  const path = join(directory, "partner-mem-v1.db");
  const db = openPartnerMemDatabase(path);
  let databaseIsOpen = true;
  return {
    db,
    path,
    closeDatabase() {
      if (!databaseIsOpen) return;
      db.close();
      databaseIsOpen = false;
    },
    close() {
      if (databaseIsOpen) db.close();
      databaseIsOpen = false;
      rmSync(directory, { recursive: true, force: true });
    }
  };
}
