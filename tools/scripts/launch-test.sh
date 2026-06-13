#!/usr/bin/env bash
# Launch the mach-built gjoa against the gjoa-test profile, capturing
# stderr/stdout to /tmp/gjoa.log so chrome loader + chrome JS errors
# are inspectable.
#
# Use after `bun run chrome:install`.
# Inspect log: `tail -f /tmp/gjoa.log` from another terminal, or
# `grep -iE 'gjoa-loader|gjoa' /tmp/gjoa.log`.

set -euo pipefail

BIN="$HOME/code/gjoa/engine/obj-x86_64-pc-linux-gnu/dist/bin/gjoa"
PROFILE="$HOME/.mozilla/firefox/gjoa-test"
LOG="/tmp/gjoa.log"

if [ ! -x "$BIN" ]; then
  echo "✗ gjoa binary not found at $BIN" >&2
  echo "  did you run \`cd engine && ./mach build\` (or \`./mach build faster\` if it's just chrome edits)?" >&2
  exit 1
fi
if [ ! -d "$PROFILE" ]; then
  echo "✗ profile dir not found at $PROFILE" >&2
  echo "  run \`bun run chrome:install\` first" >&2
  exit 1
fi

echo "→ launching $BIN"
echo "  profile: $PROFILE"
echo "  log:     $LOG"
echo

# tee so the user sees output live AND it's captured to the log.
"$BIN" --no-remote --profile "$PROFILE" 2>&1 | tee "$LOG"
