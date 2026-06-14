#!/usr/bin/env bun
// Wire dist/chrome/ into the running gjoa install for dev-mode loading.
//
// Replaces the previous fx-autoconfig install (which dropped a loader into
// the install root + scripts into a profile chrome/). With the native
// loader baked into omni.ja, the only thing dev mode needs is a single
// `<install_root>/gjoa-dev/` directory containing JS/ and CSS/
// subdirectories. The loader (browser/components/gjoa/GjoaLoader.sys.mjs)
// reads from there at startup.
//
// We use a SYMLINK rather than a copy:
//   - Copy:    every iteration needs `bun run chrome:dist && bun run chrome:install`
//   - Symlink: only `bun run chrome:dist` is needed; the install path
//              transparently points at the freshly-rebuilt dist/.
//
// Trust note: the symlink target is owned by the current user (your repo
// checkout). The install root for a dev build is also owned by the current
// user, so this is the same trust boundary. For a production install (root-
// owned install root), only root could create this symlink — end users
// can't accidentally activate dev mode.

import { existsSync } from "node:fs";
import { rm, symlink } from "node:fs/promises";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dir, "..", "..");
const DIST_CHROME = join(REPO_ROOT, "dist", "chrome");

const REPO_OBJDIR = join(REPO_ROOT, "engine", "obj-x86_64-pc-linux-gnu");
const ENV_OBJDIR = process.env.MOZ_OBJDIR;
const MOZ_OBJDIR =
  ENV_OBJDIR && ENV_OBJDIR.startsWith(REPO_ROOT) ? ENV_OBJDIR : REPO_OBJDIR;
const INSTALL_ROOT = join(MOZ_OBJDIR, "dist", "bin");
const GJOA_DEV = join(INSTALL_ROOT, "gjoa-dev");

async function main(): Promise<void> {
  if (!existsSync(DIST_CHROME)) {
    console.error(`✗ dist/chrome/ not built — run \`bun run chrome:dist\` first`);
    process.exit(1);
  }
  if (!existsSync(INSTALL_ROOT)) {
    console.error(
      `✗ install root not found at ${INSTALL_ROOT} — has gjoa been built ` +
      `via mach? (\`cd engine && ./mach build\`)`,
    );
    process.exit(1);
  }

  // Replace any existing symlink/dir so re-runs are idempotent.
  if (existsSync(GJOA_DEV)) {
    await rm(GJOA_DEV, { recursive: true, force: true });
  }
  await symlink(DIST_CHROME, GJOA_DEV, "dir");

  console.log(`✓ symlinked ${DIST_CHROME} → ${GJOA_DEV}`);
  console.log(`\nLaunch:`);
  console.log(`  ${INSTALL_ROOT}/gjoa --no-remote --profile <profile_dir>`);
  console.log(`\nDaily loop: edit src/gjoa/chrome/bjs/* → \`bun run chrome:dist\` → restart gjoa.`);
}

await main();
