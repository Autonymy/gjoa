// Integration test runner.
//
// Spawns gjoa with --marionette + an ephemeral profile, drives the
// privileged chrome scope via Marionette to run integration tests.
// Streams structured pass/fail JSON for AI/CI consumption.
//
// Test shape:
//   tests/integration/<name>.ts exports `default` an array of test objects:
//     export default [
//       { name: "test name", run: async (mn) => { ... } },
//       ...
//     ];
//   Each `run` receives a connected, chrome-context Marionette client and
//   may throw to fail.
//
// Output:
//   {"type": "test:start", "name": "...", "file": "..."}
//   {"type": "test:pass",  "name": "...", "file": "...", "durationMs": N}
//   {"type": "test:fail",  "name": "...", "file": "...", "durationMs": N,
//    "error": "...", "stack": "..."}
//   {"type": "summary", "pass": N, "fail": M, "skip": K, "durationMs": ...}
//
// Exit code: 0 on full pass, 1 on any failure.

import { spawn, type ChildProcess } from "node:child_process";
import { readdir } from "node:fs/promises";
import { join, basename } from "node:path";
import { connectMarionette, type MarionetteClient } from "./marionette.ts";
import { createProfile, type TestProfile } from "./profile.ts";
import { locateGjoa } from "./gjoa-locator.ts";

export class SkipError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "SkipError";
  }
}

export interface TestContext {
  readonly profilePath: string;
  readonly headed: boolean;
  skip(reason: string): never;
  /** Kill gjoa, respawn with the SAME profile, reconnect Marionette. */
  restartGjoa(): Promise<MarionetteClient>;
}

export interface IntegrationTest {
  name: string;
  run(mn: MarionetteClient, ctx: TestContext): Promise<void>;
}

export interface RunnerOptions {
  gjoaBin?: string;
  testDir?: string;
  marionettePort?: number;
  verbose?: boolean;
  grep?: string;
  headed?: boolean;
}

interface JsonEvent {
  type: "test:start" | "test:pass" | "test:fail" | "test:skip" | "summary" | "log";
  [k: string]: unknown;
}

function emit(ev: JsonEvent): void {
  process.stdout.write(JSON.stringify(ev) + "\n");
}

function logErr(line: string): void {
  process.stderr.write(`[runner] ${line}\n`);
}

async function loadTests(testDir: string): Promise<{ file: string; tests: IntegrationTest[] }[]> {
  let entries: string[];
  try {
    entries = await readdir(testDir);
  } catch (e) {
    throw new Error(`could not read ${testDir}: ${(e as Error).message}`);
  }
  const files = entries.filter(f => /\.(ts|tsx|mjs|js)$/.test(f) && !f.endsWith(".d.ts"));
  const out: { file: string; tests: IntegrationTest[] }[] = [];
  for (const f of files) {
    const path = join(testDir, f);
    const mod = await import(path);
    const tests = (mod.default ?? []) as IntegrationTest[];
    if (!Array.isArray(tests)) {
      logErr(`skipping ${f} — default export is not an array`);
      continue;
    }
    out.push({ file: basename(f), tests });
  }
  return out;
}

async function spawnGjoa(opts: {
  gjoaBin: string;
  profilePath: string;
  marionettePort: number;
  verbose?: boolean;
  headed?: boolean;
}): Promise<ChildProcess> {
  // --remote-allow-system-access is required for privileged ("chrome")
  // context script eval — landed in Firefox 128+ as a safety gate.
  const args = [
    "--profile", opts.profilePath,
    "--marionette",
    ...(opts.headed ? [] : ["--headless"]),
    "--no-remote",
    "--remote-allow-system-access",
    `-marionette-port`, String(opts.marionettePort),
  ];
  const child = spawn(opts.gjoaBin, args, {
    stdio: opts.verbose ? "inherit" : "pipe",
    // Pass GJOA_ALLOW_INSECURE=1 unconditionally so the in-process
    // security gate (src/gjoa/chrome/bjs/security/index.bjs) doesn't
    // quit the test browser. The test environment runs against
    // whatever Firefox version the local build is at — that's
    // unrelated to "is this build safe to ship to users."
    env: { ...process.env, GJOA_ALLOW_INSECURE: "1" },
  });
  if (!opts.verbose) {
    child.stdout?.resume();
    child.stderr?.resume();
  }
  child.once("error", (e) => logErr(`gjoa spawn error: ${e.message}`));
  return child;
}

export async function runAll(opts: RunnerOptions = {}): Promise<{ pass: number; fail: number; skip: number }> {
  const gjoaBin = opts.gjoaBin ?? locateGjoa().path;
  const testDir = opts.testDir ?? join(process.cwd(), "tests/integration");
  const marionettePort = opts.marionettePort ?? 2828;

  if (opts.headed) {
    logErr("WARNING: --headed mode will pop a real gjoa window on your display.");
  }

  const suites = await loadTests(testDir);
  if (opts.grep) {
    const needle = opts.grep.toLowerCase();
    for (const s of suites) {
      s.tests = s.tests.filter((t) => t.name.toLowerCase().includes(needle));
    }
  }
  const totalCount = suites.reduce((n, s) => n + s.tests.length, 0);
  if (totalCount === 0) {
    emit({
      type: "summary", pass: 0, fail: 0, skip: 0, durationMs: 0,
      note: opts.grep ? `no tests match --grep "${opts.grep}"` : "no tests found",
    });
    return { pass: 0, fail: 0, skip: 0 };
  }

  let profile: TestProfile | null = null;
  let gjoa: ChildProcess | null = null;
  let mn: MarionetteClient | null = null;
  let pass = 0;
  let fail = 0;
  let skip = 0;
  const start = Date.now();

  async function killGjoa(): Promise<void> {
    if (!gjoa || gjoa.killed) return;
    gjoa.kill("SIGTERM");
    await new Promise<void>((r) => {
      const timer = setTimeout(() => {
        try { gjoa!.kill("SIGKILL"); } catch {}
        r();
      }, 3000);
      gjoa!.once("exit", () => { clearTimeout(timer); r(); });
    });
  }

  async function bootGjoa(profilePath: string): Promise<MarionetteClient> {
    gjoa = await spawnGjoa({
      gjoaBin, profilePath, marionettePort,
      verbose: opts.verbose, headed: opts.headed,
    });
    const client = await connectMarionette({ port: marionettePort });
    await client.newSession();
    await client.setContext("chrome");
    return client;
  }

  try {
    profile = await createProfile();
    if (opts.verbose) logErr(`profile: ${profile.path}`);
    if (opts.verbose) logErr(`binary:  ${gjoaBin}`);
    mn = await bootGjoa(profile.path);

    for (const suite of suites) {
      for (const t of suite.tests) {
        const file = suite.file;
        emit({ type: "test:start", name: t.name, file });
        const tStart = Date.now();
        const ctx: TestContext = {
          profilePath: profile.path,
          headed: !!opts.headed,
          skip(reason: string): never {
            throw new SkipError(reason);
          },
          async restartGjoa() {
            try { await mn!.quit(); } catch {}
            mn!.disconnect();
            await killGjoa();
            mn = await bootGjoa(profile!.path);
            return mn;
          },
        };
        try {
          await t.run(mn, ctx);
          emit({ type: "test:pass", name: t.name, file, durationMs: Date.now() - tStart });
          pass++;
        } catch (e) {
          if (e instanceof SkipError) {
            emit({
              type: "test:skip", name: t.name, file,
              durationMs: Date.now() - tStart,
              reason: e.message,
            });
            skip++;
          } else {
            emit({
              type: "test:fail", name: t.name, file,
              durationMs: Date.now() - tStart,
              error: (e as Error).message ?? String(e),
              stack: (e as Error).stack,
            });
            fail++;
          }
        }
      }
    }
  } catch (e) {
    logErr(`runner failure: ${(e as Error).stack ?? (e as Error).message}`);
    fail++;
  } finally {
    if (mn) {
      try { await mn.deleteSession(); } catch {}
      mn.disconnect();
    }
    await killGjoa();
    if (profile) {
      if (opts.verbose) {
        logErr(`profile preserved at ${profile.path} for inspection`);
      } else {
        try { await profile.cleanup(); } catch {}
      }
    }
  }

  emit({ type: "summary", pass, fail, skip, durationMs: Date.now() - start });
  return { pass, fail, skip };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const verbose = args.includes("--verbose");
  const headed = args.includes("--headed");
  let grep: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--grep" && args[i + 1]) { grep = args[i + 1]; i++; continue; }
    if (args[i]!.startsWith("--grep=")) { grep = args[i]!.slice("--grep=".length); }
  }
  runAll({ verbose, grep, headed })
    .then(({ fail }) => process.exit(fail > 0 ? 1 : 0))
    .catch((e) => {
      logErr(`fatal: ${(e as Error).stack ?? e}`);
      process.exit(1);
    });
}
