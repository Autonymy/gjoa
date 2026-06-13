# gjoa security policy

## Update cadence

| Trigger | SLA |
|---|---|
| Mozilla ships a patch release (e.g. 151.0.1 → 151.0.2) | 7 days |
| Mozilla ships a major release with MFSAs | 48 hours |
| Any in-the-wild CVE against our pin | same-day |
| Zero-day disclosed | immediate (security:bump + rebuild) |

## Tools

- `bun run security:check` (or `gjoa status`) — fresh probe of Mozilla
  product-details + MFSAs; classifies OK / STALE / CRITICAL.
- `bun run security:bump` — writes latest stable into `gjoa.json`.
- `bin/gjoa` launcher — refuses to launch a STALE/CRITICAL binary
  unless `GJOA_ALLOW_INSECURE=1` (one-off override).
- In-process gate (`src/gjoa/chrome/src/security/index.ts`) — runs at
  chrome-window load, re-checks every 60 min. Quits on major-behind
  or in-the-wild; warns on patch-behind.

## Sources of truth

- Mozilla product-details: https://product-details.mozilla.org/1.0/firefox_versions.json
- Mozilla known-vulns index: https://www.mozilla.org/security/known-vulnerabilities/firefox/

## Notes

The gate is fail-OPEN on network errors — losing internet shouldn't
block work. `gjoa status` shows when the probe last succeeded so you
can tell "verified safe" from "couldn't verify."
