#!/usr/bin/env bun
// Bundle src/skiff/chrome/src/{hello,drawer,tabs}/index.ts → IIFE .uc.js
// files in dist/chrome/JS/, prepending each with its UserScript banner.
//
// Mechanically lifted from archive/build.ts (palefox v0.43.0).
//
// Run via:
//   bun run chrome:bundle    one-shot
//   bun --watch tools/chrome-bundle/build.ts   watch mode

import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { entries, type Entry } from "./build.config";

const REPO_ROOT = resolve(import.meta.dir, "..", "..");
const OUT_DIR = join(REPO_ROOT, "dist", "chrome", "JS");

async function buildOne(entry: Entry): Promise<boolean> {
  const result = await Bun.build({
    entrypoints: [join(REPO_ROOT, entry.src)],
    target: "browser",
    format: "iife",
    minify: false,
    sourcemap: "none", // chrome scripts don't surface external maps cleanly
  });

  if (!result.success) {
    console.error(`✗ ${entry.src}`);
    for (const log of result.logs) console.error(log);
    return false;
  }

  const [artifact] = result.outputs;
  if (!artifact) {
    console.error(`✗ ${entry.src}: no output produced`);
    return false;
  }
  const code = await artifact.text();
  const outPath = join(OUT_DIR, entry.out);
  await writeFile(outPath, entry.banner + "\n\n" + code);
  console.log(`✓ ${outPath}  (${code.length} bytes)`);
  return true;
}

await mkdir(OUT_DIR, { recursive: true });
const results = await Promise.all(entries.map(buildOne));
if (results.some((ok) => !ok)) process.exit(1);
