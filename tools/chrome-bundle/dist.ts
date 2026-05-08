#!/usr/bin/env bun
// Build the complete chrome distribution at dist/. Composes:
//
//   1. bundle JS:     src/skiff/chrome/src/{hello,drawer,tabs}/index.ts
//                       → dist/chrome/JS/*.uc.js
//   2. stage utils:   src/skiff/chrome/utils/*  → dist/chrome/utils/
//   3. stage CSS:     src/skiff/chrome/css/*    → dist/chrome/CSS/
//   4. stage program: src/skiff/program/defaults/pref/config-prefs.js
//                       → dist/program/defaults/pref/config-prefs.js
//   5. generate bootstrap: hashes everything in dist/chrome/{utils,JS,CSS}/
//                       → dist/program/config.js  (hash-pinned loader)
//
// After this runs, dist/ is a self-contained chrome distribution. Use
// `bun run chrome:install` to drop the pieces into the running skiff
// install + a test profile.

import { $ } from "bun";
import { existsSync } from "node:fs";
import { mkdir, copyFile, readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dir, "..", "..");
const SRC_CHROME = join(REPO_ROOT, "src", "skiff", "chrome");
const SRC_PROGRAM = join(REPO_ROOT, "src", "skiff", "program");
const DIST = join(REPO_ROOT, "dist");
const DIST_CHROME = join(DIST, "chrome");
const DIST_PROGRAM = join(DIST, "program");

async function step(name: string, fn: () => Promise<void>): Promise<void> {
  console.log(`→ ${name}`);
  await fn();
}

async function copyDir(src: string, dst: string): Promise<void> {
  await mkdir(dst, { recursive: true });
  for (const name of await readdir(src)) {
    await copyFile(join(src, name), join(dst, name));
  }
}

async function main(): Promise<void> {
  // Wipe dist/ for a fresh build — small enough that the cost is trivial
  // and avoids stale files masking renames/removals.
  if (existsSync(DIST)) await rm(DIST, { recursive: true });
  await mkdir(DIST_CHROME, { recursive: true });
  await mkdir(DIST_PROGRAM, { recursive: true });

  await step("bundling chrome JS (hello, drawer, tabs)", async () => {
    const proc = Bun.spawn({
      cmd: ["bun", join(import.meta.dir, "build.ts")],
      cwd: REPO_ROOT,
      stdout: "inherit",
      stderr: "inherit",
    });
    const code = await proc.exited;
    if (code !== 0) throw new Error(`chrome bundle failed (exit ${code})`);
  });

  await step("staging chrome/utils", async () => {
    await copyDir(join(SRC_CHROME, "utils"), join(DIST_CHROME, "utils"));
  });

  await step("staging chrome/CSS", async () => {
    await copyDir(join(SRC_CHROME, "css"), join(DIST_CHROME, "CSS"));
  });

  await step("staging program/defaults/pref", async () => {
    const dst = join(DIST_PROGRAM, "defaults", "pref");
    await mkdir(dst, { recursive: true });
    await copyFile(
      join(SRC_PROGRAM, "defaults", "pref", "config-prefs.js"),
      join(dst, "config-prefs.js"),
    );
  });

  await step("generating dist/program/config.js (hash-pinned bootstrap)", async () => {
    const proc = Bun.spawn({
      cmd: ["bun", join(import.meta.dir, "generate-bootstrap.ts")],
      cwd: REPO_ROOT,
      stdout: "inherit",
      stderr: "inherit",
    });
    const code = await proc.exited;
    if (code !== 0) throw new Error(`bootstrap generation failed (exit ${code})`);
  });

  console.log("\n✓ chrome distribution ready at dist/");
  console.log("  install: bun run chrome:install [profile_name]");
}

await main();
