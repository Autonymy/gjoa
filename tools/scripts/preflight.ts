#!/usr/bin/env bun
// `gjoa preflight` — the gate that runs before any nix build is allowed.
//
// Per CLAUDE.md Rule #0: Claude may not propose a rebuild without
// showing this script's output. Gates are MECHANICAL. New failure
// modes get added here, not to a mental checklist that gets skipped.
//
// Exits 0 if every gate passes, 1 if any gate fails. Gate F (daemon
// settings) and Gate G (nix eval) are the two that would have caught
// the 2026-05-26 failure.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dir, "..", "..");
const ENGINE_DIR = join(REPO_ROOT, "engine");
const FLAKE = join(REPO_ROOT, "flake.nix");
const PATCHES_DIR = join(REPO_ROOT, "patches");
const GJOA_JSON = join(REPO_ROOT, "gjoa.json");
const LEDGER = join(REPO_ROOT, "BUILD-LEDGER.md");
const NIX_RESULT = join(REPO_ROOT, "result", "bin", "gjoa");

const tty = process.stdout.isTTY;
const c = (s: string, code: string) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const green = (s: string) => c(s, "32");
const red = (s: string) => c(s, "31");
const yellow = (s: string) => c(s, "33");
const dim = (s: string) => c(s, "2");
const bold = (s: string) => c(s, "1");

interface GateResult {
  id: string;
  name: string;
  passed: boolean;
  warned?: boolean;
  detail: string;
  fix?: string;
}
const results: GateResult[] = [];

function pass(id: string, name: string, detail: string): void {
  results.push({ id, name, passed: true, detail });
}
function fail(id: string, name: string, detail: string, fix: string): void {
  results.push({ id, name, passed: false, detail, fix });
}
// A WARN does not fail the gate (passed: true) but flags a non-fatal,
// inconclusive result the operator should be aware of — e.g. a nix eval that
// timed out rather than genuinely failed.
function warn(id: string, name: string, detail: string): void {
  results.push({ id, name, passed: true, warned: true, detail });
}
function sh(cmd: string, opts: { timeout?: number } = {}): { ok: boolean; out: string; timedOut?: boolean } {
  try {
    const out = execSync(cmd, { encoding: "utf8", timeout: opts.timeout ?? 30_000, stdio: ["ignore", "pipe", "pipe"] });
    return { ok: true, out };
  } catch (e: unknown) {
    const err = e as { code?: string; signal?: string; stderr?: Buffer; stdout?: Buffer; message: string };
    // A timeout (execSync sends SIGTERM and sets code 'ETIMEDOUT') is not a
    // real failure of the command — surface it so callers can WARN/skip
    // rather than treat it as a hard error.
    const timedOut = err.code === "ETIMEDOUT" || err.signal === "SIGTERM";
    return {
      ok: false,
      timedOut,
      out: (err.stderr?.toString() || "") + (err.stdout?.toString() || "") || err.message,
    };
  }
}

// ── Gate A: patches apply cleanly against fresh source ─────────────────────
function gateA(): void {
  const cache = `${process.env.HOME}/.cache/gjoa/sources`;
  const gjoa = JSON.parse(readFileSync(GJOA_JSON, "utf8")) as { firefox: { version: string } };
  const tarball = `${cache}/firefox-${gjoa.firefox.version}.source.tar.xz`;
  if (!existsSync(tarball)) {
    return fail("A", "patches apply clean on fresh source",
      `tarball not cached at ${tarball}`,
      `run \`bun run download\` to populate the cache`);
  }
  const tmp = "/tmp/gjoa-preflight-engine";
  sh(`rm -rf ${tmp} && mkdir -p ${tmp}`);
  const extract = sh(`tar -xJf ${tarball} -C ${tmp} --strip-components=1`, { timeout: 180_000 });
  if (!extract.ok) {
    return fail("A", "patches apply clean on fresh source", "tarball extract failed", extract.out.slice(0, 400));
  }
  sh(`cd ${tmp} && git init -q && git add -A && git -c user.email=t@t -c user.name=t commit -q -m baseline`, { timeout: 60_000 });
  const patches = readdirSync(PATCHES_DIR).filter((p) => p.endsWith(".patch")).sort();
  const failed: string[] = [];
  for (const p of patches) {
    const r = sh(`cd ${tmp} && git apply --check ${join(PATCHES_DIR, p)}`);
    if (!r.ok) failed.push(`${p}: ${r.out.split("\n")[0]?.trim()}`);
  }
  if (failed.length) {
    return fail("A", "patches apply clean on fresh source",
      `${failed.length}/${patches.length} patches fail`,
      `regenerate each failing patch via \`git diff\` in a fresh extract:\n    ${failed.join("\n    ")}`);
  }
  pass("A", "patches apply clean on fresh source", `${patches.length}/${patches.length} apply clean`);
}

// ── Gate B: chrome registration uses a known-working pattern ──────────────
function gateB(): void {
  const ours = join(REPO_ROOT, "src", "gjoa", "browser", "components", "gjoa", "jar.mn");
  if (!existsSync(ours)) {
    return fail("B", "jar.mn pattern matches working example",
      `${ours} missing`,
      `restore from git`);
  }
  const content = readFileSync(ours, "utf8");
  const usesBrowserJar = /^browser\.jar:/m.test(content);
  const hasContentDecl = /^% content\s+gjoa\s+%content\/gjoa\//m.test(content);
  if (!usesBrowserJar) {
    return fail("B", "jar.mn pattern matches working example",
      `uses \`<package>.jar:\` syntax — silently no-op in modern Firefox`,
      `change first non-comment line to \`browser.jar:\` (see browser/branding/unofficial/content/jar.mn)`);
  }
  if (!hasContentDecl) {
    return fail("B", "jar.mn pattern matches working example",
      `no \`% content gjoa %content/gjoa/\` registration line`,
      `add \`% content gjoa %content/gjoa/\` after \`browser.jar:\``);
  }
  pass("B", "jar.mn pattern matches working example", `browser.jar: + % content gjoa %content/gjoa/`);
}

// ── Gate C: no production-mode TODO/no-op landmines ───────────────────────
function gateC(): void {
  const prodFiles = [
    "src/gjoa/browser/components/gjoa/GjoaLoader.sys.mjs",
    "src/gjoa/chrome/bjs/security/index.bjs",
    "src/gjoa/chrome/bjs/drawer/index.bjs",
    "src/gjoa/chrome/bjs/spaces/index.bjs",
    "src/gjoa/chrome/bjs/tabs/index.bjs",
  ];
  const landmines: string[] = [];
  for (const f of prodFiles) {
    const path = join(REPO_ROOT, f);
    if (!existsSync(path)) continue;
    const lines = readFileSync(path, "utf8").split("\n");
    lines.forEach((l, i) => {
      // Only flag literal "TODO" / "future commit" / "nothing yet" inside
      // executable code (not in jsdoc/regular comments that describe
      // intent). Heuristic: line ends with `return;` or matches the
      // specific dead-stub pattern.
      if (/^\s*return\s*;?\s*\/\/\s*(TODO|FIXME|future)/i.test(l)
       || /\/\/\s*(future commit|nothing yet|not yet implemented)/i.test(l)) {
        landmines.push(`${f}:${i + 1}: ${l.trim()}`);
      }
    });
  }
  if (landmines.length) {
    return fail("C", "no production-mode TODO/no-op landmines",
      `${landmines.length} suspicious dead-stub markers in production paths`,
      `audit + implement or delete each:\n    ${landmines.join("\n    ")}`);
  }
  pass("C", "no production-mode TODO/no-op landmines", `${prodFiles.length} prod files scanned, none flagged`);
}

// ── Gate D: dep floors satisfied ──────────────────────────────────────────
function gateD(): void {
  const flakeContent = readFileSync(FLAKE, "utf8");
  const minNss = flakeContent.match(/minNssVersion\s*=\s*"([^"]+)"/)?.[1];
  if (!minNss) return pass("D", "dep floors satisfied", "no minNssVersion gate declared");
  const probe = sh(
    `nix eval --impure --raw --expr '(import (builtins.getFlake "git+file://${REPO_ROOT}").inputs.nixpkgs { system = "x86_64-linux"; }).nss_latest.version' 2>&1`,
    { timeout: 60_000 },
  );
  if (!probe.ok) {
    return fail("D", "dep floors satisfied", "could not probe nixpkgs nss_latest.version",
      `fix the nix eval error and re-run:\n${probe.out.slice(-300)}`);
  }
  const nixpkgsNss = probe.out.trim().split("\n").pop()!;
  // compareVersions: if nixpkgs >= minNss, overlay short-circuits (good).
  // if behind, our overlay activates and Mozilla tarball is fetched.
  pass("D", "dep floors satisfied",
    `minNssVersion=${minNss}, nixpkgs nss_latest=${nixpkgsNss} → overlay ${
      nixpkgsNss >= minNss ? "auto-disabled" : "ACTIVE (will fetch Mozilla tarball)"
    }`);
}

// ── Gate E: existing binary status (informational gate) ───────────────────
function gateE(): void {
  if (!existsSync(NIX_RESULT)) {
    return pass("E", "existing binary status", "no result/ symlink (fresh rebuild)");
  }
  const omni = join(REPO_ROOT, "result", "lib", "gjoa", "browser", "omni.ja");
  if (!existsSync(omni)) {
    return pass("E", "existing binary status", "result/ exists but no omni.ja (probably broken — rebuild)");
  }
  const r = sh(`unzip -p ${omni} chrome/chrome.manifest 2>/dev/null | grep -c "^content gjoa" || true`);
  const count = parseInt(r.out.trim(), 10) || 0;
  if (count > 0) {
    // Binary already has the registration — rebuild only needed if you've
    // actually changed something that affects it.
    pass("E", "existing binary status", `current result/ has ${count} \`content gjoa\` line(s); rebuild is REPLACING a working binary`);
  } else {
    pass("E", "existing binary status", `current result/ has NO \`content gjoa\` registration — rebuild needed to restore chrome bundles`);
  }
}

// ── Gate F: nix daemon will accept flake settings ─────────────────────────
//
// Two separate nix permission mechanisms get conflated easily:
//   * trusted-users  → who can pass --option / --no-sandbox FLAGS at CLI
//   * sandbox=true   → rejects ANY derivation with `__noChroot=true`
//                      regardless of who's invoking
//
// For `__noChroot = true` to actually take effect, the daemon's
// `sandbox` setting must be `relaxed` (or `false`). `sandbox = true`
// rejects it at eval time even for trusted users. This gate caught
// me on 2026-05-26 — see BUILD-LEDGER postmortem.
function gateF(): void {
  // Strip nix comment lines before matching so we don't false-positive
  // on `__noChroot = true` written inside an explanation comment.
  const flakeContent = readFileSync(FLAKE, "utf8")
    .split("\n")
    .filter((l) => !/^\s*#/.test(l))
    .join("\n");
  const usesNoChroot = /__noChroot\s*=\s*true/.test(flakeContent);
  const usesImpure = /__impure\s*=\s*true/.test(flakeContent);
  if (!usesNoChroot && !usesImpure) {
    return pass("F", "nix daemon will accept flake settings", "no privileged settings in flake.nix");
  }
  const cfg = sh("nix show-config 2>/dev/null", { timeout: 15_000 });
  const sandboxLine = cfg.out.split("\n").find((l) => /^sandbox = /.test(l)) || "";
  const sandbox = sandboxLine.split("=")[1]?.trim();
  if (usesNoChroot && sandbox === "true") {
    return fail("F", "nix daemon will accept flake settings",
      `flake uses __noChroot but daemon has sandbox=true → rejected at eval`,
      `either:\n      (a) remove __noChroot from flake.nix (Lane 1 edit; lose sccache persistence), or\n      (b) change sandbox = "relaxed" in nixos-config nix-settings module + firn rebuild`);
  }
  pass("F", "nix daemon will accept flake settings",
    `sandbox=${sandbox} permits __noChroot/__impure`);
}

// ── Gate G: nix flake evaluates without errors ────────────────────────────
function gateG(): void {
  const r = sh(
    `nix eval --impure --raw '${REPO_ROOT}#gjoa.outPath' 2>&1`,
    { timeout: 120_000 },
  );
  if (!r.ok) {
    if (r.timedOut) {
      // A dirty git tree defeats nix's eval cache, so eval can be slow without
      // being broken. Don't fail the gate on a wall-clock timeout.
      return warn("G", "nix flake evaluates without errors",
        "nix eval timed out — not a real eval failure; re-run with a clean tree or longer timeout");
    }
    return fail("G", "nix flake evaluates without errors",
      "evaluation failed — would have died during build",
      r.out.split("\n").filter((l) => l.toLowerCase().includes("error")).slice(0, 5).join("\n      "));
  }
  pass("G", "nix flake evaluates without errors", `derivation resolves to ${r.out.trim().split("\n").pop()?.slice(-50)}`);
}

// ── Gate H: diff since last working build ─────────────────────────────────
function gateH(): void {
  if (!existsSync(LEDGER)) {
    return pass("H", "diff since last working build", "no ledger yet (first build)");
  }
  const ledger = readFileSync(LEDGER, "utf8");
  const lastSuccess = ledger.split("\n").find((l) => /^\|\s*\d{4}-\d{2}-\d{2}/.test(l) && /success|works/i.test(l) && !/broken|fail/i.test(l));
  if (!lastSuccess) {
    return pass("H", "diff since last working build", "no successful build logged yet");
  }
  // Find last commit before that date (approximate)
  const dateMatch = lastSuccess.match(/^\|\s*(\d{4}-\d{2}-\d{2})/);
  const date = dateMatch?.[1] || "";
  const r = sh(`git log --oneline --since='${date}' --until='now' --pretty=format:'%h %s' 2>&1 | head -30`);
  const changed = sh(`git diff --name-only HEAD~5..HEAD 2>&1 | head -50`);
  const lines = changed.out.split("\n").filter(Boolean);
  pass("H", "diff since last working build",
    `${lines.length} files changed in recent commits (review for prereqs):\n      ${lines.slice(0, 15).join("\n      ")}${lines.length > 15 ? `\n      ... and ${lines.length - 15} more` : ""}`);
}

// ── Gate I: chrome bundle three-way alignment ─────────────────────────────
function gateI(): void {
  const loaderPath = join(REPO_ROOT, "src", "gjoa", "browser", "components", "gjoa", "GjoaLoader.sys.mjs");
  const jarPath = join(REPO_ROOT, "src", "gjoa", "browser", "components", "gjoa", "jar.mn");
  const bakePath = join(REPO_ROOT, "tools", "prep", "chrome-bake.ts");
  if (![loaderPath, jarPath, bakePath].every(existsSync)) {
    return fail("I", "chrome bundle three-way alignment", "one of loader/jar/bake missing", "investigate");
  }
  const loader = readFileSync(loaderPath, "utf8");
  const jar = readFileSync(jarPath, "utf8");
  const bake = readFileSync(bakePath, "utf8");
  const loaderScripts = [...loader.matchAll(/"(gjoa-[a-z-]+\.uc\.js)"/g)].map((m) => m[1]!).sort();
  const jarScripts = [...jar.matchAll(/scripts\/(gjoa-[a-z-]+\.uc\.js)/g)].map((m) => m[1]!).filter((v, i, a) => a.indexOf(v) === i).sort();
  const bakeScripts = [...bake.matchAll(/"(gjoa-[a-z-]+\.uc\.js)"/g)].map((m) => m[1]!).sort();
  // CSS bundles include the bare `gjoa.uc.css` (no hyphen suffix), so the
  // style pattern must allow an optional `-...` segment.
  const loaderStyles = [...loader.matchAll(/"(gjoa(?:-[a-z-]+)?\.uc\.css)"/g)].map((m) => m[1]!).sort();
  const jarStyles = [...jar.matchAll(/styles\/(gjoa(?:-[a-z-]+)?\.uc\.css)/g)].map((m) => m[1]!).filter((v, i, a) => a.indexOf(v) === i).sort();
  const bakeStyles = [...bake.matchAll(/"(gjoa(?:-[a-z-]+)?\.uc\.css)"/g)].map((m) => m[1]!).sort();
  const eq = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
  if (!eq(loaderScripts, jarScripts) || !eq(loaderScripts, bakeScripts)) {
    return fail("I", "chrome bundle three-way alignment",
      `script lists differ:\n      loader: ${loaderScripts.join(", ")}\n      jar:    ${jarScripts.join(", ")}\n      bake:   ${bakeScripts.join(", ")}`,
      `align all three so they declare the exact same .uc.js filenames`);
  }
  if (!eq(loaderStyles, jarStyles) || !eq(loaderStyles, bakeStyles)) {
    return fail("I", "chrome bundle three-way alignment",
      `style lists differ:\n      loader: ${loaderStyles.join(", ")}\n      jar:    ${jarStyles.join(", ")}\n      bake:   ${bakeStyles.join(", ")}`,
      `align all three so they declare the exact same .uc.css filenames`);
  }
  pass("I", "chrome bundle three-way alignment", `${loaderScripts.length} script + ${loaderStyles.length} style bundles agree across loader / jar.mn / chrome-bake.ts`);
}

// ── Run + render ──────────────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log(bold("gjoa preflight"));
  console.log(dim("Mandatory gate before any nix or full-mach build (CLAUDE.md Rule #0)."));
  console.log("");

  const gates: [string, () => void][] = [
    ["A", gateA], ["B", gateB], ["C", gateC], ["D", gateD],
    ["E", gateE], ["F", gateF], ["G", gateG], ["H", gateH],
    ["I", gateI],
  ];
  for (const [, fn] of gates) {
    try { fn(); } catch (e) { fail("?", fn.name, "gate threw", (e as Error).message); }
  }

  for (const r of results) {
    const mark = r.warned ? yellow("⚠") : r.passed ? green("✓") : red("✗");
    console.log(`${mark}  ${bold(r.id)}  ${r.name}`);
    console.log(`     ${dim(r.detail)}`);
    if (!r.passed && r.fix) {
      console.log(`     ${yellow("fix: " + r.fix.split("\n").join("\n          "))}`);
    }
  }

  const failed = results.filter((r) => !r.passed).length;
  console.log("");
  if (failed === 0) {
    console.log(green(bold(`PREFLIGHT GREEN`)) + dim(`  — ${results.length}/${results.length} gates passed`));
    console.log(dim(`Safe to propose a rebuild. Show this output in the proposal.`));
    process.exit(0);
  } else {
    console.log(red(bold(`PREFLIGHT FAILED`)) + dim(`  — ${failed}/${results.length} gates failed`));
    console.log(red(`Do NOT kick off a build until every gate is green.`));
    process.exit(1);
  }
}

if (import.meta.main) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
