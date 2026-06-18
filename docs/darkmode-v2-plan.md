# Dark-mode v2 — tiered resolver (curated → biased → general)

Synthesised from two research passes (FOUC + quality/registry). Direction set by
the user: **curated fixes first, biased algorithm where we have hints, general
engine inversion as the catch-all fallback.**

## Tier 0 — engine inversion (SHIPPED, patch 0009)
WCAG luminance flip at `Color::to_computed_color`, per-document via
`BrowsingContext.colorInversionOverride` → `nsPresContext::mColorInversion`. Zero
per-frame cost. The universal fallback / long tail. "Blunt but consistent."

## Tier 1 — curated per-site CSS fixes registry  ← BIGGEST WIN, Lane 1 (no rebuild)
For sites the inverter gets ~90% right but a logo inverts wrong / a CSS-variable
theme (YouTube) looks muddy. A per-host CSS snippet is injected as a `USER_SHEET`
on top of (or instead of) the engine inversion.

- **Source:** Dark Reader's `reference/darkreader/src/config/dynamic-theme-fixes.config`
  — **MIT-licensed** (clear to vendor; retain the notice). 732 KB / ~2,800 sites;
  bundle a **curated top-N** (~50–150 high-traffic sites, tens of KB).
- **Transform (build-time, a `tools/prep/` script):** resolve Dark Reader's
  `${color}` templates to constants (their `${}` is computed by their JS engine;
  we pre-resolve to plain CSS since our engine already provides the inverter
  base). Substitute `--darkreader-neutral-*` vars with gjoa's fixed palette
  (`#181a1b` bg / `#e8e6e3` text). Drop `IGNORE IMAGE ANALYSIS` / `IGNORE CSS URL`
  (no-ops for us). Emit a committed gjoa data file (do NOT fetch at runtime).
- **Injection:** reuse `GjoaCosmeticChild.rebuildSheet`'s pattern verbatim —
  `win.windowUtils.loadSheetUsingURIString("data:text/css,…", USER_SHEET)`
  (see `GjoaCosmeticChild.sys.mjs:62-82`). Wire it into the `GjoaDarkmode` actor:
  the Parent's `#decide` also looks up the host in the registry and returns
  `{override, css}`; the Child injects `css` once and, for fix sites, sets
  `colorInversionOverride="inactive"` so the engine does NOT also invert (the
  fix owns the colors).
- **Directive mapping:** `CSS` → the pre-resolved sheet body (the bulk);
  `INVERT` selectors → `sel{filter:invert(1) hue-rotate(180deg)}` (counter-invert
  dark logos); `IGNORE INLINE STYLE` → `sel[style]{…!important}`.

### YouTube — first worked example
Dark Reader does **not** whole-page-invert YouTube (that's our current "rough"
result). Its fix = 2 `INVERT` selectors (third-party dark icons) + one big `CSS`
rule overriding ~200 `--yt-*`/`--ytd-*` custom properties to dark values
(`dynamic-theme-fixes.config:38807`). Likely root cause of today's roughness:
YouTube's own dark theme isn't reliably triggered by forced
`prefers-color-scheme:dark`, so the actor measures light → engine-inverts → muddy.
The registry CSS sets `override="inactive"` + supplies the dark variables → "right."

## Tier 2 — bespoke full dark themes (curated, tiny)
For flagships where inversion is fundamentally wrong (heavy brand color,
photo-forward). Hand-authored complete restyle, same USER_SHEET path,
`override="inactive"`. Promote a few at a time (mirrors the "don't port wholesale"
anti-goal). Userstyles.org is inspiration only — heterogeneous/restrictive
licensing, so NOT vendored.

## Tier (b) — smarter engine + no-FOUC  (Lane 3, one rebuild; raises Tier 0's floor)
1. **No flash-of-white.** Decide invert-vs-not BEFORE first paint. The servo color
   hook runs UPSTREAM of inversion, so we can sample the **authored (un-inverted)**
   root background — no chicken-and-egg. Three coordinated changes (extend patch
   0009): (a) hybrid defaults `mColorInversion=true` for top http(s) docs via a
   `gjoa.darkmode.hybrid.default-invert` pref read in `UpdateColorInversion`;
   (b) pre-paint native-dark classification in `PresShell::Initialize` (after the
   root frame is built, before the paint-suppression timer arms) reading the
   authored root bg luminance → set `mColorInversion=false` for native-dark sites;
   (c) inversion-aware canvas backstop in `nsPresContext::DefaultBackgroundColor()`
   so the inter-page blank + suppressed paint are dark, not white.
   Eliminates flash in BOTH directions; the post-paint actor becomes a refiner.
2. **Algorithm bias** (optional): role-aware clamps, skip images/video/canvas in
   the engine path (we already counter-invert media in the legacy filter path).

## Sequencing
1. **Tier 1 mechanism + YouTube** (Lane 1, no rebuild) — highest quality-per-effort,
   fixes the user's active pain. The injection wiring + the YouTube entry +
   extend the `GjoaDarkmode` actor.
2. **Registry transform tool + top-N curated set** (Lane 1) — broaden coverage.
3. **Tier (b) FOUC + smarter engine** (Lane 3) — batch into one mach build.
4. **Tier 2 bespoke** — ongoing, a few sites at a time.

Research outputs: `wf_ea21f849` (quality/registry) + `wf_dabd653c` (FOUC) — full
designs in the session transcript.
