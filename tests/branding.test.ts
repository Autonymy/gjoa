// Regression test for tools/prep/branding.ts.
//
// Ensures Zen-browser-isms (and other upstream-template artifacts that
// would leak proprietary URLs into our build) never appear in the
// generated branding tree. This is the test that would have caught the
// surfer leak we discovered.
//
// Runs only if `engine/browser/branding/skiff/` exists — i.e. only after
// `bun run init`. CI can either run init first OR skip these tests in
// environments without network/disk for a full mozilla-central download.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { loadConfig } from "../tools/prep/config";
import { ENGINE_BRANDING_DIR } from "../tools/prep/paths";

const cfg = loadConfig();
const BRANDING_OUT = join(ENGINE_BRANDING_DIR, cfg.binaryName);
const HAS_ENGINE = existsSync(BRANDING_OUT);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}

const TEXT_EXT = /\.(js|dtd|ftl|properties|sh|nsi|xml|css|json|mn|svg|html|txt|md)$/i;
function isText(path: string): boolean {
  const base = path.split("/").pop() ?? "";
  if (["moz.build", "configure.sh", "branding.nsi", "jar.mn"].includes(base)) return true;
  return TEXT_EXT.test(path);
}

describe.skipIf(!HAS_ENGINE)("branding regression", () => {
  const allText = HAS_ENGINE
    ? walk(BRANDING_OUT).filter(isText).map((p) => ({ path: p, text: readFileSync(p, "utf8") }))
    : [];

  test("no zen-browser.app references anywhere in generated branding", () => {
    const hits = allText.filter(({ text }) => text.includes("zen-browser.app"));
    expect(hits.map((h) => h.path)).toEqual([]);
  });

  test("no nightly.mozilla.org references (we replaced these in skiff.json)", () => {
    const hits = allText.filter(({ text }) => text.includes("nightly.mozilla.org"));
    expect(hits.map((h) => h.path)).toEqual([]);
  });

  test("no Nightly brand string left over", () => {
    // Brand short/shorter/full names should all be substituted out.
    const ftl = allText.find((f) => f.path.endsWith("brand.ftl"));
    expect(ftl).toBeDefined();
    expect(ftl!.text).not.toMatch(/= Nightly/);
    expect(ftl!.text).toMatch(new RegExp(`= ${cfg.branding.shortName}`));
  });

  test("welcome URL pref is empty (no auto-opened first-run tabs)", () => {
    const branding = allText.find((f) => f.path.endsWith("firefox-branding.js"));
    expect(branding).toBeDefined();
    expect(branding!.text).toMatch(
      /pref\("startup\.homepage_welcome_url",\s*""\);/,
    );
  });

  test("update URLs point to skiff.json's configured target", () => {
    const branding = allText.find((f) => f.path.endsWith("firefox-branding.js"));
    expect(branding).toBeDefined();
    expect(branding!.text).toContain(cfg.urls.updateManual);
  });

  test("configure.sh display name matches skiff.json", () => {
    const cfgsh = allText.find((f) => f.path.endsWith("configure.sh"));
    expect(cfgsh).toBeDefined();
    expect(cfgsh!.text).toContain(`MOZ_APP_DISPLAYNAME=${cfg.branding.displayName}`);
  });
});
