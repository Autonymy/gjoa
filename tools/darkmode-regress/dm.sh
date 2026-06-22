#!/usr/bin/env bash
# FAST no-build dark-mode iterate. The dark-mode actor (.sys.mjs) and the curated
# fixes (darkmode-fixes.json) are packaged as LOOSE files that the dist tree SYMLINKS
# back into engine/ (dist/bin/modules/<f> -> engine/toolkit/.../<f>), and each fresh
# gjoa launch reads them off disk. So a chrome-actor / fixes change needs NEITHER
# `bun run import` (~30s) NOR `mach build faster` (~37s) — just copy src -> engine and
# render. (C++/Rust/pref/jar changes still need the real build; this is only for the
# dark-mode actor + fixes JSON, which are the hot iteration path.)
#
# Usage:  nix develop .#mach -c bash tools/darkmode-regress/dm.sh [mode] [settle_ms] [tags|all]
#   dm.sh dark 4000 wikipedia cnn amazon
#   dm.sh dark 5000 all
set -u
cd /home/tom/code/gjoa
SRC=src/gjoa/toolkit/components/content-classifier
ENG=engine/toolkit/components/content-classifier
FILES=(GjoaDarkmodeParent.sys.mjs GjoaDarkmodeChild.sys.mjs darkmode-fixes.json)

echo "=== dm: sync (no build) ==="
for f in "${FILES[@]}"; do
  if [ -f "$SRC/$f" ]; then
    cp "$SRC/$f" "$ENG/$f"
    printf '  synced %-28s %s bytes\n' "$f" "$(stat -c%s "$ENG/$f")"
  fi
done
# Assert the dist symlink resolves to the file we just wrote (fail loud if the build
# layout ever changes and a real rebuild becomes necessary).
LINK=engine/obj-x86_64-pc-linux-gnu/dist/bin/modules/GjoaDarkmodeParent.sys.mjs
if [ "$(readlink -f "$LINK" 2>/dev/null)" != "$(readlink -f "$ENG/GjoaDarkmodeParent.sys.mjs" 2>/dev/null)" ]; then
  echo "!! dist actor is NOT a symlink into engine/ — a real build IS needed. Aborting fast path." >&2
  exit 2
fi
echo ""
exec bash tools/darkmode-regress/fastgallery.sh "$@"
