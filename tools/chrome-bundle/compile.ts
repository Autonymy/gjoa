#!/usr/bin/env bun
// Compile all .bjs source files to JS in .beagle-out/ via beagle-build.
// Skips macros.bjs (compile-time only) and test files.

import { readdir, mkdir } from "node:fs/promises";
import { join, resolve, relative } from "node:path";

const REPO_ROOT = resolve(import.meta.dir, "..", "..");
const BJS_ROOT = join(REPO_ROOT, "src", "gjoa", "chrome", "bjs");
const OUT_ROOT = join(REPO_ROOT, ".beagle-out");
const BEAGLE_BUILD = resolve(REPO_ROOT, "..", "beagle", "bin", "beagle-build");

async function findBjsFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await findBjsFiles(full)));
    } else if (entry.name.endsWith(".bjs")) {
      results.push(full);
    }
  }
  return results;
}

function shouldSkip(rel: string): boolean {
  if (rel === "macros.bjs") return true;
  if (rel.startsWith("test/")) return true;
  if (rel.endsWith(".test.bjs")) return true;
  return false;
}

const allFiles = await findBjsFiles(BJS_ROOT);
let failed = 0;

for (const src of allFiles.sort()) {
  const rel = relative(BJS_ROOT, src);
  if (shouldSkip(rel)) continue;

  const outRel = rel.replace(/\.bjs$/, ".js");
  const outPath = join(OUT_ROOT, outRel);
  await mkdir(join(outPath, ".."), { recursive: true });

  const proc = Bun.spawn({
    cmd: [BEAGLE_BUILD, src, outPath],
    cwd: REPO_ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });

  const code = await proc.exited;
  if (code !== 0) {
    const stderr = await new Response(proc.stderr).text();
    console.error(`✗ ${rel}: ${stderr.trim()}`);
    failed++;
  } else {
    console.log(`  ${rel}`);
  }
}

if (failed > 0) {
  console.error(`\n✗ ${failed} file(s) failed to compile`);
  process.exit(1);
}
console.log(`\n✓ ${allFiles.length - failed} files compiled to .beagle-out/`);
