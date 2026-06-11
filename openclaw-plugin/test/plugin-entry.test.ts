import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("openclaw/plugin-sdk/plugin-entry", () => ({
  definePluginEntry: (entry: unknown) => entry
}));

describe("Partner-Mem OpenClaw plugin entry", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "partner-mem-openclaw-entry-"));
  });

  afterEach(() => {
    vi.resetModules();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("registers service, tools, hooks, and memory capability without context engine or aliases", async () => {
    const services: Array<{ id: string; stop?: () => void }> = [];
    const tools: Array<{ registration: unknown; opts?: { name?: string; names?: string[] } }> = [];
    const hooks: string[] = [];
    const memoryCapabilities: unknown[] = [];
    let contextEngineCalls = 0;
    const entry = (await import("../src/index.js")).default;

    const fakeApi = {
      pluginConfig: { dbPath: join(tempDir, "partner-mem.db") },
      resolvePath: (input: string) => input,
      registerService(service: { id: string; stop?: () => void }) {
        services.push(service);
      },
      registerTool(registration: unknown, opts?: { name?: string; names?: string[] }) {
        tools.push(opts === undefined ? { registration } : { registration, opts });
      },
      registerMemoryCapability(capability: unknown) {
        memoryCapabilities.push(capability);
      },
      on(name: string) {
        hooks.push(name);
      },
      registerContextEngine() {
        contextEngineCalls += 1;
      },
      logger: {}
    };

    entry.register(fakeApi as Parameters<typeof entry.register>[0]);

    try {
      expect(services.map((service) => service.id)).toEqual(["partner-mem"]);
      expect(tools.map((tool) => typeof tool.registration)).toEqual([
        "function",
        "function",
        "function",
        "function"
      ]);
      expect(tools.map((tool) => tool.opts?.name)).toEqual([
        "partner_mem_search",
        "partner_mem_recall",
        "partner_mem_timeline",
        "partner_mem_status"
      ]);
      expect(hooks).toEqual(["agent_end", "before_prompt_build"]);
      expect(memoryCapabilities).toHaveLength(1);
      expect(contextEngineCalls).toBe(0);
      expect(tools.map((tool) => tool.opts?.name)).not.toContain("memory_search");
      expect(tools.map((tool) => tool.opts?.name)).not.toContain("memory_recall");
    } finally {
      services[0]?.stop?.();
    }
  });
});
