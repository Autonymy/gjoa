#!/usr/bin/env bash
# verify-scriptlet-resources.sh — integrity gate for the vendored uBO scriptlet
# library. scriptlet-resources.json is base64-encoded JS run via evalInSandbox on
# the privileged side of the content classifier; a swapped/tampered bundle would
# inject attacker JS into pages. This asserts the committed JSON still matches the
# SHA-256 recorded in scriptlet-resources.PROVENANCE.md (finding F10).
#
# Exit 0 if the bundle matches, non-zero otherwise. Wire into `bun run preflight`.
set -euo pipefail

# Repo-relative paths, resolved from this script's own location (so it works from
# any cwd and under CI's fresh checkout).
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/../.." && pwd)"
target="${repo_root}/src/gjoa/toolkit/components/content-classifier/scriptlet-resources.json"

# The single source of truth, kept in lockstep with the PROVENANCE note. If you
# legitimately refresh the bundle from a pinned uBO commit, update BOTH this value
# and scriptlet-resources.PROVENANCE.md.
expected="f27354411da54d8a34438f542dcf0694ecd1dd4ab961f0a68de2b29f76f6dc56"

if [[ ! -f "${target}" ]]; then
  echo "verify-scriptlet-resources: FAIL — missing ${target}" >&2
  exit 1
fi

# Prefer coreutils sha256sum; fall back to shasum -a 256 (macOS / Perl).
if command -v sha256sum >/dev/null 2>&1; then
  actual="$(sha256sum "${target}" | cut -d' ' -f1)"
elif command -v shasum >/dev/null 2>&1; then
  actual="$(shasum -a 256 "${target}" | cut -d' ' -f1)"
else
  echo "verify-scriptlet-resources: FAIL — no sha256sum/shasum available" >&2
  exit 1
fi

if [[ "${actual}" != "${expected}" ]]; then
  echo "verify-scriptlet-resources: FAIL — scriptlet-resources.json SHA-256 mismatch" >&2
  echo "  expected: ${expected}" >&2
  echo "  actual:   ${actual}" >&2
  echo "  The vendored uBO scriptlet bundle (run via evalInSandbox) has changed." >&2
  echo "  If this was an intentional refresh from a PINNED uBO commit, update the" >&2
  echo "  SHA-256 in both this script and scriptlet-resources.PROVENANCE.md." >&2
  exit 1
fi

echo "verify-scriptlet-resources: OK — scriptlet-resources.json matches recorded SHA-256"
