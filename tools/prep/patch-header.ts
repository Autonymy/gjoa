#!/usr/bin/env bun
// Patch-header helper. Implements the gjoa convention:
//
//   Every patches/*.patch MUST begin with a structured metadata block:
//     # gjoa-patch:
//     #   baseline-firefox: <version>
//     #   touches:
//     #     - <path/from/mozilla/root>
//     #     - ...
//     #
//   ...followed by the freeform description, then the unified diff.
//
// Why: on Firefox upgrades, knowing the EXACT upstream version a patch
// was last calibrated against turns merge-conflict resolution from
// archaeology into a 3-way merge: pull `firefox-<baseline>.source.tar.xz`,
// diff its <touches> against the new version, apply our delta on top.
//
// Usage:
//   bun tools/prep/patch-header.ts check         # warn on missing/stale headers
//   bun tools/prep/patch-header.ts retrofit      # add header to any patch missing it
//                                                  (uses gjoa.json.firefox.version
//                                                   as the baseline — only run after
//                                                   regenerating a patch against
//                                                   the current pin)

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PATCHES_DIR, REPO_ROOT } from "./paths";

const HEADER_TAG = "# gjoa-patch:";

interface PatchInfo {
  filename: string;
  text: string;
  hasHeader: boolean;
  declaredBaseline: string | null;
  touches: string[];
}

/** Extract diff-touched paths from a patch body. Looks for
 *  `diff --git a/<path> b/<path>` lines (git-format) and falls back to
 *  `--- a/<path>` (plain unified diff). */
function extractTouches(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/^diff --git a\/(\S+)\s+b\/\S+$/gm)) {
    out.add(m[1]!);
  }
  if (out.size === 0) {
    for (const m of text.matchAll(/^---\s+a\/(\S+)$/gm)) out.add(m[1]!);
  }
  return [...out];
}

function parseHeader(text: string): { hasHeader: boolean; declaredBaseline: string | null } {
  if (!text.startsWith(HEADER_TAG)) {
    // Header may be preceded by nothing, but must be at the very top of the file.
    return { hasHeader: false, declaredBaseline: null };
  }
  const m = /^#\s*baseline-firefox:\s*(\S+)\s*$/m.exec(text);
  return { hasHeader: true, declaredBaseline: m ? m[1]! : null };
}

function formatHeader(baseline: string, touches: string[]): string {
  const lines = [
    HEADER_TAG,
    `#   baseline-firefox: ${baseline}`,
    `#   touches:`,
    ...touches.map((p) => `#     - ${p}`),
    `#`,
    ``,
  ];
  return lines.join("\n");
}

async function loadPatch(filename: string): Promise<PatchInfo> {
  const text = await readFile(join(PATCHES_DIR, filename), "utf8");
  const { hasHeader, declaredBaseline } = parseHeader(text);
  const touches = extractTouches(text);
  return { filename, text, hasHeader, declaredBaseline, touches };
}

async function listPatches(): Promise<string[]> {
  const entries = await readdir(PATCHES_DIR);
  return entries.filter((n) => n.endsWith(".patch")).sort();
}

async function loadCurrentBaseline(): Promise<string> {
  const cfg = JSON.parse(await readFile(join(REPO_ROOT, "gjoa.json"), "utf8")) as { firefox: { version: string } };
  return cfg.firefox.version;
}

/** Public verb: warn on any patch without a header or with a baseline
 *  that differs from gjoa.json.firefox.version. Returns the count of
 *  problems found (0 = clean). Non-fatal: prints to stderr; caller
 *  decides whether to bail. */
export async function checkAll(): Promise<number> {
  const current = await loadCurrentBaseline();
  const names = await listPatches();
  let problems = 0;
  for (const n of names) {
    const p = await loadPatch(n);
    if (!p.hasHeader) {
      console.error(`[patch-header] ${n}: MISSING header — run \`bun tools/prep/patch-header.ts retrofit\` after regenerating against ${current}`);
      problems++;
      continue;
    }
    if (!p.declaredBaseline) {
      console.error(`[patch-header] ${n}: header present but \`baseline-firefox\` not parseable`);
      problems++;
      continue;
    }
    if (p.declaredBaseline !== current) {
      // Not necessarily a problem — patches accumulate across versions.
      // Flag at INFO level so the user sees the drift.
      console.error(`[patch-header] ${n}: baseline ${p.declaredBaseline} ≠ gjoa.json ${current} (informational; regenerate when this patch fails to apply)`);
    }
  }
  return problems;
}

/** Public verb: add header to patches that are missing one. Uses the
 *  current gjoa.json firefox.version as the baseline label. Only run
 *  AFTER you've just regenerated the patch against the current source,
 *  otherwise the baseline label will lie. */
export async function retrofitAll(): Promise<void> {
  const current = await loadCurrentBaseline();
  const names = await listPatches();
  let changed = 0;
  for (const n of names) {
    const p = await loadPatch(n);
    if (p.hasHeader) continue;
    const header = formatHeader(current, p.touches);
    await writeFile(join(PATCHES_DIR, n), header + p.text, "utf8");
    console.error(`[patch-header] ${n}: added header (baseline=${current}, touches=${p.touches.length})`);
    changed++;
  }
  console.error(`[patch-header] done. ${changed} patch(es) updated.`);
}

if (import.meta.main) {
  const cmd = process.argv[2];
  if (cmd === "check") {
    const problems = await checkAll();
    process.exit(problems === 0 ? 0 : 2);
  } else if (cmd === "retrofit") {
    await retrofitAll();
  } else {
    console.error("Usage: bun tools/prep/patch-header.ts <check|retrofit>");
    process.exit(1);
  }
}
