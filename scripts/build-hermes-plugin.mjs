#!/usr/bin/env node

import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rootDist = join(repositoryRoot, "dist");
const pluginSource = join(repositoryRoot, "integrations", "hermes", "partner_mem");
const readmeSource = join(repositoryRoot, "integrations", "hermes", "README.md");
const runtimePackageSource = join(repositoryRoot, "integrations", "hermes", "runtime-package");
const committedSchema = join(pluginSource, "generated", "tool-schemas.json");
const runtimeEntry = join(rootDist, "runtime", "jsonl-server.js");
const migrationsSource = join(rootDist, "storage", "migrations");
const providerRuntimeFiles = [
  ".gitignore",
  "__init__.py",
  "config.py",
  "host_contract.py",
  "node_contract.py",
  "plugin.yaml",
  "provider.py",
  "runtime_client.py",
  "setup.py"
];

const output = parseOutput(process.argv.slice(2));
assertSafeOutput(output);

const outputParent = dirname(output);
const staging = join(
  outputParent,
  `.${basename(output)}.staging-${process.pid}-${Date.now()}`
);

try {
  assertBuildInputs();
  mkdirSync(outputParent, { recursive: true });
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });

  copyProviderPackage(staging);
  copyRuntimePackage(staging);
  copyRuntimeClosure(staging);
  await generateAndVerifyToolSchemas(staging);
  verifyArtifact(staging);

  rmSync(output, { recursive: true, force: true });
  renameSync(staging, output);
  process.stdout.write(`${output}\n`);
} catch (error) {
  rmSync(staging, { recursive: true, force: true });
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Hermes plugin build failed: ${message}\n`);
  process.exitCode = 1;
}

function parseOutput(args) {
  const defaultOutput = join(repositoryRoot, "build", "hermes-plugin", "partner_mem");
  if (args.length === 0) return defaultOutput;
  if (args.length === 2 && args[0] === "--output" && args[1]) {
    return resolve(args[1]);
  }
  throw new Error("usage: node scripts/build-hermes-plugin.mjs [--output <partner_mem-directory>]");
}

function assertSafeOutput(outputPath) {
  if (basename(outputPath) !== "partner_mem") {
    throw new Error("artifact output directory must be named partner_mem");
  }
  if (outputPath === repositoryRoot || outputPath === pluginSource) {
    throw new Error("artifact output must not replace the repository or source plugin");
  }
}

function assertBuildInputs() {
  for (const path of [
    pluginSource,
    readmeSource,
    runtimePackageSource,
    committedSchema,
    runtimeEntry,
    migrationsSource,
    join(rootDist, "tools", "tool-contracts.js"),
    ...providerRuntimeFiles.map((path) => join(pluginSource, path))
  ]) {
    if (!existsSync(path)) {
      throw new Error(`required build input is missing: ${relative(repositoryRoot, path)}`);
    }
  }
}

function copyProviderPackage(target) {
  cpSync(pluginSource, target, {
    recursive: true,
    filter(source) {
      const parts = source.split(sep);
      return !parts.includes("__pycache__") && !source.endsWith(".pyc");
    }
  });
  copyFileSync(readmeSource, join(target, "README.md"));
}

function copyRuntimePackage(target) {
  const runtimeTarget = join(target, "runtime");
  mkdirSync(runtimeTarget, { recursive: true });
  for (const filename of ["package.json", "package-lock.json"]) {
    copyFileSync(join(runtimePackageSource, filename), join(runtimeTarget, filename));
  }

  const packageJson = readJson(join(runtimeTarget, "package.json"));
  const packageLock = readJson(join(runtimeTarget, "package-lock.json"));
  const dependencies = packageJson.dependencies ?? {};
  if (
    !packageJson.private ||
    packageJson.engines?.node !== ">=20" ||
    packageJson.devDependencies ||
    Object.keys(dependencies).length !== 1 ||
    dependencies["@photostructure/sqlite"] !== "1.2.1"
  ) {
    throw new Error("runtime/package.json must contain only exact @photostructure/sqlite 1.2.1");
  }
  if (packageLock.packages?.[""]?.dependencies?.["@photostructure/sqlite"] !== "1.2.1") {
    throw new Error("runtime/package-lock.json does not pin @photostructure/sqlite 1.2.1");
  }
}

function copyRuntimeClosure(target) {
  const runtimeDistTarget = join(target, "runtime", "dist");
  const pending = [runtimeEntry];
  const visited = new Set();

  while (pending.length > 0) {
    const source = pending.pop();
    if (!source || visited.has(source)) continue;
    assertInside(rootDist, source, "runtime dependency");
    if (!existsSync(source) || !statSync(source).isFile()) {
      throw new Error(`compiled runtime dependency is missing: ${relative(rootDist, source)}`);
    }

    visited.add(source);
    const destination = join(runtimeDistTarget, relative(rootDist, source));
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(source, destination);

    const sourceText = readFileSync(source, "utf8");
    for (const specifier of relativeJavaScriptSpecifiers(sourceText)) {
      const dependency = resolve(dirname(source), specifier);
      assertInside(rootDist, dependency, `import ${specifier}`);
      pending.push(dependency);
    }
  }

  cpSync(migrationsSource, join(runtimeDistTarget, "storage", "migrations"), {
    recursive: true
  });
}

async function generateAndVerifyToolSchemas(target) {
  const contractsPath = join(rootDist, "tools", "tool-contracts.js");
  const contracts = await import(`${pathToFileURL(contractsPath).href}?hermes-build=${Date.now()}`);
  const toolNames = contracts.TOOL_NAMES;
  const toolSchemas = contracts.toolSchemas;
  if (!Array.isArray(toolNames) || !toolSchemas) {
    throw new Error("compiled tool contracts do not export TOOL_NAMES and toolSchemas");
  }

  const generated = toolNames.map((name) => {
    const schema = toolSchemas[name];
    if (!schema) throw new Error(`tool schema is missing for ${name}`);
    return {
      name,
      description: schema.description,
      parameters: schema.inputSchema
    };
  });
  const generatedBytes = `${JSON.stringify(generated, null, 2)}\n`;

  let committed;
  try {
    committed = JSON.parse(readFileSync(committedSchema, "utf8"));
  } catch (error) {
    throw new Error(`committed tool schema is invalid JSON: ${error}`);
  }
  if (!isDeepStrictEqual(committed, generated)) {
    throw new Error("committed generated/tool-schemas.json is semantically stale");
  }
  if (readFileSync(committedSchema, "utf8") !== generatedBytes) {
    throw new Error("committed generated/tool-schemas.json is not in canonical byte format");
  }

  const schemaTarget = join(target, "generated", "tool-schemas.json");
  mkdirSync(dirname(schemaTarget), { recursive: true });
  writeFileSync(schemaTarget, generatedBytes, "utf8");
}

function verifyArtifact(target) {
  const required = [
    ...providerRuntimeFiles,
    "README.md",
    "generated/tool-schemas.json",
    "runtime/package.json",
    "runtime/package-lock.json",
    "runtime/dist/runtime/jsonl-server.js",
    "runtime/dist/storage/migrations/001_init_graph.sql",
    "runtime/dist/storage/migrations/003_runtime_operations.sql"
  ];
  for (const path of required) {
    if (!existsSync(join(target, path))) {
      throw new Error(`artifact file is missing: ${path}`);
    }
  }

  const forbiddenTokens = [
    "PARTNER_MEM_ROOT",
    "PARTNER_MEM_DB",
    "PARTNER_MEM_AGENT_ID",
    repositoryRoot,
    repositoryRoot.replaceAll("\\", "/")
  ];

  for (const file of listFiles(target)) {
    const artifactPath = relative(target, file);
    if (artifactPath.endsWith(".ts")) {
      throw new Error(`TypeScript source leaked into artifact: ${artifactPath}`);
    }
    if (artifactPath.split(sep).includes("node_modules")) {
      throw new Error(`node_modules leaked into artifact: ${artifactPath}`);
    }

    const content = readFileSync(file, "utf8");
    for (const token of new Set(forbiddenTokens)) {
      if (token && content.includes(token)) {
        throw new Error(`forbidden repository coupling in ${artifactPath}: ${token}`);
      }
    }
  }
}

function relativeJavaScriptSpecifiers(source) {
  return [...source.matchAll(/["'](\.\.?\/[^"']+\.js)["']/gu)].map((match) => match[1]);
}

function assertInside(root, candidate, description) {
  const path = relative(root, candidate);
  if (path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path))) {
    return;
  }
  throw new Error(`${description} escapes compiled dist: ${candidate}`);
}

function listFiles(root) {
  const files = [];
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

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}
