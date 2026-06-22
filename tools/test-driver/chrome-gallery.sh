#!/usr/bin/env bash
# Visual self-test: render the gjoa CHROME UI (sidebar / tabs / drawer / urlbar /
# newtab) in canonical states, headless+offscreen, so a human (or I, the agent)
# can EYEBALL the actual build instead of pushing manual QA on the user. Same
# binary + the same chrome bundles `gjoa dev` loads (GJOA_DEV_LOADER=1) — it
# syncs the current src first, so the gallery always reflects HEAD.
#
#   bash tools/test-driver/chrome-gallery.sh                # default + flipped + newtab
#   bash tools/test-driver/chrome-gallery.sh --state newtab # one state
#   GALLERY_NO_SYNC=1 bash tools/test-driver/chrome-gallery.sh   # skip the chrome:dist sync
#
# Output: /tmp/gjoa-gallery/<state>.png. Colors are unreliable under headless
# SWGL (R/B channel swap); LAYOUT and ICON PRESENCE are faithful — use --probe
# (built into chrome-shoot.py) for structural assertions.
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BIN="$ROOT/engine/obj-x86_64-pc-linux-gnu/dist/bin/gjoa"
SHOOT="$ROOT/tools/test-driver/chrome-shoot.py"
PORT="${GALLERY_PORT:-2837}"
OUT="${GALLERY_OUT:-/tmp/gjoa-gallery}"
mkdir -p "$OUT"

[ -x "$BIN" ] || { echo "no mach dev binary at $BIN — build it first (gjoa import && gjoa build)"; exit 1; }

# Sync the current chrome bundles into the dev objdir (what `gjoa dev` does on
# launch), unless told to skip. Keeps the gallery honest about HEAD.
if [ -z "${GALLERY_NO_SYNC:-}" ]; then
  echo "=== syncing chrome bundles (chrome:dist + chrome:install) ===" >&2
  ( cd "$ROOT" && direnv exec "$ROOT" sh -c 'bun run chrome:dist && bun run chrome:install' ) >/dev/null 2>&1 \
    || echo "  sync failed — rendering last-synced bundles" >&2
fi

# Borrow the nix wrapper's runtime lib paths so the unwrapped mach binary finds
# GL/GTK/etc on NixOS (same trick the `gjoa dev` launcher uses).
NIXBIN="$ROOT/result/bin/gjoa"
if [ -r "$NIXBIN" ]; then
  LIBS=$(grep -oP "'/nix/store/[^']*'" "$NIXBIN" | tr -d "'" | sort -u | tr '\n' ':')
  export LD_LIBRARY_PATH="${LIBS%:}${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
fi

SP='const sp=Services.scriptSecurityManager.getSystemPrincipal();'
ADD2="$SP try{gBrowser.addTab(\"https://example.com/\",{triggeringPrincipal:sp});gBrowser.addTab(\"https://www.mozilla.org/\",{triggeringPrincipal:sp});}catch(e){}"

render() {  # name  "<extra prefs>"  "<chrome eval>"
  local name="$1" prefs="$2" eval_js="$3"
  local prof; prof=$(mktemp -d "$OUT/prof.XXXXXX")
  {
    echo 'user_pref("marionette.enabled", true);'
    echo "user_pref(\"marionette.port\", $PORT);"
    echo 'user_pref("browser.shell.checkDefaultBrowser", false);'
    echo 'user_pref("browser.startup.page", 1);'
    echo 'user_pref("browser.startup.homepage", "about:blank");'
    echo 'user_pref("toolkit.startup.max_resumed_crashes", -1);'
    echo 'user_pref("sidebar.verticalTabs", true);'
    echo 'user_pref("sidebar.revamp", true);'
    echo 'user_pref("gjoa.niri.enabled", false);'
    printf '%s\n' "$prefs"
  } > "$prof/user.js"

  for pid in $(ss -ltnp 2>/dev/null | grep ":$PORT " | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u); do kill -9 "$pid" 2>/dev/null; done
  env -u WAYLAND_DISPLAY -u DISPLAY MOZ_ENABLE_WAYLAND=0 GDK_BACKEND=x11 MOZ_HEADLESS=1 \
    GJOA_DEV_LOADER=1 GJOA_ALLOW_INSECURE=1 \
    "$BIN" -headless -no-remote -profile "$prof" -marionette -remote-allow-system-access about:blank \
    > "$prof/gjoa.log" 2>&1 &
  local gpid=$!
  local up=
  for _ in $(seq 1 80); do
    ss -ltn 2>/dev/null | grep -q ":$PORT " && { up=1; break; }
    kill -0 "$gpid" 2>/dev/null || { echo "$name: gjoa died — log tail:"; tail -8 "$prof/gjoa.log"; return 3; }
    sleep 0.5
  done
  [ -n "$up" ] || { echo "$name: marionette never came up"; kill -9 "$gpid" 2>/dev/null; return 3; }
  sleep 1
  python3 "$SHOOT" --port "$PORT" --out "$OUT/$name.png" --settle-ms 3500 --probe --eval "$eval_js" 2>&1 \
    | sed "s/^/[$name] /"
  kill -9 "$gpid" 2>/dev/null
  rm -rf "$prof"
  sleep 1
}

WANT="${2:-all}"
[ "${1:-}" = "--state" ] && WANT="$2"

do_state() { case "$WANT" in all|"$1") return 0;; *) return 1;; esac; }

do_state default  && render default  '' "try{window.resizeTo(1400,900);}catch(e){} $ADD2"
do_state flipped  && render flipped  'user_pref("sidebar.position_start", false);' "try{window.resizeTo(1400,900);}catch(e){} $ADD2"
do_state newtab   && render newtab   'user_pref("browser.startup.homepage","about:newtab");' \
  "try{window.resizeTo(1400,900);}catch(e){} $SP try{gBrowser.selectedBrowser.loadURI(Services.io.newURI('about:newtab'),{triggeringPrincipal:sp});}catch(e){}"

echo "=== gallery written to $OUT/ ===" >&2
ls -la "$OUT"/*.png 2>/dev/null >&2
