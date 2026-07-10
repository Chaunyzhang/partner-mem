import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const repositoryRoot = process.cwd();
const temporaryRoot = mkdtempSync(join(tmpdir(), "partner-mem-hermes-package-"));
const artifactRoot = join(temporaryRoot, "partner_mem");

beforeAll(() => {
  const build = spawnSync("corepack", ["pnpm", "build"], {
    cwd: repositoryRoot,
    encoding: "utf8"
  });
  expect(build.status, build.stderr || build.stdout).toBe(0);

  const result = spawnSync(
    process.execPath,
    [join(repositoryRoot, "scripts", "build-hermes-plugin.mjs"), "--output", artifactRoot],
    {
      cwd: repositoryRoot,
      encoding: "utf8"
    }
  );

  expect(result.status, result.stderr || result.stdout).toBe(0);
});

afterAll(() => {
  rmSync(temporaryRoot, { recursive: true, force: true });
});

describe("Hermes standalone plugin artifact", () => {
  it("contains the provider and a complete compiled runtime closure", () => {
    for (const providerFile of [
      ".gitignore",
      "__init__.py",
      "config.py",
      "host_contract.py",
      "node_contract.py",
      "plugin.yaml",
      "provider.py",
      "runtime_client.py",
      "setup.py"
    ]) {
      expect(fileExists(providerFile), `missing provider runtime file: ${providerFile}`).toBe(true);
    }
    expect(fileExists("README.md")).toBe(true);
    expect(fileExists("generated/tool-schemas.json")).toBe(true);
    expect(fileExists("runtime/package.json")).toBe(true);
    expect(fileExists("runtime/package-lock.json")).toBe(true);
    expect(fileExists("runtime/dist/runtime/jsonl-server.js")).toBe(true);
    expect(fileExists("runtime/dist/storage/migrations/001_init_graph.sql")).toBe(true);
    expect(fileExists("runtime/dist/storage/migrations/003_runtime_operations.sql")).toBe(true);

    const artifactFiles = listFiles(artifactRoot);
    expect(artifactFiles.some((path) => path.endsWith(".ts"))).toBe(false);
    expect(artifactFiles.some((path) => path.includes("__pycache__"))).toBe(false);
    expect(artifactFiles.some((path) => path.includes("node_modules"))).toBe(false);

    for (const file of artifactFiles.filter((path) => path.endsWith(".js"))) {
      const source = readFileSync(file, "utf8");
      for (const specifier of relativeJavaScriptSpecifiers(source)) {
        const dependency = resolve(dirname(file), specifier);
        expect(
          statSync(dependency).isFile(),
          `${relative(artifactRoot, file)} imports missing ${specifier}`
        ).toBe(true);
      }
    }
  });

  it("pins the existing native SQLite dependency without development dependencies", () => {
    const packageJson = readJson("runtime/package.json");
    const packageLock = readJson("runtime/package-lock.json");

    expect(packageJson).toMatchObject({
      private: true,
      type: "module",
      engines: { node: ">=20" },
      dependencies: { "@photostructure/sqlite": "1.2.1" }
    });
    expect(packageJson).not.toHaveProperty("devDependencies");
    expect(packageLock.packages[""].dependencies).toEqual({
      "@photostructure/sqlite": "1.2.1"
    });
  });

  it("ships the exact generated Hermes tool schemas before runtime initialization", () => {
    const committedSchemaPath = join(
      repositoryRoot,
      "integrations",
      "hermes",
      "partner_mem",
      "generated",
      "tool-schemas.json"
    );
    const artifactSchemaPath = join(artifactRoot, "generated", "tool-schemas.json");

    expect(readFileSync(artifactSchemaPath)).toEqual(readFileSync(committedSchemaPath));

    const schemas = JSON.parse(readFileSync(artifactSchemaPath, "utf8"));
    expect(schemas.map((schema: { name: string }) => schema.name)).toEqual([
      "partner_mem_search",
      "partner_mem_recall",
      "partner_mem_timeline",
      "partner_mem_status"
    ]);
    for (const schema of schemas) {
      expect(schema.parameters.additionalProperties).toBe(false);
      expect(schema.parameters.properties).not.toHaveProperty("agent_id");
      expect(schema.parameters.properties).not.toHaveProperty("session_id");
    }
    expect(schemas.slice(0, 3).map((schema: any) => schema.parameters.properties.limit.maximum)).toEqual([
      50,
      50,
      50
    ]);
    expect(schemas[0].parameters.properties.time_window.additionalProperties).toBe(false);
  });

  it("declares an exclusive Hermes provider and documents only standalone setup", () => {
    const manifest = readFile("plugin.yaml");
    const readme = readFile("README.md");

    expect(manifest).toMatch(/^manifest_version:\s*1$/mu);
    expect(manifest).toMatch(/^kind:\s*exclusive$/mu);
    expect(manifest).toMatch(/^\s+version:\s*["']>=20["']$/mu);

    expect(readme).toContain("hermes plugins install");
    expect(readme).toContain("hermes memory setup partner_mem");
    expect(readme).toContain("hermes plugins update partner_mem");
    expect(readme).toContain("hermes memory off");
    expect(readme).toContain("hermes plugins remove partner_mem");
    expect(readme).toContain("$HERMES_HOME/partner-mem/partner-mem.db");
    expect(readme).toContain("Node.js 20");
    expect(readme).toContain("Hermes Agent v0.18.2.");
    expect(readme).toContain("Termux/Android is not supported");
    expect(readme).toContain("hermes gateway stop");
    expect(readme).toContain("hermes gateway restart");
    expect(readme).toMatch(/typed extraction.*not available/iu);
    expect(readme).not.toMatch(/symlink|ln -s|pnpm build|checkout/iu);
  });

  it("contains no repository coupling, identity override, or absolute source path", () => {
    const forbidden = [
      "PARTNER_MEM_ROOT",
      "PARTNER_MEM_DB",
      "PARTNER_MEM_AGENT_ID",
      repositoryRoot
    ];

    for (const file of listFiles(artifactRoot)) {
      const content = readFileSync(file, "utf8");
      for (const token of forbidden) {
        expect(content, `${relative(artifactRoot, file)} contains ${token}`).not.toContain(token);
      }
    }
  });

  it("installs the locked dependency and starts the compiled runtime", () => {
    const runtimeRoot = join(artifactRoot, "runtime");
    const install = spawnSync("npm", ["ci", "--omit=dev"], {
      cwd: runtimeRoot,
      encoding: "utf8"
    });
    expect(install.status, install.stderr || install.stdout).toBe(0);

    const stateDir = join(temporaryRoot, "runtime-state");
    const input = [
      {
        protocol_version: 1,
        request_id: "start",
        method: "runtime.start",
        params: {
          state_dir: stateDir,
          client: {
            name: "partner-mem-hermes",
            version: "0.1.0",
            host: "hermes",
            host_version: "0.18.2"
          }
        }
      },
      {
        protocol_version: 1,
        request_id: "close",
        method: "runtime.close",
        params: {}
      }
    ].map((line) => JSON.stringify(line)).join("\n") + "\n";
    const runtime = spawnSync(
      process.execPath,
      [join(runtimeRoot, "dist", "runtime", "jsonl-server.js")],
      { input, encoding: "utf8" }
    );
    expect(runtime.status, runtime.stderr || runtime.stdout).toBe(0);
    const responses = runtime.stdout.trim().split("\n").map((line) => JSON.parse(line));
    expect(responses).toEqual([
      expect.objectContaining({
        request_id: "start",
        ok: true,
        result: expect.objectContaining({
          protocol_version: 1,
          runtime_version: "0.1.0",
          capabilities: ["context.assemble.v1", "turn.capture.v1", "tools.invoke.v1"]
        })
      }),
      { protocol_version: 1, request_id: "close", ok: true, result: { closed: true } }
    ]);
  }, 30_000);
});

function fileExists(path: string): boolean {
  try {
    return statSync(join(artifactRoot, path)).isFile();
  } catch {
    return false;
  }
}

function readFile(path: string): string {
  return readFileSync(join(artifactRoot, path), "utf8");
}

function readJson(path: string): any {
  return JSON.parse(readFile(path));
}

function listFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    if (statSync(path).isDirectory()) {
      files.push(...listFiles(path));
    } else {
      files.push(path);
    }
  }
  return files;
}

function relativeJavaScriptSpecifiers(source: string): string[] {
  return [...source.matchAll(/["'](\.\.?\/[^"']+\.js)["']/gu)].map((match) => match[1]!);
}
