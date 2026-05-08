#!/usr/bin/env bun
// Generate dist/program/config.js — the hash-pinned chrome bootstrap.
//
// Reads src/skiff/program/config.template.js, computes SHA-256 of every
// file in dist/chrome/{utils,JS,CSS}/ that the bootstrap will hash-check
// at runtime, and substitutes the __PALEFOX_PINNED__ placeholder with
// the resulting JSON literal.
//
// Mechanically lifted from archive/tools/generate-bootstrap.ts. The
// __PALEFOX_PINNED__ placeholder name is unchanged because the template
// text is unchanged; rename in a later stretch goal alongside the
// template. Outputs are gitignored.
//
// Order of operations: this MUST run AFTER chrome:bundle (so the .uc.js
// files are present and final) AND AFTER chrome utils/CSS staging.
// `bun run chrome:dist` orchestrates the whole sequence.

import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dir, "..", "..");
const TEMPLATE = join(REPO_ROOT, "src", "skiff", "program", "config.template.js");
const OUTPUT = join(REPO_ROOT, "dist", "program", "config.js");

// Mirror of WATCHED in src/skiff/program/config.template.js — keep in sync.
const WATCHED: Array<{ subdir: string; pattern: RegExp }> = [
  { subdir: "utils", pattern: /./ },
  { subdir: "JS", pattern: /^[A-Za-z0-9].*\.(uc\.js|uc\.mjs|sys\.mjs)$/i },
  { subdir: "CSS", pattern: /^[A-Za-z0-9].*\.uc\.css$/i },
];

const STAGING_ROOT = join(REPO_ROOT, "dist", "chrome");

async function listFiles(dir: string, pattern: RegExp): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry);
    const s = await stat(path);
    if (s.isFile() && pattern.test(entry)) out.push(path);
  }
  return out.sort();
}

async function sha256(path: string): Promise<string> {
  const buf = await readFile(path);
  const h = createHash("sha256");
  h.update(buf);
  return "sha256-" + h.digest("base64");
}

async function buildManifest(): Promise<Record<string, string>> {
  const manifest: Record<string, string> = {};
  for (const { subdir, pattern } of WATCHED) {
    const dirPath = join(STAGING_ROOT, subdir);
    const files = await listFiles(dirPath, pattern);
    for (const file of files) {
      // Bootstrap looks files up under UChrm = <profile>/chrome/, so the key
      // strips the leading "<repo>/dist/chrome/" — making it
      // "utils/boot.sys.mjs" etc.
      const relPath = file.slice(STAGING_ROOT.length + 1).replaceAll("\\", "/");
      manifest[relPath] = await sha256(file);
    }
  }
  return manifest;
}

const template = await readFile(TEMPLATE, "utf8");
const manifest = await buildManifest();

if (Object.keys(manifest).length === 0) {
  console.error(
    "✗ generate-bootstrap: empty manifest — run `bun run chrome:bundle` " +
    "and stage utils/CSS into dist/chrome/ first.",
  );
  process.exit(1);
}

const manifestJson = JSON.stringify(manifest, null, 2);
const generated = template.replace("__PALEFOX_PINNED__", manifestJson);

if (generated === template) {
  console.error(
    `✗ generate-bootstrap: __PALEFOX_PINNED__ placeholder not found in ${TEMPLATE}`,
  );
  process.exit(1);
}

await mkdir(join(REPO_ROOT, "dist", "program"), { recursive: true });
await writeFile(OUTPUT, generated);
console.log(`✓ ${OUTPUT}  (${Object.keys(manifest).length} pinned entries)`);
