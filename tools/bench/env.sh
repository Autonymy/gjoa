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
STATE_FILE="${GJOA_BENCH_STATE:-/var/tmp/gjoa-bench-env.state}"

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
  {
    echo "TURBO=$(read_turbo)"
    echo "GOVERNOR=$gov"
    echo "ASLR=$aslr"
  } > "$STATE_FILE"
  echo "Saved pre-run state to $STATE_FILE (governor=$gov, aslr=$aslr)"
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
  if [[ -f "$STATE_FILE" ]]; then
    # shellcheck source=/dev/null
    source "$STATE_FILE"
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
