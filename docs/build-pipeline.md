# Build pipeline — what `gjoa dev` actually loads (and why it can look broken)

The one diagram to internalize. gjoa is **two independent artifacts** that get
built and refreshed on *very* different cadences. Most "my app looks broken /
icons missing / corrupt state" confusion is one of them being stale relative to
the other — almost never an actual code defect.

```
   ┌─────────────────────────── 1. THE BINARY (rare) ───────────────────────────┐
   │  C++/Rust/configure/version  ──mach build──▶  engine/obj-*/dist/bin/gjoa    │
   │  Lane 3 · 30–60 min · changes maybe weekly                                  │
   └────────────────────────────────────────────────────────────────────────────┘
                                       │ the binary embeds a STALE copy of chrome
                                       │ in omni.ja — but in dev we override it ↓
   ┌──────────────────────── 2. THE CHROME BUNDLES (constant) ───────────────────┐
   │  src/gjoa/chrome/**/*.bjs  ──tools:compile──▶  .beagle-out/*.js             │
   │       │                                                                     │
   │       └─chrome:dist─▶ dist/chrome/JS/*.uc.js  (the bundled, loadable JS)    │
   │                              │                                              │
   │                              └─chrome:install─▶ engine/obj-*/dist/bin/      │
   │                                                  gjoa-dev/  (symlink tree)  │
   │  Lane 1 · ~1 s · changes many times an hour                                 │
   └────────────────────────────────────────────────────────────────────────────┘
                                       │
            gjoa dev  ──(GJOA_DEV_LOADER=1)──▶ loads chrome from gjoa-dev/,
                                               NOT from the binary's omni.ja
```

**The launch glue** (`~/.local/bin/gjoa`, the `dev` case):
1. `sync_if_stale` — if anything under `src/gjoa/` is newer than `.gjoa-sync-stamp`,
   it runs `chrome:dist && chrome:install` to refresh `gjoa-dev/`. So **a normal
   `gjoa dev` launch picks up your latest chrome edits automatically.**
2. It exports `GJOA_DEV_LOADER=1` so GjoaLoader sources `gjoa-dev/` instead of the
   stale omni.ja baked into the binary.
3. It launches **detached against your DEFAULT profile** (`t3cvidst.default`) — no
   `-profile` flag.

## The trap: a long-lived instance loads chrome *once, at launch*

The chrome bundles are read **when the window opens**. If you launched `gjoa dev`
at 17:31, then edits/syncs land at 03:03, **the running window still shows the
17:31 chrome** — including any half-built state if a sync was mid-flight. It will
look broken even though HEAD is perfect.

→ **Fix: fully quit and relaunch `gjoa dev`.** The relaunch re-syncs and reloads.
This is the #1 cause of "it looks corrupt." (For chrome-only edits you don't even
need to quit — `gjoa sync` + restart is enough; no rebuild.)

## "My app looks broken" — recovery, in order

```
icons missing / layout corrupt / stale-looking?
│
├─ 1. Is a 10-hour-old instance still open?  ──▶ QUIT FULLY, relaunch `gjoa dev`.
│      (relaunch re-syncs current bundles)        Resolves ~all stale-chrome cases.
│
├─ 2. Still broken with a FRESH window?  ──▶ verify the BUILD is fine, headless:
│        bash tools/test-driver/chrome-gallery.sh --state default
│      Open /tmp/gjoa-gallery/default.png. Icons present there = build is good,
│      so the fault is your PROFILE, not the code → step 3.
│
├─ 3. Profile chrome-state stale (old toolbar layout persisted)?
│      Back up + reset ONLY the chrome window state — keeps history/bookmarks/tabs:
│        cp ~/.mozilla/firefox/t3cvidst.default/xulstore.json /tmp/xulstore.bak
│        rm ~/.mozilla/firefox/t3cvidst.default/xulstore.json
│      Relaunch. (Restores default toolbar/icon layout.)
│
└─ 4. Want a guaranteed-clean window without touching your daily profile?
         gjoa dev -f -no-remote -profile /tmp/gjoa-clean
       Throwaway profile, current bundles, foreground logs.
```

## How I verify visually now (so you don't have to QA)

`tools/test-driver/chrome-gallery.sh` launches the **same binary + same chrome
bundles `gjoa dev` uses**, headless+offscreen (can't touch your Wayland session),
drives Marionette in chrome context, and screenshots the chrome UI to
`/tmp/gjoa-gallery/<state>.png` for `default`, `flipped`, and `newtab`.

- It **syncs first** (unless `GALLERY_NO_SYNC=1`), so the gallery always reflects HEAD.
- `chrome-shoot.py --probe` also dumps a structural assertion (icons present, gjoa
  loaded, JS errors) — pixel colors are unreliable under the headless SWGL
  compositor (it can swap R/B channels — a blue urlbar photographs maroon), but
  **layout and icon presence are faithful**, and the probe covers structure.

This is the contract: **I render and eyeball the build before telling you it's
fixed.** You specify how it should look; I verify; you cut the release.
