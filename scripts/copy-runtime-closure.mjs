#!/usr/bin/env node

import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync
} from "node:fs";
import {
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep
} from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rootDist = resolve(repositoryRoot, "dist");
const runtimeEntry = resolve(rootDist, "runtime", "cli.js");
const output = parseOutput(process.argv.slice(2));

assertInside(repositoryRoot, output, "runtime closure output");
if (!existsSync(runtimeEntry)) {
  throw new Error("dist/runtime/cli.js is missing; run the root build first");
}

rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });

const pending = [runtimeEntry];
const visited = new Set();
while (pending.length > 0) {
  const source = pending.pop();
  if (source === undefined || visited.has(source)) continue;
  assertInside(rootDist, source, "compiled runtime dependency");
  if (!existsSync(source) || !statSync(source).isFile()) {
    throw new Error(
      `compiled runtime dependency is missing: ${relative(rootDist, source)}`
    );
  }
  visited.add(source);
  const destination = resolve(output, relative(rootDist, source));
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(source, destination);

  const sourceText = readFileSync(source, "utf8");
  for (const specifier of relativeJavaScriptSpecifiers(sourceText)) {
    const dependency = resolve(dirname(source), specifier);
    assertInside(rootDist, dependency, `import ${specifier}`);
    pending.push(dependency);
  }
}

copyRequiredDirectory("storage/migrations");
copyRequiredDirectory("tools/generated");
verifyClosure(output);

process.stdout.write(`${output}\n`);

function parseOutput(args) {
  if (args.length !== 2 || args[0] !== "--output" || !args[1]) {
    throw new Error(
      "usage: node scripts/copy-runtime-closure.mjs --output <directory>"
    );
  }
  return resolve(repositoryRoot, args[1]);
}

function copyRequiredDirectory(relativePath) {
  const source = resolve(rootDist, relativePath);
  if (!existsSync(source)) {
    throw new Error(`compiled runtime data is missing: dist/${relativePath}`);
  }
  cpSync(source, resolve(output, relativePath), { recursive: true });
}

function relativeJavaScriptSpecifiers(source) {
  return [...source.matchAll(/["'](\.\.?\/[^"']+\.js)["']/gu)].map(
    (match) => match[1]
  );
}

function assertInside(root, candidate, description) {
  const path = relative(root, candidate);
  if (
    path === "" ||
    (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path))
  ) {
    return;
  }
  throw new Error(`${description} escapes ${root}: ${candidate}`);
}

function verifyClosure(root) {
  const required = [
    "runtime/cli.js",
    "runtime/jsonl-server.js",
    "runtime/partner-mem-runtime.js",
    "storage/migrations/001_v1_foundation.sql",
    "storage/migrations/002_v1_immutability.sql",
    "storage/migrations/003_v1_retrieval_indexes.sql",
    "tools/generated/tool-schemas.json"
  ];
  for (const path of required) {
    if (!existsSync(resolve(root, path))) {
      throw new Error(`runtime closure is missing: ${path}`);
    }
  }
  for (const file of listFiles(root)) {
    if (file.endsWith(".ts")) {
      throw new Error(`TypeScript source leaked into runtime closure: ${file}`);
    }
    const text = readFileSync(file, "utf8");
    if (text.includes(repositoryRoot)) {
      throw new Error(`repository path leaked into runtime closure: ${file}`);
    }
  }
}

function listFiles(root) {
  const files = [];
  for (const entry of readdirSync(root)) {
    const path = resolve(root, entry);
    if (statSync(path).isDirectory()) {
      files.push(...listFiles(path));
    } else {
      files.push(path);
    }
  }
  return files;
}
