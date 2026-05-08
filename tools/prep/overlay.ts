import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { $ } from "bun";
import { ENGINE_DIR, SRC_DIR } from "./paths";
import { log } from "./log";

// Apply src/skiff/ overlays onto engine/. Mirrors the directory structure:
// src/skiff/browser/components/foo/X.mjs → engine/browser/components/foo/X.mjs.
// Existing engine/ files are overwritten. New files are added.
//
// We don't currently delete files from engine/ that aren't in src/ — Firefox
// build is forgiving of extra files but breaks fast on missing ones. If we
// later want true "tree-replace" semantics we can switch to rsync --delete
// scoped to specific subtrees.
export async function overlay(): Promise<void> {
  if (!existsSync(SRC_DIR)) {
    log.info(`no src/skiff/ overlays present, skipping`);
    return;
  }

  const entries = readdirSync(SRC_DIR);
  if (entries.length === 0) {
    log.info(`src/skiff/ is empty, skipping overlay`);
    return;
  }

  log.step(`applying src/skiff/ overlays`);
  // -a preserves perms/timestamps; trailing slash on source so contents merge
  // into engine/ rather than creating engine/skiff/.
  await $`cp -a ${SRC_DIR}/. ${ENGINE_DIR}/`.quiet();

  const fileCount = countFiles(SRC_DIR);
  log.ok(`overlaid ${fileCount} file${fileCount === 1 ? "" : "s"}`);
}

function countFiles(dir: string): number {
  let count = 0;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) count += countFiles(path);
    else count += 1;
  }
  return count;
}
