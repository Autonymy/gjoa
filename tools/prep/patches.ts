import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { $ } from "bun";
import { ENGINE_DIR, PATCHES_DIR, REPO_ROOT } from "./paths";
import { log } from "./log";

// Apply *.patch files from patches/ in alphabetical order. Idempotency:
// engine/ has its own .git initialized inside it (see ensureEngineGit), and
// we record applied patches in engine/.skiff-applied-patches so re-runs skip.
//
// We use git apply rather than git am because mozilla-central's tree isn't
// commit-aware in the way we'd need — we just want a plain patch application.
const APPLIED_LOG = ".skiff-applied-patches";

async function ensureEngineGit(): Promise<void> {
  if (existsSync(join(ENGINE_DIR, ".git"))) return;
  // mach detects .git/ and queries it for build metadata. If we don't init it,
  // mach falls back, but having the repo lets us use git apply cleanly.
  await $`git init -q`.cwd(ENGINE_DIR);
  await $`git add -A`.cwd(ENGINE_DIR).quiet();
  await $`git -c user.email=prep@skiff -c user.name=prep commit -q -m "vanilla mozilla-central"`.cwd(ENGINE_DIR);
}

async function readApplied(): Promise<Set<string>> {
  const path = join(ENGINE_DIR, APPLIED_LOG);
  if (!existsSync(path)) return new Set();
  const text = await Bun.file(path).text();
  return new Set(text.split("\n").map((s) => s.trim()).filter(Boolean));
}

async function recordApplied(applied: Set<string>): Promise<void> {
  const path = join(ENGINE_DIR, APPLIED_LOG);
  await Bun.write(path, [...applied].sort().join("\n") + "\n");
}

export async function patches(): Promise<void> {
  if (!existsSync(PATCHES_DIR)) {
    log.info(`no patches/ directory, skipping`);
    return;
  }
  const allPatches = readdirSync(PATCHES_DIR)
    .filter((f) => f.endsWith(".patch"))
    .sort();
  if (allPatches.length === 0) {
    log.info(`patches/ is empty, skipping`);
    return;
  }

  await ensureEngineGit();
  const applied = await readApplied();
  let newCount = 0;

  for (const name of allPatches) {
    if (applied.has(name)) continue;
    const path = join(PATCHES_DIR, name);
    log.step(`applying patch ${name}`);
    try {
      await $`git apply --whitespace=nowarn ${path}`.cwd(ENGINE_DIR);
      applied.add(name);
      newCount += 1;
    } catch (e) {
      throw new Error(`failed to apply patch ${name}: ${e}`);
    }
  }

  if (newCount === 0) {
    log.info(`all ${allPatches.length} patches already applied`);
  } else {
    await recordApplied(applied);
    log.ok(`applied ${newCount} new patch${newCount === 1 ? "" : "es"}`);
  }
}
