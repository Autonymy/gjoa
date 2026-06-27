#!/usr/bin/env bash
# Reproduce dark-mode / chrome bugs against the USER'S REAL gjoa profile (not a fresh
# one) on the current dev binary. This is the truth-sharing harness: "I tested X" must
# mean the same pixels the user sees. Fresh-profile tests gave false greens — they run
# logged-out, with no theme cookies and light/empty feeds, so bugs that only manifest
# with real session state (e.g. a backwards Darkness knob leaving YouTube light) never
# showed up. This copies the active profile READ-ONLY (never touches the original),
# boots the current dev binary, navigates the failing sites, and screenshots them for
# an Opus-grade vision pass.
#
# Usage: tools/test-driver/repro-real-profile.sh "url1,url2" [outdir]
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
URLS="${1:-https://www.youtube.com/,https://en.wikipedia.org/wiki/Main_Page}"
OUT="${2:-/tmp/gjoa-repro}"
PORT=2873
PROFROOT="$HOME/.config/mozilla/gjoa"

# Active profile = the locked/Default entry in profiles.ini (falls back to first Path).
PROF="$(awk -F= '/^Default=/{print $2}' "$PROFROOT/profiles.ini" 2>/dev/null | grep -v '^$' | grep '\.' | head -1)"
[ -z "${PROF:-}" ] && PROF="$(awk -F= '/^Path=/{print $2}' "$PROFROOT/profiles.ini" 2>/dev/null | head -1)"
SRC="$PROFROOT/$PROF"
[ -d "$SRC" ] || { echo "no gjoa profile at $SRC" >&2; exit 1; }

WORK="$(mktemp -d)"; DST="$WORK/profile"; mkdir -p "$DST"
trap 'rm -rf "$WORK"' EXIT
rsync -a --exclude='cache2/' --exclude='startupCache/' --exclude='*.lock' \
  --exclude='lock' --exclude='.parentlock' --exclude='storage/default/*/cache/' \
  --exclude='cache/' "$SRC/" "$DST/"
printf 'user_pref("marionette.port",%s);\nuser_pref("marionette.enabled",true);\nuser_pref("browser.sessionstore.resume_from_crash",false);\n' "$PORT" >> "$DST/user.js"

mkdir -p "$OUT"; rm -f "$OUT"/*.png
echo "repro: $SRC (read-only copy) -> $OUT"
BIN=$(echo "$REPO"/engine/obj-*/dist/bin/gjoa)
MOZ_HEADLESS=1 GJOA_DEV_LOADER=1 GJOA_ALLOW_INSECURE=1 timeout 200 \
  "$BIN" -no-remote -profile "$DST" -marionette -remote-allow-system-access about:blank \
  >/tmp/gjoa-repro.log 2>&1 &
GP=$!
sleep 12
timeout 170 python3 "$REPO/tools/test-driver/render-darkmode.py" \
  --port "$PORT" --prefix real --outdir "$OUT" --urls "$URLS" --settle 9 || true
kill "$GP" 2>/dev/null || true
echo "screenshots:"
ls "$OUT"/*.png 2>/dev/null
