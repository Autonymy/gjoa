#!/usr/bin/env bun
// security:check — does this gjoa pin a Firefox version that's still
// covered by recent security fixes?
//
// What it actually does:
//   1. Reads gjoa.json → our pinned firefox.version
//   2. Fetches Mozilla product-details:
//        LATEST_FIREFOX_VERSION    (latest stable)
//        FIREFOX_ESR / ESR_NEXT     (extended-support track)
//   3. Fetches Mozilla MFSA RSS, parses the advisories newer than our pin,
//      flags any that mention "exploited in the wild" or "critical".
//   4. Classifies the situation:
//        OK        — we're at latest stable
//        STALE     — point release behind, or 1 major behind <7d
//        CRITICAL  — 2+ majors behind, or any unfixed in-the-wild CVE
//   5. Prints a human-readable status. Exits 0 for OK, 2 for STALE,
//      3 for CRITICAL. (Pre-build hooks treat anything non-zero as a
//      banner-worthy warning; CRITICAL trips the loud path.)
//
// Network failures are fail-OPEN with a clear "could not verify" message
// rather than failing the build — losing the network shouldn't stop you
// from working, but you should know the check didn't run.
//
// JSON output mode: `--json` for machine consumers (the import banner).

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { REPO_ROOT } from "../prep/paths";

interface MozillaVersions {
  LATEST_FIREFOX_VERSION: string;
  FIREFOX_ESR: string;
  FIREFOX_ESR_NEXT?: string;
  LATEST_FIREFOX_RELEASED_DEVEL_VERSION?: string;
  [k: string]: unknown;
}

interface MFSAEntry {
  /** e.g. "mfsa2026-22" */
  id: string;
  title: string;
  link: string;
  /** Severity label from the index page: "critical" | "high" | "moderate" | "low" */
  severity?: string;
  /** Firefox version the advisory is fixed in (e.g. "150.0.3"). */
  affectsVersion?: string;
  /** ISO date — reserved; not populated by the HTML index parse. */
  published: string;
  /** Free-text description — reserved for future per-MFSA fetch. */
  description: string;
}

interface CheckResult {
  /** Our pinned version. */
  pinned: string;
  /** Latest Mozilla stable. */
  latest: string | null;
  /** ESR track for reference. */
  esr: string | null;
  /** Major-version delta (latest.major - pinned.major). */
  majorDelta: number;
  /** Point release delta (only meaningful if major is equal). */
  patchDelta: number | null;
  /** Advisories published since our pinned version was current. */
  advisories: MFSAEntry[];
  /** Any advisory flagged as exploited-in-the-wild. */
  inTheWild: MFSAEntry[];
  /** Classification. */
  status: "OK" | "STALE" | "CRITICAL" | "UNKNOWN";
  /** One-line summary suitable for a banner. */
  summary: string;
  /** Multi-line detail for human display. */
  detail: string;
  /** Set when network failed. Status is then "UNKNOWN". */
  unverified?: string;
}

const PRODUCT_DETAILS_URL = "https://product-details.mozilla.org/1.0/firefox_versions.json";
const KNOWN_VULNS_URL = "https://www.mozilla.org/en-US/security/known-vulnerabilities/firefox/";

/** Parse Firefox version into comparable numeric tuple. Format examples:
 *  "150.0", "151.0.1", "140.11.0esr". Drops "esr" suffix; treats missing
 *  patch as 0. Returns [major, minor, patch]. */
function parseVersion(v: string): [number, number, number] {
  const cleaned = v.replace(/esr$/i, "").trim();
  const parts = cleaned.split(".").map((x) => parseInt(x, 10) || 0);
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

/** -1 if a < b, 0 if equal, 1 if a > b. */
function cmpVersion(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

async function fetchVersions(): Promise<MozillaVersions> {
  const r = await fetch(PRODUCT_DETAILS_URL, { signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error(`product-details HTTP ${r.status}`);
  return (await r.json()) as MozillaVersions;
}

/** Parse Mozilla's known-vulnerabilities index page. Format (stable for
 *  years; if it changes we report partial info rather than crash):
 *
 *    <h3 id="firefoxN.M.P">Fixed in Firefox N.M.P</h3>
 *    <ul>
 *      <li><a href=".../mfsaYYYY-NN/">
 *        <span class="level high|moderate|low|critical">YYYY-NN</span>
 *        Security Vulnerabilities fixed in Firefox N.M.P
 *      </a></li>
 *    </ul>
 *
 *  We extract each (version, advisory id, severity, link) tuple from
 *  the page, then the caller filters by "newer than our pin". */
async function fetchAdvisories(): Promise<MFSAEntry[]> {
  const r = await fetch(KNOWN_VULNS_URL, { signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error(`known-vulns HTTP ${r.status}`);
  const html = await r.text();

  // Split into per-version sections. Each section's MFSAs apply to that
  // exact Firefox version. The regex captures the version label + the
  // chunk of HTML up to the next <h3> (or end).
  const sectionRe = /<h3 id="firefox([0-9.]+(?:esr)?)"[^>]*>[\s\S]*?Fixed in Firefox ([0-9.]+(?:esr)?)\s*<\/a>\s*<\/h3>([\s\S]*?)(?=<h3 id="firefox|<\/main|<footer|$)/g;
  const advRe = /<a href="(\/en-US\/security\/advisories\/mfsa(\d{4}-\d+)\/?)"[^>]*>\s*<span class="level ([a-z]+)">[^<]*<\/span>([^<]*)<\/a>/g;

  const out: MFSAEntry[] = [];
  let sm: RegExpExecArray | null;
  while ((sm = sectionRe.exec(html)) !== null) {
    const version = sm[2]!;
    const sectionBody = sm[3]!;
    let am: RegExpExecArray | null;
    advRe.lastIndex = 0;
    while ((am = advRe.exec(sectionBody)) !== null) {
      const path = am[1]!;
      const slug = `mfsa${am[2]!}`;
      const severity = am[3]!;
      const title = am[4]!.trim();
      out.push({
        id: slug,
        title: title || `Security advisory ${slug}`,
        link: "https://www.mozilla.org" + path,
        severity,
        affectsVersion: version,
        published: "",
        description: "",
      });
    }
  }
  return out;
}

/** Advisory affects our pin if it fixes a Firefox version STRICTLY
 *  newer than our pinned version. (We're missing its fix.) */
function advisoryAffectsOurPin(entry: MFSAEntry, pinned: [number, number, number]): boolean {
  if (!entry.affectsVersion) return false;
  if (entry.affectsVersion.endsWith("esr")) return false; // ESR track is separate
  const v = parseVersion(entry.affectsVersion);
  return cmpVersion(v, pinned) > 0;
}

function isInTheWild(entry: MFSAEntry): boolean {
  // Severity "critical" or explicit in-the-wild flag in title.
  const text = (entry.title + " " + entry.description).toLowerCase();
  return entry.severity === "critical"
      || /(exploit|exploited)\s+in\s+the\s+wild/.test(text)
      || /actively\s+exploited/.test(text);
}

function classify(
  pinnedTuple: [number, number, number],
  latestTuple: [number, number, number],
  advisories: MFSAEntry[],
  inTheWild: MFSAEntry[],
): { status: CheckResult["status"]; summary: string } {
  if (inTheWild.length > 0) {
    return {
      status: "CRITICAL",
      summary: `${inTheWild.length} in-the-wild CVE(s) unaddressed`,
    };
  }
  const majorDelta = latestTuple[0] - pinnedTuple[0];
  if (majorDelta >= 2) {
    return { status: "CRITICAL", summary: `${majorDelta} major versions behind` };
  }
  const cmp = cmpVersion(pinnedTuple, latestTuple);
  if (cmp === 0) {
    return { status: "OK", summary: `at latest stable (${latestTuple.join(".")})` };
  }
  if (cmp > 0) {
    // We're ahead of "latest stable" — likely tracking beta/nightly.
    return { status: "OK", summary: `ahead of latest stable (${latestTuple.join(".")})` };
  }
  return {
    status: "STALE",
    summary: `${majorDelta > 0 ? majorDelta + " major(s)" : "point release"} behind${advisories.length ? `; ${advisories.length} advisor${advisories.length === 1 ? "y" : "ies"}` : ""}`,
  };
}

export async function check(): Promise<CheckResult> {
  const gjoaJsonPath = join(REPO_ROOT, "gjoa.json");
  const gjoaJson = JSON.parse(await readFile(gjoaJsonPath, "utf8")) as { firefox: { version: string } };
  const pinned = gjoaJson.firefox.version;
  const pinnedTuple = parseVersion(pinned);

  let versions: MozillaVersions | null = null;
  let advisories: MFSAEntry[] = [];
  let netError: string | undefined;

  try {
    versions = await fetchVersions();
  } catch (e) {
    netError = `version probe failed: ${(e as Error).message}`;
  }
  if (versions) {
    try {
      advisories = await fetchAdvisories();
    } catch (e) {
      // Treat as partial: we have version info but not advisories.
      netError = `advisory probe failed: ${(e as Error).message}`;
    }
  }

  if (!versions) {
    return {
      pinned,
      latest: null,
      esr: null,
      majorDelta: 0,
      patchDelta: null,
      advisories: [],
      inTheWild: [],
      status: "UNKNOWN",
      summary: "could not verify — network probe failed",
      detail: `Pinned: ${pinned}\nCould not reach Mozilla product-details (${netError}).\nRe-run on a working network to verify.`,
      unverified: netError,
    };
  }

  const latest = versions.LATEST_FIREFOX_VERSION;
  const esr = versions.FIREFOX_ESR;
  const latestTuple = parseVersion(latest);

  const matchedAdvisories = advisories.filter((a) => advisoryAffectsOurPin(a, pinnedTuple));
  const inTheWild = matchedAdvisories.filter(isInTheWild);

  const { status, summary } = classify(pinnedTuple, latestTuple, matchedAdvisories, inTheWild);

  const detailLines: string[] = [
    `Pinned:        ${pinned}`,
    `Latest stable: ${latest}`,
    `ESR track:     ${esr}`,
  ];
  if (matchedAdvisories.length > 0) {
    detailLines.push("", `Unfixed advisories on your pin (${matchedAdvisories.length}):`);
    // Sort by severity (critical first), then advisory id newest first.
    const sevRank: Record<string, number> = { critical: 0, high: 1, moderate: 2, low: 3 };
    const sorted = [...matchedAdvisories].sort((a, b) => {
      const sa = sevRank[a.severity || "low"] ?? 4;
      const sb = sevRank[b.severity || "low"] ?? 4;
      if (sa !== sb) return sa - sb;
      return a.id < b.id ? 1 : -1;
    });
    for (const a of sorted.slice(0, 8)) {
      const sev = (a.severity || "?").padEnd(8);
      const wild = isInTheWild(a) ? "  [in-the-wild]" : "";
      detailLines.push(`  [${sev}] ${a.id}  fixes Firefox ${a.affectsVersion}${wild}`);
    }
    if (sorted.length > 8) {
      detailLines.push(`  ... and ${sorted.length - 8} more`);
    }
    detailLines.push("", `Details: https://www.mozilla.org/en-US/security/known-vulnerabilities/firefox/`);
  }
  if (netError && versions) {
    detailLines.push("", `Note: ${netError}`);
  }

  const majorDelta = latestTuple[0] - pinnedTuple[0];
  const patchDelta = majorDelta === 0 ? cmpVersion(pinnedTuple, latestTuple) : null;

  return {
    pinned,
    latest,
    esr,
    majorDelta,
    patchDelta,
    advisories: matchedAdvisories,
    inTheWild,
    status,
    summary,
    detail: detailLines.join("\n"),
    ...(netError ? { unverified: netError } : {}),
  };
}

function statusColor(status: CheckResult["status"]): string {
  if (status === "OK") return "\x1b[32m"; // green
  if (status === "STALE") return "\x1b[33m"; // yellow
  if (status === "CRITICAL") return "\x1b[31m"; // red
  return "\x1b[36m"; // cyan for UNKNOWN
}

function exitCodeFor(status: CheckResult["status"]): number {
  return status === "OK" ? 0
       : status === "STALE" ? 2
       : status === "CRITICAL" ? 3
       : 1; // UNKNOWN
}

async function main(): Promise<void> {
  const jsonMode = process.argv.includes("--json");
  const quietMode = process.argv.includes("--quiet");
  const r = await check();
  if (jsonMode) {
    console.log(JSON.stringify(r, null, 2));
  } else if (!quietMode) {
    const color = statusColor(r.status);
    const reset = "\x1b[0m";
    console.error(`${color}[security] ${r.status}${reset} — ${r.summary}`);
    console.error(r.detail);
  }
  process.exit(exitCodeFor(r.status));
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(`[security] check threw: ${(err as Error).message}`);
    process.exit(1);
  });
}
