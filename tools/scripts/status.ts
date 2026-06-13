#!/usr/bin/env bun
// `gjoa status` — single-screen operational dashboard.
//
// Answers the recurring questions: what version of Firefox are we on,
// what's Mozilla shipping, what's nixpkgs shipping, what's Zen on, are
// there unfixed CVEs against our pin, what changes are pending, what's
// my rebuild budget, what command should I run next.
//
// Every run does fresh network pulls — no caching. ~1–2 sec total
// because the fetches happen in parallel. If you're offline, missing
// values render as "—" and the rest of the dashboard still works.

import { existsSync, readFileSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dir, "..", "..");
const ENGINE_DIR = join(REPO_ROOT, "engine");
const MACH_BIN = join(ENGINE_DIR, "obj-x86_64-pc-linux-gnu", "dist", "bin", "gjoa-bin");
const MACH_DEV_OVERLAY = join(ENGINE_DIR, "obj-x86_64-pc-linux-gnu", "dist", "bin", "gjoa-dev");
const NIX_RESULT = join(REPO_ROOT, "result", "bin", "gjoa");
const DIST_CHROME = join(REPO_ROOT, "dist", "chrome");
const LEDGER = join(REPO_ROOT, "BUILD-LEDGER.md");
const GJOA_JSON = join(REPO_ROOT, "gjoa.json");

// ── ANSI helpers ────────────────────────────────────────────────────────────
const tty = process.stdout.isTTY;
const c = (s: string, code: string) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const dim = (s: string) => c(s, "2");
const bold = (s: string) => c(s, "1");
const green = (s: string) => c(s, "32");
const yellow = (s: string) => c(s, "33");
const red = (s: string) => c(s, "31");
const cyan = (s: string) => c(s, "36");
const magenta = (s: string) => c(s, "35");

// ── Version helpers ────────────────────────────────────────────────────────
function parseVer(v: string): [number, number, number] {
  const cleaned = v.replace(/esr$/i, "").replace(/[a-z].*$/, "").trim();
  const p = cleaned.split(".").map((x) => parseInt(x, 10) || 0);
  return [p[0] || 0, p[1] || 0, p[2] || 0];
}
function cmpVer(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return 0;
}
function delta(a: string | null, b: string | null): string {
  if (!a || !b) return dim("—");
  const aT = parseVer(a), bT = parseVer(b);
  const cmp = cmpVer(aT, bT);
  if (cmp === 0) return green("match");
  // a > b → we're AHEAD of the comparison target.
  if (cmp > 0) {
    if (aT[0] > bT[0]) return cyan(`+${aT[0] - bT[0]} major ahead`);
    return cyan("patch ahead");
  }
  // a < b → we're BEHIND.
  if (aT[0] < bT[0]) return red(`-${bT[0] - aT[0]} major`);
  return yellow("point behind");
}

// ── Oracles ────────────────────────────────────────────────────────────────
interface Oracles {
  mozillaLatest: string | null;
  mozillaEsr: string | null;
  mozillaNightly: string | null;
  mozillaBeta: string | null;
  nixpkgsFirefox: string | null;
  nixpkgsFirefoxEsr: string | null;
  zen: string | null;
  librewolf: string | null;
  advisoryCount: number | null;
  inTheWildCount: number | null;
  errors: string[];
}

async function fetchJson<T>(url: string, timeoutMs = 5000): Promise<T | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

async function fetchText(url: string, timeoutMs = 5000): Promise<string | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) return null;
    return await r.text();
  } catch {
    return null;
  }
}

function nixEvalRaw(expr: string): string | null {
  try {
    const out = execSync(
      `nix eval --impure --raw --expr '${expr}' 2>/dev/null`,
      { timeout: 10_000, encoding: "utf8" },
    );
    return out.trim() || null;
  } catch {
    return null;
  }
}

async function loadOracles(pinned: string): Promise<Oracles> {
  const errors: string[] = [];

  // Run all the network probes in parallel.
  const [moz, advHtml, zenSurfer, librewolfPkgbuild] = await Promise.all([
    fetchJson<{
      LATEST_FIREFOX_VERSION: string;
      FIREFOX_ESR: string;
      FIREFOX_NIGHTLY?: string;
      FIREFOX_DEVEDITION?: string;
      LATEST_FIREFOX_DEVEL_VERSION?: string;
    }>("https://product-details.mozilla.org/1.0/firefox_versions.json"),
    fetchText("https://www.mozilla.org/en-US/security/known-vulnerabilities/firefox/"),
    // Zen pins Firefox in surfer.json on the dev branch (their main branch
    // doesn't have this file — releases get merged from dev).
    fetchText("https://raw.githubusercontent.com/zen-browser/desktop/dev/surfer.json"),
    fetchText("https://gitlab.com/librewolf-community/browser/source/-/raw/main/version"),
  ]);

  if (!moz) errors.push("Mozilla product-details unreachable");
  if (!advHtml) errors.push("Mozilla advisories page unreachable");
  if (!zenSurfer) errors.push("Zen browser version probe failed");
  if (!librewolfPkgbuild) errors.push("LibreWolf version probe failed");

  // nixpkgs current Firefox — uses the same nixpkgs the flake locks to.
  const nixpkgsFirefox = nixEvalRaw(
    `(import (builtins.getFlake "git+file:///home/tom/code/gjoa").inputs.nixpkgs { system = "x86_64-linux"; }).firefox-unwrapped.version`,
  );
  const nixpkgsFirefoxEsr = nixEvalRaw(
    `(import (builtins.getFlake "git+file:///home/tom/code/gjoa").inputs.nixpkgs { system = "x86_64-linux"; }).firefox-esr-unwrapped.version`,
  );

  // Parse Zen's pinned version out of surfer.json.
  let zen: string | null = null;
  if (zenSurfer) {
    try {
      const j = JSON.parse(zenSurfer) as { version?: { version?: string } };
      zen = j.version?.version ?? null;
    } catch {
      errors.push("Zen surfer.json parse failed");
    }
  }

  // LibreWolf's version file is plain text.
  const librewolf = librewolfPkgbuild?.trim().split("\n")[0]?.split("-")[0] ?? null;

  // Count advisories newer than our pin from the known-vulns page.
  let advisoryCount: number | null = null;
  let inTheWildCount: number | null = null;
  if (advHtml) {
    advisoryCount = 0;
    inTheWildCount = 0;
    const sectionRe =
      /<h3 id="firefox([0-9.]+(?:esr)?)"[^>]*>[\s\S]*?Fixed in Firefox ([0-9.]+(?:esr)?)\s*<\/a>\s*<\/h3>([\s\S]*?)(?=<h3 id="firefox|<\/main|<footer|$)/g;
    const advRe =
      /<a href="(\/en-US\/security\/advisories\/mfsa\d{4}-\d+\/?)"[^>]*>\s*<span class="level ([a-z]+)">/g;
    const pinTuple = parseVer(pinned);
    let sm: RegExpExecArray | null;
    while ((sm = sectionRe.exec(advHtml)) !== null) {
      const v = sm[2]!;
      if (v.endsWith("esr")) continue;
      const vt = parseVer(v);
      if (cmpVer(vt, pinTuple) <= 0) continue; // only count fixes newer than us
      const body = sm[3]!;
      advRe.lastIndex = 0;
      let am: RegExpExecArray | null;
      while ((am = advRe.exec(body)) !== null) {
        advisoryCount++;
        if (am[2] === "critical") inTheWildCount++;
      }
    }
  }

  return {
    mozillaLatest: moz?.LATEST_FIREFOX_VERSION ?? null,
    mozillaEsr: moz?.FIREFOX_ESR ?? null,
    mozillaNightly: moz?.FIREFOX_NIGHTLY ?? null,
    mozillaBeta: moz?.LATEST_FIREFOX_DEVEL_VERSION ?? moz?.FIREFOX_DEVEDITION ?? null,
    nixpkgsFirefox,
    nixpkgsFirefoxEsr,
    zen,
    librewolf,
    advisoryCount,
    inTheWildCount,
    errors,
  };
}

// ── Local state ────────────────────────────────────────────────────────────
function mtime(p: string): Date | null {
  try { return statSync(p).mtime; } catch { return null; }
}
function fmtAge(d: Date): string {
  // Nix store paths use the 1970 epoch for reproducibility — meaningless
  // as a "how old is the build" signal. Detect and short-circuit.
  if (d.getFullYear() <= 1970) return "nix-built";
  const ms = Date.now() - d.getTime();
  const min = ms / 60000;
  if (min < 1) return "just now";
  if (min < 60) return `${Math.round(min)} min ago`;
  if (min < 60 * 24) return `${Math.round(min / 60)} hr ago`;
  return `${Math.round(min / 60 / 24)} d ago`;
}

function gitStatusByLane(): { lane1: string[]; lane2: string[]; lane3: string[]; other: string[] } {
  const lane1: string[] = []; const lane2: string[] = []; const lane3: string[] = []; const other: string[] = [];
  let raw = "";
  try { raw = execSync("git status --porcelain", { cwd: REPO_ROOT, encoding: "utf8" }); } catch { return { lane1, lane2, lane3, other }; }
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const file = line.slice(3).trim();
    if (file.startsWith("src/gjoa/chrome/")) lane1.push(file);
    else if (file.startsWith("src/gjoa/browser/")) lane2.push(file);
    else if (file.startsWith("patches/")) lane2.push(file);
    else if (file.startsWith("configs/branding/")) lane2.push(file);
    else if (file === "gjoa.json") lane3.push(file);
    else if (file === "flake.nix" || file === "flake.lock") lane3.push(file);
    else other.push(file);
  }
  return { lane1, lane2, lane3, other };
}

function ledgerEntries(): { date: string; type: string; reason: string; outcome: string }[] {
  if (!existsSync(LEDGER)) return [];
  const text = readFileSync(LEDGER, "utf8");
  const rows: { date: string; type: string; reason: string; outcome: string }[] = [];
  for (const line of text.split("\n")) {
    const m = line.match(/^\|\s*(\d{4}-\d{2}-\d{2})\s*\|\s*(\w+)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|/);
    if (m) rows.push({ date: m[1]!, type: m[2]!, reason: m[3]!.trim(), outcome: m[4]!.trim() });
  }
  return rows;
}

function buildsThisWeek(entries: ReturnType<typeof ledgerEntries>): number {
  const sevenAgo = new Date(Date.now() - 7 * 86400_000);
  return entries.filter((e) => {
    const d = new Date(e.date);
    return !isNaN(d.getTime()) && d >= sevenAgo && (e.type === "nix" || e.type === "mach-full");
  }).length;
}

function nextSunday(): string {
  const now = new Date();
  const days = (7 - now.getDay()) % 7 || 7; // 0=Sun → next Sunday = 7
  const d = new Date(now.getTime() + days * 86400_000);
  const iso = d.toISOString().slice(0, 10);
  return `${iso} (in ${days} day${days === 1 ? "" : "s"})`;
}

// ── Rendering ──────────────────────────────────────────────────────────────
function section(title: string): void {
  console.log("");
  console.log(bold(`▸ ${title}`));
}

function row(label: string, value: string): void {
  console.log(`  ${label.padEnd(22)} ${value}`);
}

async function main(): Promise<void> {
  const jsonMode = process.argv.includes("--json");

  const gjoa = JSON.parse(readFileSync(GJOA_JSON, "utf8")) as { firefox: { version: string } };
  const pinned = gjoa.firefox.version;

  process.stderr.write(dim("probing oracles…\r"));
  const oracles = await loadOracles(pinned);
  process.stderr.write("                  \r");

  if (jsonMode) {
    console.log(JSON.stringify({ pinned, oracles }, null, 2));
    return;
  }

  const hasMach = existsSync(MACH_BIN);
  const hasNix = existsSync(NIX_RESULT);
  const hasDist = existsSync(DIST_CHROME);
  const hasDevOverlay = existsSync(MACH_DEV_OVERLAY);

  const lanes = gitStatusByLane();
  const ledger = ledgerEntries();
  const buildsWeek = buildsThisWeek(ledger);

  // Overall threat color.
  const critical = (oracles.inTheWildCount ?? 0) > 0
    || (oracles.mozillaLatest && parseVer(pinned)[0] < parseVer(oracles.mozillaLatest)[0] - 1);
  const stale = !critical && oracles.mozillaLatest && cmpVer(parseVer(pinned), parseVer(oracles.mozillaLatest)) < 0;
  const threat = critical ? red("CRITICAL") : stale ? yellow("STALE") : green("OK");

  console.log(bold(`gjoa // status`) + "  " + dim(new Date().toISOString().slice(0, 19).replace("T", " ")) + "  " + threat);

  section("VERSION POSITION");
  row("our pin",         bold(pinned));
  row("Mozilla stable",  `${oracles.mozillaLatest ?? dim("—")}  ${delta(pinned, oracles.mozillaLatest)}`);
  row("Mozilla ESR",     oracles.mozillaEsr ?? dim("—"));
  row("Mozilla beta",    oracles.mozillaBeta ?? dim("—"));
  row("Mozilla nightly", oracles.mozillaNightly ?? dim("—"));
  row("nixpkgs firefox", `${oracles.nixpkgsFirefox ?? dim("—")}  ${delta(pinned, oracles.nixpkgsFirefox)}`);
  row("nixpkgs ESR",     oracles.nixpkgsFirefoxEsr ?? dim("—"));
  row("Zen browser",     `${oracles.zen ?? dim("—")}  ${delta(pinned, oracles.zen)}`);
  row("LibreWolf",       `${oracles.librewolf ?? dim("—")}  ${delta(pinned, oracles.librewolf)}`);

  section("SECURITY POSTURE");
  if (oracles.advisoryCount === null) {
    row("advisories",         dim("offline — could not fetch"));
  } else if (oracles.advisoryCount === 0) {
    row("unfixed CVEs",       green("0"));
    row("in-the-wild",        green("0"));
  } else {
    const sevColor = (oracles.inTheWildCount ?? 0) > 0 ? red : yellow;
    row("unfixed CVEs",       sevColor(String(oracles.advisoryCount)));
    row("in-the-wild",        sevColor(String(oracles.inTheWildCount ?? 0)));
  }

  section("BUILD STATE");
  row("are we using nixpkgs?", dim("no — we feed buildMozillaMach our own patched source"));
  row("nix binary",      hasNix ? `${green("✓")}  ${dim(`${mtime(NIX_RESULT) ? fmtAge(mtime(NIX_RESULT)!) : "?"}`)}` : dim("·  not built"));
  row("mach binary",     hasMach ? `${green("✓")}  ${dim(`${mtime(MACH_BIN) ? fmtAge(mtime(MACH_BIN)!) : "?"}`)}` : dim("·  not built"));
  row("dist/chrome",     hasDist ? `${green("✓")}  ${dim(`${mtime(DIST_CHROME) ? fmtAge(mtime(DIST_CHROME)!) : "?"}`)}` : dim("·  stale, run `bun run chrome:dist`"));
  row("dev-mode overlay", hasDevOverlay ? green("✓") : dim("·  gjoa-dev/ not symlinked yet"));

  section("REBUILD BUDGET");
  const budgetColor = buildsWeek > 1 ? red : buildsWeek === 1 ? yellow : green;
  row("builds this week", `${budgetColor(`${buildsWeek}`)} / 1 (Rule #0)`);
  row("next Sunday",      nextSunday());
  if (ledger.length > 0) {
    const last = ledger[0]!;
    row("last logged",     `${last.date} (${last.type}) — ${last.outcome}`);
  }

  section("WORKING TREE");
  console.log("  " + dim("Lane 1: chrome TS/CSS — `gjoa sync` + restart, ~1s, no rebuild"));
  console.log("  " + dim("Lane 2: Firefox .sys.mjs / patches / branding — `bun run import && ./mach build faster`, ~30s"));
  console.log("  " + dim("Lane 3: gjoa.json (version) / flake.nix / C++/Rust — full mach or nix build, 30-60 min"));
  console.log("");
  if (lanes.lane1.length) row(green("Lane 1"), String(lanes.lane1.length) + " file" + (lanes.lane1.length === 1 ? "" : "s"));
  if (lanes.lane2.length) row(yellow("Lane 2"), String(lanes.lane2.length) + " file" + (lanes.lane2.length === 1 ? "" : "s"));
  if (lanes.lane3.length) row(red("Lane 3"), String(lanes.lane3.length) + " file" + (lanes.lane3.length === 1 ? "" : "s"));
  if (lanes.other.length) row(dim("other"), dim(String(lanes.other.length) + " files (docs/config/test, no rebuild)"));
  if (!lanes.lane1.length && !lanes.lane2.length && !lanes.lane3.length && !lanes.other.length) row("(clean tree)", "");

  section("RECOMMENDED NEXT");
  const rec: string[] = [];
  if (lanes.lane3.length) {
    rec.push(red("Lane 3 changes pending. Wait for Sunday. Confirm rebuild with Claude."));
  } else if (lanes.lane2.length) {
    if (!hasMach) {
      rec.push(yellow("Lane 2 changes pending but no mach binary."));
      rec.push("  nix develop .#mach  &&  cd engine && ./mach build   " + dim("(~30–60 min cold; do on Sunday)"));
    } else {
      rec.push(yellow("Lane 2 changes pending."));
      rec.push("  bun run import  &&  (cd engine && ./mach build faster)  &&  gjoa dev");
    }
  } else if (lanes.lane1.length) {
    rec.push(green("Lane 1 only."));
    rec.push("  gjoa sync  &&  " + (hasMach ? "gjoa dev" : "gjoa") + dim(`  (${hasMach ? "mach" : "nix"} binary)`));
  } else {
    rec.push(green("Clean. Launch with `gjoa` or `gjoa dev`."));
  }
  for (const line of rec) console.log("  " + line);

  if (oracles.errors.length > 0) {
    console.log("");
    console.log(dim("oracles offline: " + oracles.errors.join(", ")));
  }

  console.log("");
  console.log(dim("docs/ARCHITECTURE.md  ·  CLAUDE.md Rule #0  ·  BUILD-LEDGER.md"));
}

if (import.meta.main) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
