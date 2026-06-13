// Locate the gjoa binary inside engine/obj-*/dist/bin/.
//
// gjoa is its own Firefox build, so we don't need palefox's "test rig"
// (a separate stock-Firefox install + autoconfig bootstrap). The binary
// produced by `mach build` lives under engine/obj-*/dist/bin/gjoa-bin
// (or `gjoa` for the wrapper). The chrome JS gets loaded by gjoa's
// built-in loader when <install_root>/gjoa-dev/ exists, which
// `bun run chrome:install` sets up.
//
// Resolution flow:
//   1. $GJOA_BIN env var (explicit override)
//   2. engine/obj-*/dist/bin/gjoa-bin
//   3. engine/obj-*/dist/bin/gjoa
//   4. throw with setup hint

import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ENGINE_DIR = "engine";

export interface GjoaBinaryInfo {
  /** Absolute path to the binary to spawn. */
  path: string;
  /** Absolute path to the install root (where gjoa-dev/ lives). */
  installRoot: string;
}

/** Find the gjoa binary. Throws with a setup hint if not present. */
export function locateGjoa(cwd: string = process.cwd()): GjoaBinaryInfo {
  if (process.env.GJOA_BIN) {
    const path = process.env.GJOA_BIN;
    if (!existsSync(path)) {
      throw new Error(`$GJOA_BIN points at ${path} but no such file exists`);
    }
    return { path, installRoot: dirname(path) };
  }

  const engineDir = join(cwd, ENGINE_DIR);
  if (!existsSync(engineDir)) {
    throw new Error(
      `gjoa-locator: ${engineDir} not found.\n` +
      `Run from the gjoa repo root, or set $GJOA_BIN.`,
    );
  }

  let objDir: string | null = null;
  for (const name of readdirSync(engineDir)) {
    if (name.startsWith("obj-") && statSync(join(engineDir, name)).isDirectory()) {
      objDir = join(engineDir, name);
      break;
    }
  }
  if (!objDir) {
    throw new Error(
      `gjoa-locator: no engine/obj-* build dir found.\n` +
      `Run \`mach build faster\` (Lane 2) inside engine/ first.`,
    );
  }

  const binDir = join(objDir, "dist", "bin");
  for (const candidate of ["gjoa-bin", "gjoa", "firefox-bin", "firefox"]) {
    const p = join(binDir, candidate);
    if (existsSync(p)) return { path: p, installRoot: binDir };
  }
  throw new Error(
    `gjoa-locator: no gjoa-bin / gjoa / firefox-bin / firefox under ${binDir}.\n` +
    `The build dir exists but no binary — did the build complete?`,
  );
}

function dirname(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? "." : p.slice(0, i);
}

if (import.meta.main) {
  try {
    const info = locateGjoa();
    console.log(JSON.stringify(info, null, 2));
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}
