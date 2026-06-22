#!/usr/bin/env bash
# Render a diverse real-site corpus in a given gjoa dark-mode mode (real Xvfb window),
# score each with scorer.js, emit a graded table + thumbnails. Runs INSIDE Xvfb + .#mach.
# Usage (inside the wrapper):  bash gallery.sh <mode>     (default: dark)
cd /home/tom/code/gjoa
BIN=engine/obj-x86_64-pc-linux-gnu/dist/bin/gjoa
MODE="${1:-dark}"
OUT=/tmp/gallery; mkdir -p "$OUT"
SITES=(
  "github|https://github.com"
  "hackernews|https://news.ycombinator.com"
  "wikipedia|https://en.wikipedia.org/wiki/Firefox"
  "stackoverflow|https://stackoverflow.com"
  "reddit|https://www.reddit.com"
  "youtube|https://www.youtube.com"
  "bbc|https://www.bbc.com/news"
  "cnn|https://www.cnn.com"
  "amazon|https://www.amazon.com"
  "mdn|https://developer.mozilla.org/en-US/"
  "nytimes|https://www.nytimes.com"
  "example|https://example.com"
)
echo "=== gallery: mode=$MODE ==="
printf '%-14s %-7s %-7s %-7s %-6s %s\n' SITE COV MEDL* LEAK M VERDICT
for entry in "${SITES[@]}"; do
  tag="${entry%%|*}"; url="${entry##*|}"
  P=$(mktemp -d /tmp/gal-XXXX)
  cat > "$P/user.js" <<EOF
user_pref("gjoa.darkmode.enabled", true);
user_pref("gjoa.darkmode.mode", "$MODE");
user_pref("gjoa.darkmode.force", false);
user_pref("gjoa.darkmode.normalize.enabled", true);
user_pref("toolkit.startup.max_resumed_crashes", -1);
EOF
  GJOA_ALLOW_INSECURE=1 bash tools/test-driver/offscreen-gjoa.sh -no-remote -profile "$P" -marionette --remote-allow-system-access about:blank >/dev/null 2>&1 &
  BPID=$!
  for i in $(seq 1 40); do (exec 3<>/dev/tcp/127.0.0.1/2828) 2>/dev/null && { exec 3>&-; break; }; sleep 0.5; done
  python3 tools/test-driver/marionette_shot.py --port 2828 --url "$url" --settle-ms 14000 --out "$OUT/$tag.png" >/dev/null 2>&1
  kill "$BPID" 2>/dev/null; pkill -9 -f "$P" 2>/dev/null; wait "$BPID" 2>/dev/null
  bun tools/darkmode-regress/scorer.js "$OUT/$tag.png" 2>/dev/null | sed "s|$tag.png *||" | awk -v t="$tag" '{printf "%-14s %-7s %-7s %-7s %-6s %s\n", t, $1, $2, $3, $4, $5}' | sed 's/cov=//;s/medL\*=//;s/leak=//;s/M=//'
  rm -rf "$P"; sleep 1
done
echo "=== thumbnails: $OUT/*.png ==="