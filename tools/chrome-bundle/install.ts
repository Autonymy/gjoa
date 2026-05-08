#!/usr/bin/env bun
// Drop the chrome distribution from dist/ into the right places so
// skiff actually loads it on launch.
//
// Two install targets:
//
//   1. INSTALL ROOT — $MOZ_OBJDIR/dist/bin/  (the built skiff install tree)
//      - program/config.js                  → install_root/config.js
//      - program/defaults/pref/config-prefs.js
//                                             → install_root/defaults/pref/
//      Reasoning: Firefox's autoconfig pref system reads config.js from
//      the application install root, not from a profile. Setting it via
//      defaults/pref/ means the prefs are baked-in defaults — the user
//      never sees them in about:config, can't accidentally turn them off.
//
//   2. PROFILE — ~/.mozilla/firefox/<profile>/
//      - chrome/utils/ ← dist/chrome/utils/   (fx-autoconfig boot chain)
//      - chrome/JS/    ← dist/chrome/JS/      (bundled .uc.js)
//      - chrome/CSS/   ← dist/chrome/CSS/     (palefox stylesheets)
//      Reasoning: the bootstrap looks up chrome/* under UChrm = the
//      profile's chrome dir. This is where the loader EXPECTS to find
//      hashed files when the bootstrap runs.
//
// Profile selection:
//   $1 (positional arg) = profile dir name under ~/.mozilla/firefox/.
//   defaults to "skiff-test". Created fresh if it doesn't exist.

import { $ } from "bun";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { copyFile, mkdir, readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dir, "..", "..");
const DIST = join(REPO_ROOT, "dist");
const DIST_CHROME = join(DIST, "chrome");
const DIST_PROGRAM = join(DIST, "program");

// Prefer repo-relative objdir over $MOZ_OBJDIR. The flake.nix shellHook
// sets $MOZ_OBJDIR but if you happened to enter the dev shell from a
// different repo (e.g. palefox), the env var would point at the wrong
// engine. Repo-relative is the source of truth; honor $MOZ_OBJDIR only
// when it's explicitly inside our repo.
const REPO_OBJDIR = join(REPO_ROOT, "engine", "obj-x86_64-pc-linux-gnu");
const ENV_OBJDIR = process.env.MOZ_OBJDIR;
const MOZ_OBJDIR =
  ENV_OBJDIR && ENV_OBJDIR.startsWith(REPO_ROOT) ? ENV_OBJDIR : REPO_OBJDIR;
const INSTALL_ROOT = join(MOZ_OBJDIR, "dist", "bin");

async function copyDir(src: string, dst: string): Promise<void> {
  await mkdir(dst, { recursive: true });
  for (const name of await readdir(src)) {
    await copyFile(join(src, name), join(dst, name));
  }
}

function profileDir(name: string): string {
  // Skiff inherits Firefox's `~/.mozilla/firefox/` profiles dir (we haven't
  // overridden MOZ_PROFILE_PATH or similar). When we eventually want true
  // profile isolation between skiff and a user's daily Firefox, this is
  // the place to thread an env-var.
  return join(homedir(), ".mozilla", "firefox", name);
}

async function step(label: string, fn: () => Promise<void>): Promise<void> {
  console.log(`→ ${label}`);
  await fn();
}

async function main(): Promise<void> {
  const profileName = process.argv[2] ?? "skiff-test";

  if (!existsSync(DIST_CHROME) || !existsSync(DIST_PROGRAM)) {
    console.error(
      `✗ dist/ not built — run \`bun run chrome:dist\` first`,
    );
    process.exit(1);
  }
  if (!existsSync(INSTALL_ROOT)) {
    console.error(
      `✗ install root not found at ${INSTALL_ROOT} — has skiff been built ` +
      `via mach? (\`cd engine && ./mach build\`)`,
    );
    process.exit(1);
  }

  // ---- 1. Install root: bootstrap + autoconfig pref defaults ----
  await step(`installing config.js → ${INSTALL_ROOT}`, async () => {
    await copyFile(
      join(DIST_PROGRAM, "config.js"),
      join(INSTALL_ROOT, "config.js"),
    );
  });

  await step(
    `installing defaults/pref/config-prefs.js → ${INSTALL_ROOT}/defaults/pref/`,
    async () => {
      const prefDir = join(INSTALL_ROOT, "defaults", "pref");
      await mkdir(prefDir, { recursive: true });
      await copyFile(
        join(DIST_PROGRAM, "defaults", "pref", "config-prefs.js"),
        join(prefDir, "config-prefs.js"),
      );
    },
  );

  // ---- 2. Profile: chrome/utils + chrome/JS + chrome/CSS ----
  const profile = profileDir(profileName);
  const chromeDir = join(profile, "chrome");

  await step(`preparing profile ${profile}`, async () => {
    await mkdir(profile, { recursive: true });
  });

  // Wipe the chrome dir so removed files don't linger and trip the
  // bootstrap's "extra file" check.
  if (existsSync(chromeDir)) {
    await step(`clearing existing chrome/ in profile`, async () => {
      await rm(chromeDir, { recursive: true });
    });
  }

  await step(`copying chrome/utils, chrome/JS, chrome/CSS into profile`, async () => {
    await copyDir(join(DIST_CHROME, "utils"), join(chromeDir, "utils"));
    await copyDir(join(DIST_CHROME, "JS"), join(chromeDir, "JS"));
    await copyDir(join(DIST_CHROME, "CSS"), join(chromeDir, "CSS"));
  });

  console.log(`\n✓ install complete`);
  console.log(`\nLaunch:`);
  console.log(`  ${INSTALL_ROOT}/skiff --no-remote --profile ${profile}`);
}

await main();
