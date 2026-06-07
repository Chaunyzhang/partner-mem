import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TOOL_NAMES } from "../../src/tools/tool-contracts.js";
import { readPartnerMemOpenClawConfig } from "../src/config.js";
import { createPartnerMemOpenClawRuntime } from "../src/runtime.js";
import { createPartnerMemOpenClawTools } from "../src/tools.js";

describe("Partner-Mem OpenClaw tools", () => {
  it("registers exactly the four Partner-Mem tools and no generic aliases", () => {
    const runtime = createTempRuntime();
    try {
      const names = createPartnerMemOpenClawTools(runtime).map((tool) => tool.name);

      expect(names).toEqual([...TOOL_NAMES]);
      expect(names).not.toContain("memory_search");
      expect(names).not.toContain("memory_recall");
      expect(names).not.toContain("memory_store");
      expect(names).not.toContain("memory_add");
    } finally {
      cleanupRuntime(runtime);
    }
  });

  it("routes recall and status through ToolFacade", async () => {
    const runtime = createTempRuntime();
    try {
      runtime.ingest.ingestTurn({
        agent_id: "agent-1",
        session_id: "session-1",
        turn_id: "turn-1",
        turn_index: 0,
        messages: [
          {
            role: "user",
            text: "Partner-Mem tool proof exact raw text.",
            observed_at: "2026-06-06T00:00:00.000Z",
            message_index: 0
          }
        ]
      });

      const tools = createPartnerMemOpenClawTools(runtime);
      const recall = await tools
        .find((tool) => tool.name === "partner_mem_recall")!
        .execute("call-1", {
          query: "tool proof",
          agent_id: "agent-1",
          session_id: "session-1",
          limit: 5
        });
      const status = await tools.find((tool) => tool.name === "partner_mem_status")!.execute("call-2", {
        ignored: true
      });

      expect(JSON.stringify(recall.details)).toContain("Partner-Mem tool proof exact raw text.");
      expect(JSON.stringify(status.details)).toContain("\"schema\":\"healthy\"");
      expect(recall.content[0]?.text).not.toContain(runtime.__dbPath);
      expect(JSON.stringify(recall.details)).not.toContain(runtime.__dbPath);
    } finally {
      cleanupRuntime(runtime);
    }
  });

  it("tool source does not import storage owners or direct SQLite", () => {
    const source = readFileSync(new URL("../src/tools.ts", import.meta.url), "utf8");

    expect(source).not.toMatch(/GraphStore|DatabaseSync|@photostructure\/sqlite|db\.prepare|db\.exec/u);
  });
});

function createTempRuntime() {
  const tempDir = mkdtempSync(join(tmpdir(), "partner-mem-openclaw-tools-"));
  const dbPath = join(tempDir, "partner-mem.db");
  const runtime = createPartnerMemOpenClawRuntime(
    {
      resolvePath: (input) => input,
      registerService: () => undefined,
      registerTool: () => undefined,
      registerMemoryCapability: () => undefined,
      on: () => undefined,
      logger: {}
    },
    readPartnerMemOpenClawConfig({ dbPath })
  );
  return Object.assign(runtime, { __tempDir: tempDir, __dbPath: dbPath });
}

function cleanupRuntime(runtime: ReturnType<typeof createTempRuntime>): void {
  runtime.stop();
  rmSync(runtime.__tempDir, { recursive: true, force: true });
}
