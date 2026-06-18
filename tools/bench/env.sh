#!/usr/bin/env bash
# tools/bench/env.sh — Prepare machine for controlled benchmarking on NixOS/Linux.
# Must be run as root. Use --restore to undo changes.
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "ERROR: must be run as root (sudo)." >&2
  exit 1
fi

RESTORE=false
if [[ "${1:-}" == "--restore" ]]; then
  RESTORE=true
fi

# Persistent state file: the prepare and --restore invocations are separate
# processes, so in-memory snapshots don't survive. Stash the pre-run values
# here on the forward path and read them back on --restore.
#
# SECURITY: we run as root and read this file back, so it must live in a
# root-only directory (NOT a world-writable one like /var/tmp, where an
# unprivileged user could pre-create it). Default to a 0700 dir under /run,
# owned by root. The override is honored but the same ownership/permission
# checks below still apply before we trust the contents.
STATE_DIR="${GJOA_BENCH_STATE_DIR:-/run/gjoa-bench}"
mkdir -m700 -p "$STATE_DIR"
STATE_FILE="${GJOA_BENCH_STATE:-$STATE_DIR/gjoa-bench-env.state}"

GOV_FILE="/sys/devices/system/cpu/cpu0/cpufreq/scaling_governor"

# --- Turbo Boost ---

disable_turbo() {
  if [[ -f /sys/devices/system/cpu/intel_pstate/no_turbo ]]; then
    echo 1 > /sys/devices/system/cpu/intel_pstate/no_turbo
    echo "Intel turbo boost: disabled"
  elif [[ -f /sys/devices/system/cpu/cpufreq/boost ]]; then
    echo 0 > /sys/devices/system/cpu/cpufreq/boost
    echo "AMD boost: disabled"
  else
    echo "WARN: could not find turbo boost control"
  fi
}

enable_turbo() {
  if [[ -f /sys/devices/system/cpu/intel_pstate/no_turbo ]]; then
    echo 0 > /sys/devices/system/cpu/intel_pstate/no_turbo
    echo "Intel turbo boost: re-enabled"
  elif [[ -f /sys/devices/system/cpu/cpufreq/boost ]]; then
    echo 1 > /sys/devices/system/cpu/cpufreq/boost
    echo "AMD boost: re-enabled"
  else
    echo "WARN: could not find turbo boost control"
  fi
}

# --- CPU Governor ---

set_governor() {
  local gov="$1"
  for f in /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor; do
    if [[ -f "$f" ]]; then
      echo "$gov" > "$f"
    fi
  done
  echo "CPU governor: $gov"
}

# --- Snapshot / restore of pre-run state ---

# Read the raw turbo register value (or empty if neither control exists).
read_turbo() {
  if [[ -f /sys/devices/system/cpu/intel_pstate/no_turbo ]]; then
    echo "intel:$(cat /sys/devices/system/cpu/intel_pstate/no_turbo)"
  elif [[ -f /sys/devices/system/cpu/cpufreq/boost ]]; then
    echo "amd:$(cat /sys/devices/system/cpu/cpufreq/boost)"
  else
    echo ""
  fi
}

# Apply a turbo value previously captured by read_turbo (e.g. "intel:1").
write_turbo() {
  local saved="$1"
  case "$saved" in
    intel:*)
      if [[ -f /sys/devices/system/cpu/intel_pstate/no_turbo ]]; then
        echo "${saved#intel:}" > /sys/devices/system/cpu/intel_pstate/no_turbo
        echo "Intel turbo boost: restored (no_turbo=${saved#intel:})"
      fi
      ;;
    amd:*)
      if [[ -f /sys/devices/system/cpu/cpufreq/boost ]]; then
        echo "${saved#amd:}" > /sys/devices/system/cpu/cpufreq/boost
        echo "AMD boost: restored (boost=${saved#amd:})"
      fi
      ;;
    *)
      echo "WARN: no saved turbo value; re-enabling as fallback"
      enable_turbo
      ;;
  esac
}

# Capture turbo, governor, and ASLR into STATE_FILE before mutating.
snapshot_state() {
  local gov="schedutil"
  if [[ -f "$GOV_FILE" ]]; then
    gov="$(cat "$GOV_FILE")"
  fi
  local aslr
  aslr="$(cat /proc/sys/kernel/randomize_va_space)"
  # Create root-only (0600) and refuse to clobber a pre-existing file we did
  # not create (set -C / noclobber), so an attacker can't seed it first.
  rm -f "$STATE_FILE"
  (
    umask 077
    set -C
    {
      echo "TURBO=$(read_turbo)"
      echo "GOVERNOR=$gov"
      echo "ASLR=$aslr"
    } > "$STATE_FILE"
  )
  echo "Saved pre-run state to $STATE_FILE (governor=$gov, aslr=$aslr)"
}

# Validate that STATE_FILE is safe to read back as root: a real regular file
# (not a symlink), owned by root (uid 0), and not group/other-writable. Refuse
# otherwise — a file an unprivileged user can control must never be trusted by
# a root process. Returns non-zero on any failure.
validate_state_file() {
  local f="$1"
  # -O: exists and is owned by the effective uid (root here). -L excludes
  # symlinks; -f requires a regular file.
  if [[ -L "$f" ]]; then
    echo "ERROR: state file $f is a symlink; refusing to read." >&2
    return 1
  fi
  if [[ ! -f "$f" ]]; then
    echo "ERROR: state file $f is not a regular file; refusing to read." >&2
    return 1
  fi
  if [[ ! -O "$f" ]]; then
    echo "ERROR: state file $f is not owned by root; refusing to read." >&2
    return 1
  fi
  # Reject group- or other-writable files (mode bits 0022).
  local mode
  mode="$(stat -c '%a' "$f")"
  if (( 0$mode & 0022 )); then
    echo "ERROR: state file $f is group/other-writable (mode $mode); refusing to read." >&2
    return 1
  fi
  return 0
}

# Safely load the known keys from a validated state file WITHOUT sourcing it,
# so arbitrary shell embedded in the file can never execute. Only TURBO,
# GOVERNOR, and ASLR are recognized; everything else is ignored. Sets the
# corresponding shell variables in the caller's scope.
load_state_file() {
  local f="$1"
  local line key val
  TURBO=""; GOVERNOR=""; ASLR=""
  while IFS='=' read -r key val; do
    case "$key" in
      TURBO)    TURBO="$val" ;;
      GOVERNOR) GOVERNOR="$val" ;;
      ASLR)     ASLR="$val" ;;
    esac
  done < "$f"
}

# --- ASLR ---

disable_aslr() {
  echo 0 > /proc/sys/kernel/randomize_va_space
  echo "ASLR: disabled (randomize_va_space=0)"
}

enable_aslr() {
  echo 2 > /proc/sys/kernel/randomize_va_space
  echo "ASLR: re-enabled (randomize_va_space=2)"
}

# --- Filesystem caches ---

drop_caches() {
  sync
  echo 3 > /proc/sys/vm/drop_caches
  echo "Filesystem caches: dropped"
}

# --- Print state ---

print_state() {
  echo ""
  echo "=== Current state ==="
  if [[ -f /sys/devices/system/cpu/intel_pstate/no_turbo ]]; then
    echo "  Intel no_turbo: $(cat /sys/devices/system/cpu/intel_pstate/no_turbo)"
  elif [[ -f /sys/devices/system/cpu/cpufreq/boost ]]; then
    echo "  AMD boost: $(cat /sys/devices/system/cpu/cpufreq/boost)"
  fi
  local gov_file="/sys/devices/system/cpu/cpu0/cpufreq/scaling_governor"
  if [[ -f "$gov_file" ]]; then
    echo "  Governor (cpu0): $(cat "$gov_file")"
  fi
  echo "  ASLR: $(cat /proc/sys/kernel/randomize_va_space)"
  echo ""
}

# --- Main ---

if $RESTORE; then
  echo "Restoring pre-run settings..."
  if [[ -e "$STATE_FILE" ]]; then
    if ! validate_state_file "$STATE_FILE"; then
      echo "WARN: state file failed safety checks; applying safe defaults." >&2
      enable_turbo
      set_governor schedutil
      enable_aslr
      print_state
      echo "Done. Machine restored to normal operation."
      exit 0
    fi
    # Parse only the known keys; never source (no arbitrary shell execution).
    load_state_file "$STATE_FILE"
    write_turbo "${TURBO:-}"
    set_governor "${GOVERNOR:-schedutil}"
    if [[ -n "${ASLR:-}" ]]; then
      echo "${ASLR}" > /proc/sys/kernel/randomize_va_space
      echo "ASLR: restored (randomize_va_space=${ASLR})"
    else
      enable_aslr
    fi
    rm -f "$STATE_FILE"
  else
    echo "WARN: no state file at $STATE_FILE; applying safe defaults." >&2
    enable_turbo
    set_governor schedutil  # safe fallback when snapshot is missing
    enable_aslr
  fi
  print_state
  echo "Done. Machine restored to normal operation."
else
  echo "Preparing machine for benchmarking..."
  snapshot_state
  disable_turbo
  set_governor performance
  disable_aslr
  drop_caches
  print_state
  echo "Done. Machine is ready for benchmarking."
  echo "Run with --restore when finished."
fi
