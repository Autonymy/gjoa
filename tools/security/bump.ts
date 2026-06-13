#!/usr/bin/env bun
// security:bump — write the latest Mozilla stable Firefox version into
// gjoa.json (firefox.version + firefox.candidate). Non-interactive.
//
// Run after this:  bun run import  (regenerates engine/ from the new pin)
//
// Flags:
//   --check    Just print what the new pin would be; don't write.
//   --esr      Use the ESR track instead of latest stable.

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { REPO_ROOT } from "../prep/paths";

interface MozillaVersions {
  LATEST_FIREFOX_VERSION: string;
  FIREFOX_ESR: string;
}

const PRODUCT_DETAILS_URL = "https://product-details.mozilla.org/1.0/firefox_versions.json";

async function fetchVersions(): Promise<MozillaVersions> {
  const r = await fetch(PRODUCT_DETAILS_URL, { signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error(`product-details HTTP ${r.status}`);
  return (await r.json()) as MozillaVersions;
}

async function main(): Promise<void> {
  const esrMode = process.argv.includes("--esr");
  const checkOnly = process.argv.includes("--check");

  const versions = await fetchVersions();
  const latest = esrMode
    ? versions.FIREFOX_ESR.replace(/esr$/i, "")
    : versions.LATEST_FIREFOX_VERSION;

  const path = join(REPO_ROOT, "gjoa.json");
  const text = await readFile(path, "utf8");
  const cfg = JSON.parse(text) as { firefox: { version: string; candidate: string; candidateBuild: number } };
  const oldVersion = cfg.firefox.version;

  if (oldVersion === latest) {
    console.error(`[bump] gjoa.json already at ${latest} — no change.`);
    process.exit(0);
  }

  console.error(`[bump] ${oldVersion}  →  ${latest}${esrMode ? "  (ESR)" : ""}`);

  if (checkOnly) {
    console.error(`[bump] --check: not writing. Re-run without --check to apply.`);
    process.exit(0);
  }

  cfg.firefox.version = latest;
  cfg.firefox.candidate = latest;
  cfg.firefox.candidateBuild = 1;

  // Preserve the user's indentation by re-stringifying with 2 spaces (the
  // existing file uses 2-space indent and ends with a single trailing
  // newline, per Mozilla convention).
  await writeFile(path, JSON.stringify(cfg, null, 2) + "\n", "utf8");
  console.error(`[bump] wrote gjoa.json`);
  console.error(``);
  console.error(`Next steps:`);
  console.error(`  1. bun run import      # re-download tarball, re-apply overlays`);
  console.error(`  2. nix build .#gjoa --impure   # full rebuild (Lane 3)`);
  console.error(`  3. relaunch — verify everything still works`);
  console.error(``);
  console.error(`If the new version breaks something, restore the pin from git:`);
  console.error(`  git checkout gjoa.json`);
}

main().catch((err) => {
  console.error(`[bump] failed: ${(err as Error).message}`);
  process.exit(1);
});
