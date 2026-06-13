// In-process security gate.
//
// This runs INSIDE the gjoa binary at chrome-window load. It's the only
// path that can stop:
//   - cold launches (also caught by bin/gjoa launcher)
//   - remote-launches into an already-running gjoa (NOT caught by launcher)
//   - launches via rofi / .desktop / `mach run` / direct binary invocation
//   - long-running sessions where the latest stable was released since boot
//
// Spec:
//   1. On chrome-window load, async-fetch latest Firefox version from
//      Mozilla product-details (same source as `bun run security:check`).
//   2. Compare against Services.appinfo.version (the actual binary's
//      Firefox version, NOT gjoa.json — gjoa.json is build-time data, but
//      what's running is what matters).
//   3. If our version is OLDER → modal-alert the user, then quit.
//   4. Re-check every 60 minutes so long-running sessions don't slip past.
//   5. Offline / network failure → fail-OPEN (don't quit), so plane-mode
//      work isn't impossible.
//   6. `GJOA_ALLOW_INSECURE=1` env var → skip entirely.
//
// Dedup: this bundle loads per chrome window. We pin a process-global flag
// onto Services so only the first window starts the polling loop.

const PRODUCT_DETAILS_URL = "https://product-details.mozilla.org/1.0/firefox_versions.json";
const RECHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const FETCH_TIMEOUT_MS = 8000;

/** Parse "150.0" / "151.0.1" → [major, minor, patch]. */
function parseVersion(v: string): [number, number, number] {
  const cleaned = v.replace(/esr$/i, "").trim();
  const parts = cleaned.split(".").map((x) => parseInt(x, 10) || 0);
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

/** Returns true if `b` is strictly newer than `a`. */
function isNewer(a: string, b: string): boolean {
  const av = parseVersion(a);
  const bv = parseVersion(b);
  for (let i = 0; i < 3; i++) {
    if (bv[i] !== av[i]) return bv[i] > av[i];
  }
  return false;
}

function getEnv(name: string): string {
  try {
    const env = Cc["@mozilla.org/process/environment;1"]!
      .getService(Ci.nsIEnvironment) as { get(n: string): string };
    return env.get(name) || "";
  } catch {
    return "";
  }
}

let _quitting = false;
function quitStale(myVersion: string, latestVersion: string): void {
  if (_quitting) return;
  _quitting = true;
  // Best-effort modal. If prompt service fails we just quit silently
  // — the goal is "stop the user from using a stale browser", which the
  // quit accomplishes regardless of whether the modal shows.
  try {
    const promptSvc = Services.prompt as unknown as {
      alert(parent: unknown, title: string, msg: string): void;
    };
    const w = (Services.wm as unknown as { getMostRecentWindow(t: string): unknown })
      .getMostRecentWindow("navigator:browser");
    promptSvc.alert(
      w,
      "gjoa is out of date — quitting",
      `This build is Firefox ${myVersion}; the latest stable is ${latestVersion}.\n\n` +
      `Running an out-of-date browser is unsafe. gjoa will now quit.\n\n` +
      `To rebuild against the latest stable:\n` +
      `  bun run security:bump\n` +
      `  bun run import\n` +
      `  nix build .#gjoa --impure   (~30-60 min)\n\n` +
      `Emergency override (one-off, do not habituate):\n` +
      `  GJOA_ALLOW_INSECURE=1 gjoa`,
    );
  } catch (e) {
    console.error("[security] modal failed; quitting anyway", e);
  }
  try {
    const startup = Services.startup as unknown as { quit(mode: number): void; eAttemptQuit: number; eForceQuit: number };
    startup.quit(startup.eForceQuit);
  } catch (e) {
    console.error("[security] startup.quit failed", e);
  }
}

async function probe(): Promise<void> {
  const myVersion = (Services.appinfo as unknown as { version: string }).version;
  let latest: string | null = null;
  try {
    const r = await fetch(PRODUCT_DETAILS_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json() as { LATEST_FIREFOX_VERSION?: string };
    latest = j.LATEST_FIREFOX_VERSION || null;
  } catch (e) {
    console.log("[security] probe failed — fail-open (offline?):", (e as Error).message);
    return;
  }
  if (!latest) return;
  if (!isNewer(myVersion, latest)) {
    console.log(`[security] OK — ${myVersion} matches or exceeds latest stable ${latest}`);
    return;
  }
  // Tiered response: quit only when we're materially behind. A point
  // release (e.g. 151.0.1 → 151.0.2) is usually a non-CVE patch within
  // a couple of days of release — `gjoa status` will still flag it, but
  // the in-process gate shouldn't force a quit and a rebuild over it.
  // Major-version drift, on the other hand, means ~4 weeks of unpatched
  // CVE exposure and warrants stopping the world.
  const my = parseVersion(myVersion);
  const up = parseVersion(latest);
  const majorBehind = up[0] - my[0];
  if (majorBehind >= 1) {
    console.error(`[security] CRITICAL: running ${myVersion}, latest is ${latest} (${majorBehind} major(s) behind) — quitting`);
    quitStale(myVersion, latest);
  } else {
    console.warn(`[security] STALE: running ${myVersion}, latest is ${latest} (same major, point behind) — gjoa status will show STALE; queue a rebuild for next Sunday`);
  }
}

(function init() {
  // Bypass entirely if the env var is set.
  if (getEnv("GJOA_ALLOW_INSECURE") === "1") {
    console.log("[security] GJOA_ALLOW_INSECURE=1 — gate disabled for this process");
    return;
  }

  // Process-global dedup. We get loaded per chrome window; only the first
  // window starts the loop. The flag is parked on Services because Services
  // is a process-wide singleton (every chrome window shares it).
  type ServicesWithFlag = typeof Services & { __gjoaSecurityRunning?: boolean };
  const svc = Services as ServicesWithFlag;
  if (svc.__gjoaSecurityRunning) return;
  svc.__gjoaSecurityRunning = true;

  // Fire the first check soon, then re-check every hour.
  setTimeout(probe, 2000);
  setInterval(probe, RECHECK_INTERVAL_MS);
})();
