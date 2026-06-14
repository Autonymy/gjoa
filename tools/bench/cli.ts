#!/usr/bin/env bun
/**
 * tools/bench/cli.ts — Main benchmark CLI entry point.
 *
 * Subcommands: cold-start, memory, all
 */

const subcommand = Bun.argv[2];

function usage(): void {
  console.log(`
Usage: bun tools/bench/cli.ts <command> [options]

Commands:
  cold-start    Measure time-to-window-visible
  memory        Measure memory usage with N tabs
  all           Run all benchmarks
  env-check     Check if environment is ready for benchmarking

Options are passed through to subcommands. See individual scripts for details.

Common options:
  --gjoa-bin=<path>       Path to gjoa binary
  --firefox-bin=<path>    Path to firefox binary
  --runs=N                Number of runs (cold-start, default 20)
  --tabs=N                Number of tabs (memory, default 50)

Prepare environment first:
  sudo bash tools/bench/env.sh           # disable turbo, set governor, etc.
  sudo bash tools/bench/env.sh --restore # undo after benchmarking
`);
}

function checkEnvironment(): { warnings: string[] } {
  const warnings: string[] = [];

  // Check turbo boost
  const intelTurbo = Bun.spawnSync(["cat", "/sys/devices/system/cpu/intel_pstate/no_turbo"]);
  const amdBoost = Bun.spawnSync(["cat", "/sys/devices/system/cpu/cpufreq/boost"]);

  if (intelTurbo.exitCode === 0) {
    if (intelTurbo.stdout.toString().trim() === "0") {
      warnings.push("Intel turbo boost is ON — results will have high variance. Run: sudo bash tools/bench/env.sh");
    }
  } else if (amdBoost.exitCode === 0) {
    if (amdBoost.stdout.toString().trim() === "1") {
      warnings.push("AMD boost is ON — results will have high variance. Run: sudo bash tools/bench/env.sh");
    }
  }

  // Check governor
  const governor = Bun.spawnSync(["cat", "/sys/devices/system/cpu/cpu0/cpufreq/scaling_governor"]);
  if (governor.exitCode === 0) {
    const gov = governor.stdout.toString().trim();
    if (gov !== "performance") {
      warnings.push(`CPU governor is '${gov}' (want 'performance'). Run: sudo bash tools/bench/env.sh`);
    }
  }

  // Check ASLR
  const aslr = Bun.spawnSync(["cat", "/proc/sys/kernel/randomize_va_space"]);
  if (aslr.exitCode === 0) {
    const val = aslr.stdout.toString().trim();
    if (val !== "0") {
      warnings.push(`ASLR is enabled (${val}). Run: sudo bash tools/bench/env.sh`);
    }
  }

  // Check xdotool
  const xdotool = Bun.spawnSync(["which", "xdotool"]);
  if (xdotool.exitCode !== 0) {
    warnings.push("xdotool not found — required for window detection. Install it.");
  }

  return { warnings };
}

function printEnvironmentStatus(): void {
  const { warnings } = checkEnvironment();
  if (warnings.length === 0) {
    console.log("  Environment: OK (turbo off, performance governor, ASLR off)");
  } else {
    console.log("  Environment warnings:");
    for (const w of warnings) {
      console.log(`    WARN: ${w}`);
    }
  }
  console.log("");
}

function findBinary(name: string): string | null {
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
  return null;
}

async function runSubcommand(script: string): Promise<void> {
  const args = Bun.argv.slice(3); // pass through all args after subcommand
  const proc = Bun.spawn(["bun", `${import.meta.dir}/${script}`, ...args], {
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });
  const code = await proc.exited;
  if (code !== 0) process.exit(code);
}

// --- Main ---

if (!subcommand || subcommand === "--help" || subcommand === "-h") {
  usage();
  process.exit(0);
}

// Print header
console.log("\n=== Gjoa Benchmark Suite ===\n");

// Auto-detect binaries
const gjoaBin = findBinary("gjoa");
const firefoxBin = findBinary("firefox");
console.log(`  Gjoa binary:    ${gjoaBin ?? "NOT FOUND"}`);
console.log(`  Firefox binary: ${firefoxBin ?? "NOT FOUND"}`);
console.log("");

// Environment check
printEnvironmentStatus();

switch (subcommand) {
  case "cold-start":
    await runSubcommand("cold-start.ts");
    break;
  case "memory":
    await runSubcommand("memory.ts");
    break;
  case "all":
    await runSubcommand("cold-start.ts");
    await runSubcommand("memory.ts");
    break;
  case "env-check":
    // Already printed above
    break;
  default:
    console.error(`Unknown command: ${subcommand}`);
    usage();
    process.exit(1);
}
