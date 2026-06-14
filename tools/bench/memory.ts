#!/usr/bin/env bun
/**
 * tools/bench/memory.ts — Memory usage benchmark.
 *
 * Launches browser, opens N tabs, waits for settle, then sums PSS
 * (proportional set size) from /proc/<pid>/smaps_rollup across the full
 * process tree. PSS attributes each shared page proportionally to the
 * processes mapping it, so summing across the tree does not double-count
 * shared memory the way summing VmRSS would.
 */

import { parseArgs } from "util";
import { formatResult } from "./stats";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  strict: false,
  options: {
    tabs: { type: "string", default: "50" },
    "gjoa-bin": { type: "string" },
    "firefox-bin": { type: "string" },
    "settle-time": { type: "string", default: "10000" },
  },
});

const NUM_TABS = parseInt(values.tabs as string, 10);
const SETTLE_MS = parseInt(values["settle-time"] as string, 10);
const GJOA_BIN = (values["gjoa-bin"] as string | undefined) ?? findBinary("gjoa");
const FIREFOX_BIN = (values["firefox-bin"] as string | undefined) ?? findBinary("firefox");

function findBinary(name: string): string {
  if (name === "gjoa") {
    const local = `${process.cwd()}/result/bin/gjoa`;
    try {
      const stat = Bun.file(local);
      if (stat.size > 0) return local;
    } catch {}
  }
  const result = Bun.spawnSync(["which", name]);
  const path = result.stdout.toString().trim();
  if (result.exitCode === 0 && path) return path;
  console.error(`ERROR: cannot find ${name} binary. Use --${name}-bin=<path>`);
  process.exit(1);
}

/**
 * Get all PIDs in the process tree rooted at the given PID.
 */
function getProcessTree(rootPid: number): number[] {
  const pids: number[] = [rootPid];
  const result = Bun.spawnSync(["pgrep", "-P", String(rootPid)]);
  if (result.exitCode === 0) {
    const children = result.stdout.toString().trim().split("\n").filter(Boolean);
    for (const child of children) {
      const childPid = parseInt(child, 10);
      if (!isNaN(childPid)) {
        pids.push(...getProcessTree(childPid));
      }
    }
  }
  return pids;
}

/**
 * Sum PSS (in KB) from /proc/<pid>/smaps_rollup across all processes in the
 * tree. PSS divides each shared page among the processes that map it, so the
 * tree-wide sum reflects unique physical memory without double-counting
 * shared pages (unlike VmRSS).
 */
function getTreePssKB(rootPid: number): number {
  const pids = getProcessTree(rootPid);
  let totalKB = 0;
  for (const pid of pids) {
    try {
      const rollup = Bun.spawnSync(["cat", `/proc/${pid}/smaps_rollup`]);
      const text = rollup.stdout.toString();
      const match = text.match(/^Pss:\s+(\d+)\s+kB/m);
      if (match) {
        totalKB += parseInt(match[1], 10);
      }
    } catch {
      // Process may have exited, or smaps_rollup is unreadable (permissions).
    }
  }
  return totalKB;
}

async function measureMemory(
  binary: string,
  label: string,
  windowPattern: string,
): Promise<{ totalMB: number; perTabMB: number; tabCount: number }> {
  const profileDir = `${import.meta.dir}/.bench-profile-mem-${Date.now()}`;
  Bun.spawnSync(["mkdir", "-p", profileDir]);

  try {
    console.log(`\n  Launching ${label}...`);
    console.log(`  Binary: ${binary}`);
    console.log(`  Tabs to open: ${NUM_TABS}`);

    // Build list of URLs — use about:blank for consistent measurement
    const urls = Array.from({ length: NUM_TABS }, () => "about:blank");

    // Launch with all tabs specified as arguments
    const browser = Bun.spawn([
      binary,
      "--no-remote",
      "--profile", profileDir,
      ...urls,
    ], {
      stdout: "ignore",
      stderr: "ignore",
    });

    const pid = browser.pid;
    console.log(`  PID: ${pid}`);

    // Wait for window to appear
    const xdotool = Bun.spawn([
      "xdotool", "search", "--sync", "--onlyvisible", "--name", windowPattern,
    ], {
      stdout: "ignore",
      stderr: "ignore",
    });

    // Timeout after 30 seconds — kill xdotool (and the browser) so we don't
    // hang or measure a process that never showed a window.
    let timedOut = false;
    const windowTimeout = setTimeout(() => {
      timedOut = true;
      xdotool.kill();
      browser.kill();
    }, 30_000);
    const windowExit = await xdotool.exited;
    clearTimeout(windowTimeout);

    if (timedOut) {
      throw new Error(
        `xdotool timed out after 30s waiting for a window matching /${windowPattern}/. ` +
          `Binary may have failed to launch, or the title pattern is wrong.`,
      );
    }
    if (windowExit !== 0) {
      throw new Error(
        `xdotool exited with code ${windowExit} (no window matched /${windowPattern}/). ` +
          `Refusing to record a bogus measurement.`,
      );
    }

    // Let the browser settle — tabs load, GC runs, etc.
    console.log(`  Waiting ${SETTLE_MS / 1000}s for settle...`);
    await Bun.sleep(SETTLE_MS);

    // Measure PSS (proportional set size) across the process tree.
    const pssKB = getTreePssKB(pid);
    const totalMB = pssKB / 1024;
    const perTabMB = totalMB / NUM_TABS;

    console.log(`  Total RSS: ${totalMB.toFixed(1)} MB`);
    console.log(`  Per-tab:   ${perTabMB.toFixed(2)} MB`);

    // Kill browser
    browser.kill();
    await browser.exited;

    return { totalMB, perTabMB, tabCount: NUM_TABS };
  } finally {
    Bun.spawnSync(["rm", "-rf", profileDir]);
  }
}

// Multiple samples for statistical significance
async function runBenchmark(
  binary: string,
  label: string,
  windowPattern: string,
  runs: number = 3,
): Promise<number[]> {
  const results: number[] = [];
  for (let i = 0; i < runs; i++) {
    console.log(`\n  --- ${label} run ${i + 1}/${runs} ---`);
    const { totalMB } = await measureMemory(binary, label, windowPattern);
    results.push(totalMB);
    await Bun.sleep(2000); // Pause between runs
  }
  return results;
}

// --- Main ---

// Preflight: xdotool is required to detect window visibility.
if (Bun.which("xdotool") === null) {
  console.error("ERROR: xdotool not found on PATH. Install it (e.g. `apt install xdotool`).");
  process.exit(1);
}

console.log("=== Memory Benchmark ===");
console.log(`  Tabs: ${NUM_TABS}`);
console.log(`  Settle time: ${SETTLE_MS / 1000}s`);
console.log(`  Gjoa:    ${GJOA_BIN}`);
console.log(`  Firefox: ${FIREFOX_BIN}`);

const RUNS = 3;
const gjoaResults = await runBenchmark(GJOA_BIN, "Gjoa", "Gjoa|gjoa", RUNS);
const firefoxResults = await runBenchmark(FIREFOX_BIN, "Firefox", "Mozilla Firefox|Firefox", RUNS);

console.log("\n=== Comparison ===\n");
console.log(formatResult(`Memory (${NUM_TABS} tabs, total PSS MB)`, gjoaResults, firefoxResults, "MB"));

// Per-tab summary
const gjoaPerTab = gjoaResults.map((v) => v / NUM_TABS);
const firefoxPerTab = firefoxResults.map((v) => v / NUM_TABS);
console.log("");
console.log(formatResult("Memory (per-tab MB)", gjoaPerTab, firefoxPerTab, "MB"));
console.log("");
