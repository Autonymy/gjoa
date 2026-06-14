#!/usr/bin/env bash
# bolt-optimize.sh — BOLT post-link optimization for libxul.so
#
# Usage:
#   ./tools/bench/bolt-optimize.sh /path/to/libxul.so
#
# Steps:
#   1. perf record a live browsing session (user browses, Ctrl+C to stop).
#   2. perf2bolt converts perf data to BOLT's fdata format.
#   3. llvm-bolt applies aggressive layout optimizations.
#   4. Replaces the original libxul.so (with backup).
#
# Prerequisites:
#   - llvm-bolt and perf2bolt in PATH (from LLVM/BOLT package).
#   - perf installed and working.
#   - The binary must NOT be stripped of relocations (link with -Wl,--emit-relocs).
#
# NixOS notes:
#   - kernel.perf_event_paranoid must be <= 1 for perf to work:
#       sudo sysctl kernel.perf_event_paranoid=1
#     Or persistently in /etc/sysctl.d/:
#       kernel.perf_event_paranoid = 1
#   - On NixOS, perf is typically available via `linuxPackages.perf` or
#     in the dev shell. Make sure the perf version matches your kernel.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# --- Argument validation ---
if [[ $# -lt 1 ]]; then
  echo "Usage: $0 /path/to/libxul.so" >&2
  exit 1
fi

LIBXUL="$1"
if [[ ! -f "$LIBXUL" ]]; then
  echo "ERROR: File not found: $LIBXUL" >&2
  exit 1
fi

# --- Tool detection ---
for tool in perf perf2bolt llvm-bolt; do
  if ! command -v "$tool" &>/dev/null; then
    echo "ERROR: $tool not found in PATH." >&2
    echo "       Ensure LLVM/BOLT tools are available (nix dev shell or package)." >&2
    exit 1
  fi
done

# --- Check perf_event_paranoid ---
PARANOID=$(cat /proc/sys/kernel/perf_event_paranoid 2>/dev/null || echo "unknown")
if [[ "$PARANOID" != "unknown" ]] && [[ "$PARANOID" -gt 1 ]]; then
  echo "WARNING: kernel.perf_event_paranoid = $PARANOID (need <= 1 for perf record)" >&2
  echo "         Run: sudo sysctl kernel.perf_event_paranoid=1" >&2
  echo ""
fi

PERF_DATA="$SCRIPT_DIR/perf.data"
BOLT_FDATA="$SCRIPT_DIR/bolt.fdata"
LIBXUL_BOLTED="${LIBXUL}.bolt"
LIBXUL_BACKUP="${LIBXUL}.pre-bolt"

echo "=== BOLT Optimization Pipeline ==="
echo "    Target: $LIBXUL"
echo ""

# --- Step 1: perf record ---
echo "=== Step 1: Recording perf profile ==="
echo "    Launch the browser and browse normally."
echo "    Press Ctrl+C when done to stop recording."
echo ""

# Find the gjoa binary relative to libxul.
#   - An explicit $GJOA_BIN env override wins (and must be executable).
#   - Otherwise probe gjoa-bin (the real ELF) FIRST, then the gjoa wrapper,
#     in both the libxul-sibling dir and the ../bin layout.
LIBXUL_DIR="$(dirname "$LIBXUL")"
if [[ -n "${GJOA_BIN:-}" ]]; then
  if [[ ! -x "$GJOA_BIN" ]]; then
    echo "ERROR: \$GJOA_BIN is set but not executable: $GJOA_BIN" >&2
    exit 1
  fi
else
  for candidate in \
    "$LIBXUL_DIR/gjoa-bin" \
    "$LIBXUL_DIR/../bin/gjoa-bin" \
    "$LIBXUL_DIR/gjoa" \
    "$LIBXUL_DIR/../bin/gjoa"; do
    if [[ -x "$candidate" ]]; then
      GJOA_BIN="$candidate"
      break
    fi
  done
  if [[ -z "${GJOA_BIN:-}" ]]; then
    echo "ERROR: Cannot find gjoa binary relative to libxul." >&2
    echo "       Probed gjoa-bin/gjoa under $LIBXUL_DIR and $LIBXUL_DIR/../bin" >&2
    echo "       Set \$GJOA_BIN to point at the executable explicitly." >&2
    exit 1
  fi
fi
echo "    Using browser binary: $GJOA_BIN"

perf record \
  -e cycles:u \
  -j any,u \
  -o "$PERF_DATA" \
  -- "$GJOA_BIN" --no-remote || true

echo ""
echo "    perf data: $PERF_DATA ($(du -h "$PERF_DATA" | cut -f1))"

# --- Step 2: perf2bolt ---
echo ""
echo "=== Step 2: Converting perf data to BOLT format ==="

perf2bolt \
  -p "$PERF_DATA" \
  -o "$BOLT_FDATA" \
  "$LIBXUL"

echo "    BOLT fdata: $BOLT_FDATA"

# --- Step 3: llvm-bolt ---
echo ""
echo "=== Step 3: Applying BOLT optimizations ==="

llvm-bolt "$LIBXUL" \
  -o "$LIBXUL_BOLTED" \
  -data="$BOLT_FDATA" \
  -reorder-blocks=ext-tsp \
  -reorder-functions=hfsort+ \
  -split-functions \
  -split-all-cold \
  -dyno-stats

echo ""
echo "    Optimized binary: $LIBXUL_BOLTED"

# --- Step 4: Install the bolted version ---
echo ""
echo "=== Step 4: Installing bolted libxul ==="

# Only mutate $LIBXUL in place when both it and its directory are writable
# (i.e. a mach objdir). A /nix/store target is read-only and root-owned, so an
# in-place cp/mv would fail with EROFS/EACCES — emit to a user-writable dir
# instead and never touch the store.
if [[ -w "$LIBXUL" && -w "$LIBXUL_DIR" ]]; then
  # Backup
  cp "$LIBXUL" "$LIBXUL_BACKUP"
  echo "    Backup: $LIBXUL_BACKUP"

  # Replace in place
  mv "$LIBXUL_BOLTED" "$LIBXUL"
  echo "    Replaced: $LIBXUL"

  # Size comparison
  ORIG_SIZE=$(stat --format='%s' "$LIBXUL_BACKUP")
  BOLT_SIZE=$(stat --format='%s' "$LIBXUL")
  echo ""
  echo "    Original size: $(numfmt --to=iec "$ORIG_SIZE")"
  echo "    BOLT size:     $(numfmt --to=iec "$BOLT_SIZE")"

  echo ""
  echo "=== Done ==="
  echo "    To revert: cp '$LIBXUL_BACKUP' '$LIBXUL'"
else
  # Read-only target (e.g. /nix/store): leave it untouched and stage the
  # bolted artifact somewhere the user can pick it up.
  OUT_DIR="${GJOA_BOLT_OUT:-$SCRIPT_DIR/bolt-out}"
  mkdir -p "$OUT_DIR"
  OUT_LIBXUL="$OUT_DIR/$(basename "$LIBXUL")"
  mv "$LIBXUL_BOLTED" "$OUT_LIBXUL"

  ORIG_SIZE=$(stat --format='%s' "$LIBXUL")
  BOLT_SIZE=$(stat --format='%s' "$OUT_LIBXUL")
  echo "    Target is read-only ($LIBXUL); store left untouched."
  echo "    Bolted libxul written to: $OUT_LIBXUL"
  echo ""
  echo "    Original size: $(numfmt --to=iec "$ORIG_SIZE")"
  echo "    BOLT size:     $(numfmt --to=iec "$BOLT_SIZE")"
  echo ""
  echo "=== Done ==="
  echo "    To use it, point your build/install at: $OUT_LIBXUL"
fi

# Cleanup intermediate files
echo ""
echo "    Intermediate files kept for inspection:"
echo "      $PERF_DATA"
echo "      $BOLT_FDATA"
