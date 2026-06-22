#!/usr/bin/env bash
# Launch gjoa for OFFSCREEN rendering that can NEVER reach the user's Wayland/niri
# session and can NEVER steal focus. Two independent guarantees:
#   1. -headless / MOZ_HEADLESS=1  -> no on-screen window exists at all.
#   2. WAYLAND_DISPLAY + DISPLAY unset, MOZ_ENABLE_WAYLAND=0, GDK_BACKEND=x11
#      -> even if something tried to map a window, there is no compositor to map to.
# Marionette still works headless (port 2828). Use this for ALL automated renders.
# Usage: offscreen-gjoa.sh <gjoa args...>   (e.g. -no-remote -profile DIR -marionette ...)
BIN="${GJOA_BIN:-/home/tom/code/gjoa/engine/obj-x86_64-pc-linux-gnu/dist/bin/gjoa}"
exec env -u WAYLAND_DISPLAY -u DISPLAY \
  MOZ_ENABLE_WAYLAND=0 GDK_BACKEND=x11 MOZ_HEADLESS=1 \
  "$BIN" -headless "$@"
