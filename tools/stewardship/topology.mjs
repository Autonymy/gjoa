#!/usr/bin/env bun
// Stewardship topology generator + drift/rot gate. Makes the manifesto's own rule
// mechanical: docs/stewardship/ names real machinery, and that machinery is
// documented — "if a name here stops resolving, that is a bug" becomes a GATE.
//
//   bun run stewardship:gen     write docs/stewardship/topology.md (the generated map)
//   bun run stewardship:check   regen→memory, diff committed, fail on drift OR dangling refs
//
// Projection of: tools/scripts/preflight.bjs (the A–S gate registry) +
// docs/stewardship/*.md (every gate/file/script they cite) + package.json scripts.
// A hand-list would rot; this is generated + gated, like Gate P / security-patches.json.

import { existsSync, readFileSync, writeFileSync, readdirSync } from "fs";
import { join } from "path";

const REPO = process.cwd();
const PREFLIGHT = join(REPO, "tools", "scripts", "preflight.bjs");
const STEW_DIR = join(REPO, "docs", "stewardship");
const OUT = join(STEW_DIR, "topology.md");
const PKG = join(REPO, "package.json");
const REPO_TOPDIRS = ["src/", "tools/", "configs/", "docs/", "patches/", "bin/", "tests/", "metrics/"];

// --- parse the preflight gate registry --------------------------------------
function gateRegistry() {
  const src = readFileSync(PREFLIGHT, "utf8");
  const ids = [...src.matchAll(/\["([A-Z])"\s+gate[A-Z]!?\]/g)].map((m) => m[1]);
  const reg = new Map(ids.map((id) => [id, { id, name: id, hard: false }]));
  // names + hard/soft from (pass|warn|fail "X" "name" ...) calls; fail => hard gate
  for (const m of src.matchAll(/\((pass|warn|fail)\s+"([A-Z])"\s+"([^"]+)"/g)) {
    const [, kind, id, name] = m;
    if (!reg.has(id)) continue;
    reg.get(id).name = name;
    if (kind === "fail") reg.get(id).hard = true;
  }
  return reg;
}

// --- scan the stewardship docs for every reference --------------------------
function scanDocs() {
  const docs = readdirSync(STEW_DIR).filter((f) => f.endsWith(".md") && f !== "topology.md");
  const gateRefs = new Map(); // gateId -> Set(domain doc)
  const fileRefs = new Set();
  const scriptRefs = new Set();
  for (const f of docs) {
    const domain = f.replace(/\.md$/, "");
    const text = readFileSync(join(STEW_DIR, f), "utf8").replace(/\*\*/g, "");
    for (const m of text.matchAll(/Gates?\s+([A-Z](?:\s*\/\s*[A-Z])*)/g)) {
      for (const id of m[1].split("/").map((s) => s.trim())) {
        if (!gateRefs.has(id)) gateRefs.set(id, new Set());
        gateRefs.get(id).add(domain);
      }
    }
    for (const m of text.matchAll(/`([\w./-]+\.(?:bjs|mjs|js|json|md|ts|patch|edn|sh))`/g)) fileRefs.add(m[1]);
    for (const m of text.matchAll(/`(bun run\s+([\w:.-]+)|[\w./-]+\/)`/g)) {
      if (m[2]) scriptRefs.add(m[2]); else fileRefs.add(m[1].replace(/`/g, ""));
    }
    for (const m of text.matchAll(/bun run\s+([\w:.-]+)/g)) scriptRefs.add(m[1]);
  }
  return { domains: docs.map((f) => f.replace(/\.md$/, "")), gateRefs, fileRefs, scriptRefs };
}

// Only validate FULL repo paths (a top-dir prefix + a slash, no elision). Bare
// filenames cited in prose, relative sibling-doc links, and `...`-elided paths
// are legitimate and not checkable as repo-root paths.
const looksRepoLocal = (p) =>
  p.includes("/") && !p.includes("...") && REPO_TOPDIRS.some((d) => p.startsWith(d));

function analyze() {
  const reg = gateRegistry();
  const { domains, gateRefs, fileRefs, scriptRefs } = scanDocs();
  const scripts = new Set(Object.keys(JSON.parse(readFileSync(PKG, "utf8")).scripts || {}));

  const danglingGates = [...gateRefs.keys()].filter((id) => !reg.has(id));
  const danglingFiles = [...fileRefs].filter((p) => looksRepoLocal(p) && !existsSync(join(REPO, p)));
  const danglingScripts = [...scriptRefs].filter((s) => !scripts.has(s));
  const orphanGates = [...reg.keys()].filter((id) => !gateRefs.has(id)); // gate exists, no doc cites it
  return { reg, domains, gateRefs, fileRefs, scriptRefs, danglingGates, danglingFiles, danglingScripts, orphanGates };
}

function emit(a) {
  const L = [];
  L.push("# Stewardship topology (GENERATED — do not edit by hand)");
  L.push("");
  L.push("> Projection of `tools/scripts/preflight.bjs` (the gate registry) +");
  L.push("> `docs/stewardship/*.md` + `package.json` scripts. Regenerate with");
  L.push("> `bun run stewardship:gen`; drift or a dangling reference fails");
  L.push("> `bun run stewardship:check`. A hand-list would rot — this can't.");
  L.push("");
  L.push(`## Preflight gates (${a.reg.size})`);
  L.push("");
  L.push("| Gate | Name | Enforce | Cited by |");
  L.push("|---|---|---|---|");
  for (const id of [...a.reg.keys()].sort()) {
    const g = a.reg.get(id);
    const cited = a.gateRefs.has(id) ? [...a.gateRefs.get(id)].sort().join(", ") : "_(undocumented)_";
    L.push(`| ${id} | ${g.name} | ${g.hard ? "hard" : "warn"} | ${cited} |`);
  }
  L.push("");
  L.push("## Health");
  L.push("");
  const fileResolved = a.fileRefs.size - a.danglingFiles.length;
  L.push(`- domains: ${a.domains.length} (${a.domains.sort().join(", ")})`);
  L.push(`- file references: ${a.fileRefs.size} (${fileResolved} resolve, ${a.danglingFiles.length} dangling)`);
  L.push(`- script references: ${a.scriptRefs.size} (${a.scriptRefs.size - a.danglingScripts.length} resolve)`);
  L.push(`- gates: ${a.reg.size} (${a.reg.size - a.orphanGates.length} documented, ${a.orphanGates.length} undocumented)`);
  if (a.danglingGates.length) L.push(`- **DANGLING gate refs**: ${a.danglingGates.join(", ")}`);
  if (a.danglingFiles.length) L.push(`- **DANGLING file refs**: ${a.danglingFiles.join(", ")}`);
  if (a.danglingScripts.length) L.push(`- **DANGLING script refs**: ${a.danglingScripts.join(", ")}`);
  if (a.orphanGates.length) L.push(`- undocumented gates (add to a domain doc): ${a.orphanGates.join(", ")}`);
  L.push("");
  return L.join("\n");
}

function main() {
  const cmd = process.argv[2] || "gen";
  const a = analyze();
  const md = emit(a);
  const dangling = a.danglingGates.length + a.danglingFiles.length + a.danglingScripts.length;
  if (cmd === "gen") {
    writeFileSync(OUT, md);
    console.log(`wrote docs/stewardship/topology.md — ${a.reg.size} gates, ${a.domains.length} domains, ${dangling} dangling, ${a.orphanGates.length} undocumented`);
  } else if (cmd === "check") {
    const committed = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";
    const drift = committed.trim() !== md.trim();
    if (a.danglingGates.length) console.error(`  DANGLING gate refs: ${a.danglingGates.join(", ")}`);
    if (a.danglingFiles.length) console.error(`  DANGLING file refs: ${a.danglingFiles.join(", ")}`);
    if (a.danglingScripts.length) console.error(`  DANGLING script refs: ${a.danglingScripts.join(", ")}`);
    if (drift) console.error("  topology.md is STALE — run `bun run stewardship:gen`");
    if (a.orphanGates.length) console.warn(`  warn: undocumented gates: ${a.orphanGates.join(", ")}`);
    if (dangling || drift) { console.error("stewardship:check FAILED"); process.exit(1); }
    console.log(`stewardship:check ok — ${a.reg.size} gates, ${a.fileRefs.size} file refs all resolve, no drift`);
  } else {
    console.error(`unknown command: ${cmd} (gen|check)`); process.exit(2);
  }
}
main();
