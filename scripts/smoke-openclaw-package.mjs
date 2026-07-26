#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pluginRoot = resolve(repositoryRoot, "openclaw-plugin");
const smokeRoot = resolve(repositoryRoot, "build", "openclaw-package-smoke");
const packageDirectory = resolve(smokeRoot, "packages");
const stateDirectory = resolve(smokeRoot, "state");
const homeDirectory = resolve(smokeRoot, "home");
const openClawCli = resolve(
  pluginRoot,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "openclaw.cmd" : "openclaw"
);
const expectedTools = [
  "partner_mem_keyword_search",
  "partner_mem_vector_search",
  "partner_mem_graph_traverse"
];
const expectedHooks = [
  "gateway_start",
  "before_agent_run",
  "message_received",
  "reply_payload_sending",
  "message_sent"
];

requireFile(resolve(pluginRoot, "dist", "index.js"));
requireFile(openClawCli);
rmSync(smokeRoot, { recursive: true, force: true });
mkdirSync(packageDirectory, { recursive: true });
mkdirSync(stateDirectory, { recursive: true });
mkdirSync(homeDirectory, { recursive: true });

run("npm", ["pack", "--pack-destination", packageDirectory], {
  cwd: pluginRoot
});
const tarballs = readdirSync(packageDirectory).filter((name) =>
  name.endsWith(".tgz")
);
if (tarballs.length !== 1) {
  throw new Error(`expected one OpenClaw plugin tarball, found ${tarballs.length}`);
}
const tarball = resolve(packageDirectory, tarballs[0]);
const environment = {
  ...process.env,
  HOME: homeDirectory,
  OPENCLAW_STATE_DIR: stateDirectory,
  OPENCLAW_CONFIG_PATH: resolve(stateDirectory, "openclaw.json")
};

run(
  openClawCli,
  ["plugins", "install", `npm-pack:${tarball}`, "--force"],
  { env: environment }
);
run(
  openClawCli,
  [
    "config",
    "set",
    "plugins.entries.partner-mem.hooks.allowConversationAccess",
    "true"
  ],
  { env: environment }
);
const inspectionText = run(
  openClawCli,
  ["plugins", "inspect", "partner-mem", "--runtime", "--json"],
  { env: environment }
);
const inspection = JSON.parse(inspectionText);
const plugin = requireRecord(inspection.plugin, "inspection.plugin");
assertEqual(plugin.status, "loaded", "installed plugin status");
assertEqual(plugin.imported, true, "installed plugin import");
assertDeepEqual(
  requireRecord(plugin.contracts, "plugin.contracts").tools,
  expectedTools,
  "manifest tool contracts"
);
assertDeepEqual(
  inspection.typedHooks.map((hook) => hook.name).sort(),
  [...expectedHooks].sort(),
  "typed hook registrations"
);
assertDeepEqual(inspection.diagnostics, [], "runtime diagnostics");

const install = requireRecord(inspection.install, "inspection.install");
const installPath = requireString(install.installPath, "installPath");
const runtimePath = resolve(
  installPath,
  "dist",
  "partner-mem-runtime",
  "runtime",
  "cli.js"
);
requireFile(runtimePath);
requireFile(
  resolve(
    installPath,
    "dist",
    "partner-mem-runtime",
    "storage",
    "migrations",
    "003_v1_retrieval_indexes.sql"
  )
);
requireFile(
  resolve(
    installPath,
    "dist",
    "partner-mem-runtime",
    "tools",
    "generated",
    "tool-schemas.json"
  )
);

const runtimeResponse = JSON.parse(
  run(
    process.execPath,
    [runtimePath, resolve(smokeRoot, "runtime.sqlite")],
    {
      input: `${JSON.stringify({
        id: "package-smoke",
        command: "register_harness",
        params: { harness_type: "openclaw" }
      })}\n`
    }
  ).trim()
);
assertEqual(runtimeResponse.id, "package-smoke", "runtime response id");
assertEqual(runtimeResponse.ok, true, "runtime response status");
if (
  typeof runtimeResponse.result?.harness_id !== "string" ||
  runtimeResponse.result.harness_id.length === 0
) {
  throw new Error("installed runtime did not register a harness");
}

process.stdout.write("OpenClaw package install/load/runtime smoke passed\n");

function run(command, args, options = {}) {
  try {
    return execFileSync(command, args, {
      cwd: repositoryRoot,
      env: process.env,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      ...options
    });
  } catch (error) {
    const stdout =
      error && typeof error === "object" && "stdout" in error
        ? String(error.stdout ?? "")
        : "";
    const stderr =
      error && typeof error === "object" && "stderr" in error
        ? String(error.stderr ?? "")
        : "";
    throw new Error(
      `command failed: ${command} ${args.join(" ")}\n${stdout}${stderr}`
    );
  }
}

function requireFile(path) {
  if (!existsSync(path)) {
    throw new Error(`required package file is missing: ${path}`);
  }
}

function requireRecord(value, field) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
  return value;
}

function requireString(value, field) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}

function assertEqual(actual, expected, field) {
  if (actual !== expected) {
    throw new Error(
      `${field} mismatch: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`
    );
  }
}

function assertDeepEqual(actual, expected, field) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${field} mismatch: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`
    );
  }
}
