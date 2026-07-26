import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface OpenClawPartnerMemConfig {
  statePath: string;
  databasePath: string;
  runtimePath: string;
  nodePath?: string;
}

export function resolveOpenClawPartnerMemConfig(
  pluginConfig: Record<string, unknown> | undefined,
  entryMetaUrl: string
): OpenClawPartnerMemConfig {
  const statePath =
    readNonEmptyString(pluginConfig?.statePath) ??
    readNonEmptyString(process.env.PARTNER_MEM_OPENCLAW_STATE_PATH) ??
    join(homedir(), ".openclaw", "partner-mem", "state.json");
  const databasePath =
    readNonEmptyString(pluginConfig?.databasePath) ??
    readNonEmptyString(process.env.PARTNER_MEM_OPENCLAW_DATABASE_PATH) ??
    join(dirname(statePath), "partner-mem.sqlite");
  const runtimePath =
    readNonEmptyString(pluginConfig?.runtimePath) ??
    readNonEmptyString(process.env.PARTNER_MEM_RUNTIME_PATH) ??
    fileURLToPath(new URL("./partner-mem-runtime/runtime/cli.js", entryMetaUrl));
  const nodePath =
    readNonEmptyString(pluginConfig?.nodePath) ??
    readNonEmptyString(process.env.PARTNER_MEM_NODE_PATH);

  return nodePath === undefined
    ? { statePath, databasePath, runtimePath }
    : { statePath, databasePath, runtimePath, nodePath };
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}
