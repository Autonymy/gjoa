#!/usr/bin/env bun
// Build the chrome distribution at dist/. Composes:
//
//   1. compile beagle:  src/gjoa/chrome/bjs/**/*.bjs → .beagle-out/**/*.js
//   2. bundle JS:       .beagle-out/ → dist/chrome/JS/*.uc.js (IIFE concat)
//   3. stage CSS:       src/gjoa/chrome/css/* → dist/chrome/CSS/
//
// Output is consumed by `bun run chrome:install` which symlinks
// dist/chrome/ into <install_root>/gjoa-dev/. Gjoa's native loader
// (browser/components/gjoa/GjoaLoader.sys.mjs) reads from there at
// startup when the dev-mode directory is present.
//
// No fx-autoconfig step. The loader is baked into omni.ja by the one-time
// `mach build faster` after `bun run import`.

import { existsSync } from "node:fs";
import { mkdir, copyFile, readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dir, "..", "..");
const SRC_CHROME = join(REPO_ROOT, "src", "gjoa", "chrome");
const DIST = join(REPO_ROOT, "dist");
const DIST_CHROME = join(DIST, "chrome");

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
  if (existsSync(DIST)) await rm(DIST, { recursive: true });
  await mkdir(DIST_CHROME, { recursive: true });

  await step("compiling beagle sources", async () => {
    const proc = Bun.spawn({
      cmd: ["bun", join(import.meta.dir, "compile.ts")],
      cwd: REPO_ROOT,
      stdout: "inherit",
      stderr: "inherit",
    });
    const code = await proc.exited;
    if (code !== 0) throw new Error(`beagle compile failed (exit ${code})`);
  });

  await step("bundling chrome JS", async () => {
    const proc = Bun.spawn({
      cmd: ["bun", join(import.meta.dir, "build.ts")],
      cwd: REPO_ROOT,
      stdout: "inherit",
      stderr: "inherit",
    });
    const code = await proc.exited;
    if (code !== 0) throw new Error(`chrome bundle failed (exit ${code})`);
  });

  await step("staging chrome/CSS", async () => {
    await copyDir(join(SRC_CHROME, "css"), join(DIST_CHROME, "CSS"));
  });

  console.log("\n✓ chrome distribution ready at dist/");
  console.log("  install: bun run chrome:install");
}

await main();
