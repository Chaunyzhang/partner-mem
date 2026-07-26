import { readFile, readdir } from "node:fs/promises";
import { extname, join } from "node:path";

import { describe, expect, it } from "vitest";

const productionRoots = [
  join(process.cwd(), "openclaw-plugin", "src"),
  join(process.cwd(), "integrations", "hermes", "partner_mem")
];

describe("adapter source gates", () => {
  it("keeps storage, ingest, and retrieval decisions inside the core runtime", async () => {
    const source = await readProductionSource();

    expect(source).not.toMatch(/@photostructure\/sqlite/);
    expect(source).not.toMatch(/\bPartnerMemStore\b/);
    expect(source).not.toMatch(/\bTurnIngestService\b/);
    expect(source).not.toMatch(/\bRetrievalFacade\b/);
    expect(source).not.toMatch(
      /\b(?:SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\s+(?:FROM|INTO|TABLE|INDEX|TRIGGER|VIRTUAL)\b/i
    );
  });

  it("forbids deleted tools, commands, injection owners, and compatibility hooks", async () => {
    const source = await readProductionSource();

    for (const deletedSurface of [
      "partner_mem_search",
      "partner_mem_recall",
      "partner_mem_timeline",
      "partner_mem_status",
      "memory.capture_turn",
      "memory.assemble_context",
      "tools.invoke"
    ]) {
      expect(source).not.toContain(deletedSurface);
    }
    expect(source).not.toContain("agent_end");
    expect(source).not.toContain("enqueueNextTurnInjection");
    expect(source).not.toContain("registerMemoryPromptSection");
    expect(source).not.toContain("registerHook(");
    expect(source).not.toContain("normalizeHookPayload");
    expect(source).not.toContain("as never");
  });

  it("contains no adapter-owned retry, backoff, replay, or child restart loop", async () => {
    const source = await readProductionSource();

    expect(source).not.toMatch(/\bretry\s*\(/i);
    expect(source).not.toMatch(/\bbackoff\b/i);
    expect(source).not.toMatch(/\breplay(?:Queue|_queue)\b/);
    expect(source).not.toMatch(/\bsetInterval\s*\(/);
  });
});

async function readProductionSource(): Promise<string> {
  const files = (
    await Promise.all(productionRoots.map((root) => listSourceFiles(root)))
  ).flat();
  return (
    await Promise.all(
      files.map(async (file) => `\n/* ${file} */\n${await readFile(file, "utf8")}`)
    )
  ).join("\n");
}

async function listSourceFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry): Promise<string[]> => {
      const path = join(root, entry.name);
      if (entry.isDirectory()) {
        return await listSourceFiles(path);
      }
      return [".ts", ".py"].includes(extname(entry.name)) ? [path] : [];
    })
  );
  return nested.flat();
}
