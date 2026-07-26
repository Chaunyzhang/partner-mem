import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

import type { RuntimeClient } from "./runtime-client.js";

export interface HarnessState {
  version: 1;
  harness_id: string;
}

export class HarnessStateStore {
  private ready: Promise<HarnessState> | null = null;

  constructor(
    private readonly statePath: string,
    private readonly databasePath: string,
    private readonly client: Pick<RuntimeClient, "registerHarness">
  ) {}

  async ensure(): Promise<HarnessState> {
    this.ready ??= this.loadOrRegister();
    return await this.ready;
  }

  private async loadOrRegister(): Promise<HarnessState> {
    const existing = await this.read();
    if (existing) {
      try {
        await access(this.databasePath);
      } catch (error) {
        if (isNotFound(error)) {
          throw new Error(
            "Partner-Mem OpenClaw state exists but the database is missing"
          );
        }
        throw error;
      }
      return existing;
    }
    const harnessId = await this.client.registerHarness("openclaw");
    const state: HarnessState = { version: 1, harness_id: harnessId };
    await this.writeAtomic(state);
    return state;
  }

  private async read(): Promise<HarnessState | null> {
    let raw: string;
    try {
      raw = await readFile(this.statePath, "utf8");
    } catch (error) {
      if (isNotFound(error)) {
        return null;
      }
      throw error;
    }
    const parsed = JSON.parse(raw) as Partial<HarnessState>;
    if (parsed.version !== 1) {
      throw new Error("Partner-Mem OpenClaw state version is invalid");
    }
    if (typeof parsed.harness_id !== "string" || parsed.harness_id.trim().length === 0) {
      throw new Error("Partner-Mem OpenClaw state harness_id is invalid");
    }
    return { version: 1, harness_id: parsed.harness_id };
  }

  private async writeAtomic(state: HarnessState): Promise<void> {
    await mkdir(dirname(this.statePath), { recursive: true });
    const tmpPath = `${this.statePath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(tmpPath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    await rename(tmpPath, this.statePath);
  }
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}
