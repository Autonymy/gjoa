#!/usr/bin/env bun
/**
 * tools/bench/cold-start.ts — Cold start (time-to-window-visible) benchmark.
 *
 * Uses xdotool to detect when the browser window becomes visible.
 * Drops filesystem caches between runs for true cold-start measurement.
 */

import { parseArgs } from "util";
import { confidenceInterval95, median, formatResult } from "./stats";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  strict: false,
  options: {
    runs: { type: "string", default: "20" },
    "gjoa-bin": { type: "string" },
    "firefox-bin": { type: "string" },
    "skip-cache-drop": { type: "boolean", default: false },
  },
});

const NUM_RUNS = parseInt(values.runs as string, 10);
if (!Number.isFinite(NUM_RUNS) || NUM_RUNS < 2) {
  console.error("ERROR: --runs must be >= 2 (first run is dropped as warm-up).");
  process.exit(1);
}
const GJOA_BIN = (values["gjoa-bin"] as string | undefined) ?? findBinary("gjoa");
const FIREFOX_BIN = (values["firefox-bin"] as string | undefined) ?? findBinary("firefox");
const SKIP_CACHE_DROP = values["skip-cache-drop"]!;

function findBinary(name: string): string {
  // Check common locations
  if (name === "gjoa") {
    const local = `${process.cwd()}/result/bin/gjoa`;
    try {
      const stat = Bun.file(local);
      if (stat.size > 0) return local;
    } catch {}
  }
  // Fall back to PATH
  const result = Bun.spawnSync(["which", name]);
  const path = result.stdout.toString().trim();
  if (result.exitCode === 0 && path) return path;
  console.error(`ERROR: cannot find ${name} binary. Use --${name}-bin=<path>`);
  process.exit(1);
}

async function dropCaches(): Promise<void> {
  if (SKIP_CACHE_DROP) return;
  const result = Bun.spawnSync(["sudo", "sh", "-c", "sync; echo 3 > /proc/sys/vm/drop_caches"]);
  if (result.exitCode !== 0) {
    console.error("WARN: failed to drop caches (not root?). Use --skip-cache-drop or run with sudo.");
  }
}

async function measureColdStart(
  binary: string,
  windowPattern: string,
): Promise<number> {
  // Create a temporary profile directory
  const profileDir = `${import.meta.dir}/.bench-profile-${Date.now()}`;
  Bun.spawnSync(["mkdir", "-p", profileDir]);

  try {
    await dropCaches();
    // Small delay to let caches settle
    await Bun.sleep(100);

    const start = performance.now();

    // Launch browser with fresh profile, pointing at about:blank
    const browser = Bun.spawn([
      binary,
      "--no-remote",
      "--profile", profileDir,
      "about:blank",
    ], {
      stdout: "ignore",
      stderr: "ignore",
    });

    // Wait for window to become visible using xdotool
    const xdotool = Bun.spawn([
      "xdotool", "search", "--sync", "--onlyvisible", "--name", windowPattern,
    ], {
      stdout: "pipe",
      stderr: "ignore",
    });

    // Timeout after 30 seconds — kill xdotool so its wait resolves.
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      xdotool.kill();
      browser.kill();
    }, 30_000);

    const exitCode = await xdotool.exited;
    const elapsed = performance.now() - start;
    clearTimeout(timeout);

    // Kill the browser
    browser.kill();
    await browser.exited;

    // Hard-fail rather than record a bogus measurement when xdotool never
    // matched a window (timeout, missing window, or other failure).
    if (timedOut) {
      throw new Error(
        `xdotool timed out after 30s waiting for a window matching /${windowPattern}/. ` +
          `Binary may have failed to launch, or the title pattern is wrong.`,
      );
    }
    if (exitCode !== 0) {
      throw new Error(
        `xdotool exited with code ${exitCode} (no window matched /${windowPattern}/). ` +
          `Refusing to record a bogus timing.`,
      );
    }

    return elapsed;
  } finally {
    // Clean up profile
    Bun.spawnSync(["rm", "-rf", profileDir]);
  }
}

async function runBenchmark(
  binary: string,
  label: string,
  windowPattern: string,
): Promise<number[]> {
  const times: number[] = [];

  console.log(`\n  Running ${label} (${NUM_RUNS} runs)...`);
  console.log(`  Binary: ${binary}`);

  for (let i = 0; i < NUM_RUNS; i++) {
    const t = await measureColdStart(binary, windowPattern);
    times.push(t);
    process.stdout.write(`    Run ${i + 1}/${NUM_RUNS}: ${t.toFixed(1)} ms\n`);
    // Brief pause between runs
    await Bun.sleep(500);
  }

  // Drop first run as warm-up
  const results = times.slice(1);
  const ci = confidenceInterval95(results);
  const med = median(results);

  console.log(`\n  ${label} results (excluding warm-up run):`);
  console.log(`    Median: ${med.toFixed(1)} ms`);
  console.log(`    Mean:   ${ci.mean.toFixed(1)} ms  [${ci.low.toFixed(1)} .. ${ci.high.toFixed(1)}] (95% CI)`);

  return results;
}

// --- Main ---

// Preflight: xdotool is required to detect window visibility.
if (Bun.which("xdotool") === null) {
  console.error("ERROR: xdotool not found on PATH. Install it (e.g. `apt install xdotool`).");
  process.exit(1);
}

console.log("=== Cold Start Benchmark ===");
console.log(`  Runs: ${NUM_RUNS} (first dropped as warm-up)`);
console.log(`  Gjoa:    ${GJOA_BIN}`);
console.log(`  Firefox: ${FIREFOX_BIN}`);

const gjoaTimes = await runBenchmark(GJOA_BIN, "Gjoa", "Gjoa|gjoa");
const firefoxTimes = await runBenchmark(FIREFOX_BIN, "Firefox", "Mozilla Firefox|Firefox");

console.log("\n=== Comparison ===\n");
console.log(formatResult("Cold Start (time to window visible)", gjoaTimes, firefoxTimes));
console.log("");
