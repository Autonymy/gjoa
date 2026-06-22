#!/usr/bin/env bun
// Test profiler + hygiene gate + audit-ledger. Policy: docs/test-stewardship.md.
//
//   bun run test:profile        report actual-vs-budget; --gate exits 1 on regression
//   bun run test:audit          full audit: write an audit-ledger entry + show trend
//
// Reads the duration HISTORY (.test-metrics/runs.jsonl, written by record-metrics)
// and the budget manifest (configs/test-budgets.json). Excludes "dead-binary" runs
// (>50% fail — every test hung to its timeout ceiling) so artifacts don't poison
// the stats. Tracks the audit itself (.test-metrics/audit-ledger.jsonl) so the
// diminishing-returns trend is visible across audits.

import { existsSync, readFileSync, writeFileSync, appendFileSync } from "fs";
import { join } from "path";

const REPO = process.cwd();
const RUNS = join(REPO, ".test-metrics", "runs.jsonl");
const BUDGETS = join(REPO, "configs", "test-budgets.json");
const LEDGER = join(REPO, ".test-metrics", "audit-ledger.jsonl");

const baseName = (f) => (f || "").replace(/.*\//, "").replace(/\.(js|bjs)$/, "");

function readRuns() {
  if (!existsSync(RUNS)) return [];
  return readFileSync(RUNS, "utf8")
    .split("\n").filter((l) => l.trim())
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}
// A run is dead (broken binary) if >50% of its tests failed.
const healthy = (r) => {
  const t = r.totals || {};
  return !t.total || t.fail / t.total < 0.5;
};
const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

// per-file healthy p50 = median over healthy runs of (sum of that file's case durations)
function fileStats() {
  const runs = readRuns(), healthyRuns = runs.filter(healthy);
  const per = new Map(); // file -> [perRunTotalMs]
  for (const run of healthyRuns) {
    const byFile = new Map();
    for (const t of run.tests || []) {
      const f = baseName(t.file);
      byFile.set(f, (byFile.get(f) || 0) + (t.durationMs || 0));
    }
    for (const [f, ms] of byFile) {
      if (!per.has(f)) per.set(f, []);
      per.get(f).push(ms);
    }
  }
  const out = new Map();
  for (const [f, arr] of per) out.set(f, { p50: median(arr), runs: arr.length });
  return { stats: out, healthyRuns: healthyRuns.length, deadRuns: runs.length - healthyRuns.length };
}

function main() {
  const audit = process.argv.includes("--audit");
  const gate = process.argv.includes("--gate"); // CI gate only; --audit just records + reports
  const manifest = JSON.parse(readFileSync(BUDGETS, "utf8"));
  const budgets = manifest.tests || {};
  const { stats, healthyRuns, deadRuns } = fileStats();

  const rows = [];
  for (const [f, b] of Object.entries(budgets)) {
    const s = stats.get(f);
    rows.push({ f, tier: b.tier, cat: b.category, budget: b.budgetMs,
      p50: s ? s.p50 : null, runs: s ? s.runs : 0,
      over: s && s.p50 > b.budgetMs * 1.15 ? s.p50 - b.budgetMs : 0 });
  }
  // tests with history but no budget = un-stewarded (gate offence)
  const unbudgeted = [...stats.keys()].filter((f) => !budgets[f] && !f.startsWith("_") && f !== "omni-diag");

  const suiteP50 = rows.reduce((a, r) => a + (r.p50 || 0), 0);
  const overBudget = rows.filter((r) => r.over > 0);

  console.log(`\n  test profile · ${healthyRuns} healthy runs (${deadRuns} dead-binary runs excluded)`);
  console.log(`  suite p50 ${(suiteP50 / 1000).toFixed(1)}s  vs budget ${(manifest.suiteBudgetMs / 1000).toFixed(1)}s` +
    `  ·  ${overBudget.length} over budget  ·  ${unbudgeted.length} un-budgeted\n`);
  for (const r of [...rows].sort((a, b) => b.over - a.over)) {
    if (r.p50 == null) continue;
    const flag = r.over > 0 ? "OVER " : "  ok ";
    console.log(`  ${flag} ${r.f.padEnd(30)} ${String(r.p50).padStart(5)}ms / ${String(r.budget).padStart(5)}ms  [${r.tier}/${r.cat}]`);
  }
  if (unbudgeted.length) console.log(`\n  UN-BUDGETED (add to configs/test-budgets.json): ${unbudgeted.join(", ")}`);

  if (audit) {
    const prior = existsSync(LEDGER)
      ? readFileSync(LEDGER, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l)).pop()
      : null;
    const entry = { date: new Date().toISOString().slice(0, 10), healthyRuns,
      suiteP50Ms: suiteP50, overBudget: overBudget.length, unbudgeted: unbudgeted.length,
      estSavingsMs: manifest.lastAudit?.estTotalSavingsMs ?? null };
    appendFileSync(LEDGER, JSON.stringify(entry) + "\n");
    manifest.lastAudit = { ...manifest.lastAudit, ...entry };
    writeFileSync(BUDGETS, JSON.stringify(manifest, null, 2) + "\n");
    if (prior) {
      const d = suiteP50 - prior.suiteP50Ms;
      console.log(`\n  audit since ${prior.date}: suite p50 ${d >= 0 ? "+" : ""}${(d / 1000).toFixed(1)}s,` +
        ` over-budget ${overBudget.length - prior.overBudget >= 0 ? "+" : ""}${overBudget.length - prior.overBudget}` +
        `  (rising est-savings = more slack; falling = diminishing returns)`);
    }
    console.log(`  audit-ledger ← ${entry.date}  (.test-metrics/audit-ledger.jsonl)`);
  }

  if (gate && (overBudget.length || unbudgeted.length)) {
    console.error(`\n  HYGIENE GATE FAILED — ${overBudget.length} over budget, ${unbudgeted.length} un-budgeted. See docs/test-stewardship.md`);
    process.exit(1);
  }
}
main();
