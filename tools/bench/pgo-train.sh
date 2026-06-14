#!/usr/bin/env bash
# pgo-train.sh — Profile-Guided Optimization training harness for gjoa
#
# Usage:
#   ./tools/bench/pgo-train.sh [objdir]
#
# Steps:
#   1. Builds an instrumented binary (--enable-profile-generate).
#   2. Launches the instrumented browser — browse normally to train.
#   3. On Ctrl+C (or `kill -INT`), merges profraw files into a single
#      profdata suitable for --enable-profile-use.
#
# Output:
#   tools/bench/gjoa.profdata
#
# Prerequisites:
#   - A mach-capable source tree (engine/ directory).
#   - LLVM toolchain in PATH (auto-detected from nix dev shell).
#   - Enough disk for an instrumented build (~2x normal).
#
# NOTE: This is a Lane 3 operation — requires explicit user permission
#       and should only run during the Sunday build window per CLAUDE.md.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENGINE_DIR="$REPO_ROOT/engine"
OBJDIR="${1:-$ENGINE_DIR/obj-pgo-instrumented}"
PROFDATA_OUT="$SCRIPT_DIR/gjoa.profdata"

# --- Auto-detect llvm-profdata ---
find_llvm_profdata() {
  # Prefer the one from the nix dev shell (direnv)
  if command -v llvm-profdata &>/dev/null; then
    echo "llvm-profdata"
    return
  fi
  # Fallback: search common nix store paths
  local candidate
  candidate=$(find /nix/store -maxdepth 3 -name "llvm-profdata" -type f 2>/dev/null | head -1)
  if [[ -n "$candidate" ]]; then
    echo "$candidate"
    return
  fi
  echo ""
}

LLVM_PROFDATA=$(find_llvm_profdata)
if [[ -z "$LLVM_PROFDATA" ]]; then
  echo "ERROR: llvm-profdata not found. Ensure LLVM is in PATH (nix dev shell)." >&2
  exit 1
fi
echo "Using llvm-profdata: $LLVM_PROFDATA"

# --- Phase 1: Instrumented build ---
echo ""
echo "=== Phase 1: Building instrumented binary ==="
echo "    objdir: $OBJDIR"
echo ""

cd "$ENGINE_DIR"

# Write a temporary mozconfig for PGO instrumentation
PGO_MOZCONFIG=$(mktemp)
trap 'rm -f "$PGO_MOZCONFIG"' EXIT

cat > "$PGO_MOZCONFIG" <<'MOZCONFIG'
ac_add_options --enable-profile-generate
ac_add_options --enable-optimize
ac_add_options --disable-debug
MOZCONFIG

export MOZCONFIG="$PGO_MOZCONFIG"
export MOZ_OBJDIR="$OBJDIR"

./mach build

echo ""
echo "=== Instrumented build complete ==="

# --- Phase 2: Launch instrumented browser ---
PROFILE_DIR=$(mktemp -d -t gjoa-pgo-profile-XXXXXX)
export LLVM_PROFILE_FILE="$PROFILE_DIR/gjoa-%p-%m.profraw"

echo ""
echo "=== Phase 2: Launching instrumented browser ==="
echo "    Profile data landing in: $PROFILE_DIR"
echo ""
echo "    Browse normally to generate a representative workload."
echo "    When done, press Ctrl+C to stop and merge profiles."
echo ""

# --- Phase 3: Merge profraw files ---
# Defined BEFORE the trap that calls it (via cleanup_and_merge); otherwise a
# Ctrl+C during phase 2 would fire the trap before this function exists and
# lose all collected profile data.
merge_profiles() {
  echo ""
  echo "=== Phase 3: Merging profile data ==="

  # nullglob so a non-matching glob yields an empty array, not a literal
  # "*.profraw" entry.
  shopt -s nullglob
  local profraw_files=("$PROFILE_DIR"/*.profraw)
  shopt -u nullglob
  if [[ ${#profraw_files[@]} -eq 0 ]]; then
    echo "ERROR: No .profraw files found in $PROFILE_DIR" >&2
    exit 1
  fi

  echo "    Found ${#profraw_files[@]} profraw file(s)."

  "$LLVM_PROFDATA" merge \
    --output="$PROFDATA_OUT" \
    "${profraw_files[@]}"

  echo ""
  echo "=== Done ==="
  echo "    Merged profile: $PROFDATA_OUT"
  echo ""
  echo "To use for PGO build, add to mozconfig:"
  echo "    ac_add_options --enable-profile-use"
  echo "    ac_add_options --with-pgo-profile-path=$PROFDATA_OUT"

  # Cleanup temp profile dir
  rm -rf "$PROFILE_DIR"
}

# Trap SIGINT to move to phase 3
BROWSER_PID=""
cleanup_and_merge() {
  echo ""
  echo "=== Stopping browser ==="
  if [[ -n "$BROWSER_PID" ]] && kill -0 "$BROWSER_PID" 2>/dev/null; then
    kill "$BROWSER_PID"
    wait "$BROWSER_PID" 2>/dev/null || true
  fi
  merge_profiles
}
trap cleanup_and_merge INT TERM

"$OBJDIR/dist/bin/gjoa" --no-remote --profile "$PROFILE_DIR/browser-profile" &
BROWSER_PID=$!

# Wait for browser to exit (or be killed by trap)
wait "$BROWSER_PID" 2>/dev/null || true

# If browser exited normally (not via trap), still merge. Use nullglob to
# detect whether any profraw files exist without tripping SC2144.
shopt -s nullglob
_remaining_profraw=("$PROFILE_DIR"/*.profraw)
shopt -u nullglob
if [[ ${#_remaining_profraw[@]} -gt 0 ]]; then
  merge_profiles
fi
