#!/usr/bin/env node

import { stdin, stdout } from "node:process";
import { PartnerMemRuntime } from "./partner-mem-runtime.js";
import { serveJsonLines } from "./jsonl-server.js";

const databasePath = process.env.PARTNER_MEM_DB_PATH ?? process.argv[2];
if (!databasePath) {
  throw new Error("PARTNER_MEM_DB_PATH or a database path argument is required");
}

const runtime = PartnerMemRuntime.open(databasePath);
try {
  await serveJsonLines(stdin, stdout, runtime);
} finally {
  runtime.close();
}
