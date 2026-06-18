# Dark mode per-site HYBRID — implementation plan (task #43)

Designed 2026-06-18 (verified against the repo). Goal: every site dark, each the
best way — native dark theme where the site has one, engine luminance-inversion
where it doesn't, decided **per-document**, with per-site overrides.

## Architecture

- **Per-document inversion lever:** a new synced BrowsingContext FIELD
  `ColorInversionOverride {None,Inactive,Active}`, modeled byte-for-byte on the
  existing `ForcedColorsOverride`. `nsPresContext::mColorInversion` consults it
  first; `None` → falls back to the global `gjoa.darkmode.invert.enabled` pref
  (today's behavior preserved). **Rust side needs zero changes** —
  `gecko.rs::color_inversion()` already reads `pc.mColorInversion` per-presContext.
- **Detection (chrome JS, one cascade behind — resolves the chicken-and-egg):**
  new `GjoaDarkmode{Parent,Child}` actor pair (sibling to `GjoaCosmetic*`). The
  `"hybrid"` mode forces `prefers-color-scheme: dark` (content-override=0) so
  native-dark sites self-engage. After first paint (`DOMContentLoaded` → 2× rAF)
  the child reads the *already-resolved* root/body background via
  `getComputedStyle`, computes WCAG luminance (Y < 0.22 = dark). Sites that stayed
  LIGHT (no native dark) get `colorInversionOverride = "active"` → one
  `JustThisDocument` recascade with inversion on. Native-dark → `inactive`/`none`
  (kept native, never double-darkened). The BC field is the latch between the two
  cascades; the engine never introspects a background mid-cascade.
- **P3 inverter completeness:** `color.rs:976-980` only inverts
  `ComputedColor::Absolute`; resolvable `color-mix()` / `ColorFunction` flow
  through un-inverted → "some gradient stops dark, some light." Extend that one
  hook block (~15 lines) to also invert fully-resolvable ColorMix/ColorFunction.
  Leave `CurrentColor` symbolic. box-shadow/gradient/SVG-paint already route
  through `to_computed_color` — no compound-longhand changes.
- **Per-site override:** prefs `gjoa.darkmode.user.{force-native,force-invert,off}`
  (comma host lists). Precedence `off > force-invert > force-native > auto`;
  `auto` ⇒ `hasNativeDark ? none : invert`. `cycleSite(host)` on
  `window.gjoaDarkMode`.

## File-by-file

**patch 0009 extension** (engine, Lane 3; mirror `ForcedColorsOverride` exactly):
1. `engine/dom/chrome-webidl/BrowsingContext.webidl` — `enum ColorInversionOverride
   {"none","inactive","active"}` + `[SetterThrows] attribute ColorInversionOverride
   colorInversionOverride;`.
2. `engine/docshell/base/BrowsingContext.h` — `FIELD(ColorInversionOverride, ...)`,
   getter, `CanSet`, `DidSet` decl (beside ForcedColorsOverride).
3. `engine/docshell/base/BrowsingContext.cpp` — `ParamTraits` (WebIDLEnumSerializer),
   `DidSet` body → `PresContextAffectingFieldChanged()`.
4. `engine/layout/base/nsPresContext.cpp` — `UpdateColorInversion` consults the BC
   field (Top()) before the pref; add `UpdateColorInversion()` in
   `RecomputeBrowsingContextDependentData` (beside `UpdateForcedColors()`).
5. `engine/servo/components/style/values/specified/color.rs` — extend the invert
   hook block to handle resolvable ColorMix/ColorFunction.

**patch 0008 extension:** `moz.build` `EXTRA_JS_MODULES` += `GjoaDarkmode{Parent,
Child}.sys.mjs` (engine/ is gitignored — CI needs the patch registration).

**Chrome (Lane 1):**
6. `src/gjoa/.../GjoaDarkmodeChild.sys.mjs` (NEW) — measure bg luminance post-paint
   (2× rAF), SPA re-measure (debounced), `Darkmode:Apply` → set
   `browsingContext.colorInversionOverride`.
7. `src/gjoa/.../GjoaDarkmodeParent.sys.mjs` (NEW) — trustedUrl, per-origin cache,
   override-pref precedence, decide invert/none.
8. `src/gjoa/browser/components/gjoa/GjoaLoader.bjs` — `register-darkmode-actor`.
9. `src/gjoa/chrome/bjs/dark-mode/index.bjs` — `"hybrid"` mode (force-dark,
   global invert off, per-tab field decides) + `cycleSite` + extend `cycle-mode`.
10. `src/gjoa/defaults/pref/dark-mode-prefs.bjs` — 3 host-list prefs.
11. `tests/integration/darkmode-invert.bjs` — fixtures A (themeless→inverted),
    B (native-dark→native, not double-darkened), C (override), + P3 micro-assert.

## Build order
import → preflight (gate A: patches apply) → **one full `./mach build`** (WebIDL +
IPDL FIELD + nsPresContext C++ + Rust color.rs all need it; `faster` insufficient)
→ BUILD-LEDGER → then Lane 1 iteration (threshold/timing/overrides) via gjoa sync.
