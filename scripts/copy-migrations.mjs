import { cpSync, mkdirSync } from "node:fs";

mkdirSync("dist/storage/migrations", { recursive: true });
cpSync("src/storage/migrations", "dist/storage/migrations", { recursive: true });
mkdirSync("dist/tools/generated", { recursive: true });
cpSync("src/tools/generated", "dist/tools/generated", { recursive: true });
