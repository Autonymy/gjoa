// Locale-string substitutions for Gjoa.
//
// Mozilla's en-US locale files contain Firefox-branded marketing
// (taglines, default-browser prompts, etc.). We rewrite the ones that
// matter so Gjoa doesn't ship with Firefox's voice baked into the UI.
//
// Pattern: literal string match → replacement. Add new entries as we
// catch more Firefox-isms in the running browser. KEEP the patterns
// narrow — never substitute on partial / generic substrings.
//
// Files we rewrite live under engine/browser/locales/en-US/. Each pass
// is idempotent: if the replacement is already present, the substitution
// is a no-op.
//
// Effort: Lane 2 — these strings live in omni.ja, so changes need
// `bun run import` + `./mach build faster` to take effect.

import { existsSync, readdirSync, statSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ENGINE_DIR } from "./paths";
import { log } from "./log";

const LOCALE_DIR = join(ENGINE_DIR, "browser", "locales", "en-US");

/** Substitutions to apply across every text file under LOCALE_DIR.
 *  Order doesn't matter (each is a literal find/replace). */
const SUBSTITUTIONS: ReadonlyArray<readonly [string, string]> = [
  // Default-browser prompt tagline.
  [
    "Get speed, safety, and privacy every time you browse.",
    "A browser at your command.",
  ],
  // New-tab set-default-message variant (no Oxford comma).
  [
    "Get speed, safety and privacy every time you browse.",
    "A browser at your command.",
  ],
];

/** Walk a directory recursively, yielding every regular file path. */
function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p);
    else if (st.isFile()) yield p;
  }
}

const TEXT_EXTS = /\.(ftl|dtd|properties|js|json|html|xml|md|txt)$/i;

export async function locales(): Promise<void> {
  if (!existsSync(LOCALE_DIR)) {
    log.warn(`locales: ${LOCALE_DIR} missing — skipping (engine/ not imported?)`);
    return;
  }
  log.step(`rewriting Firefox-isms in browser locales`);
  let changed = 0;
  for (const path of walk(LOCALE_DIR)) {
    if (!TEXT_EXTS.test(path)) continue;
    let text: string;
    try { text = await readFile(path, "utf8"); }
    catch { continue; }
    let next = text;
    for (const [from, to] of SUBSTITUTIONS) {
      if (next.includes(from)) next = next.split(from).join(to);
    }
    if (next !== text) {
      await writeFile(path, next, "utf8");
      changed++;
    }
  }
  log.ok(`locales: rewrote ${changed} file${changed === 1 ? "" : "s"}`);
}
