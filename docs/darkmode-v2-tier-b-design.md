# Dark-mode-v2 Tier b — no-FOUC + smarter engine (implementation-ready)

Tier 1 (curated registry + YouTube native-dark) is shipped. Tier b removes the
flash-of-white and raises the engine floor. **Lane 3 (engine rebuild).** It is
**all-or-nothing**: change (A) alone breaks the actor (see "Why all-or-nothing").

## The flash today (after Tier 1)
In hybrid mode a themeless page renders LIGHT, then ~2 frames later the actor
sets `colorInversionOverride="active"` and it goes dark. Tier 1's actor reset (to
`"none"` at document-start) made this re-measure happen on every navigation, so
themeless pages flash light→dark consistently. Native-dark pages are fine (they
render dark from frame 1).

## The core insight (dissolves the chicken-and-egg)
The servo color hook runs UPSTREAM of inversion: the pre-inversion AUTHORED color
flows through `Color::to_computed_color` before `invert_color_luminance`. So the
engine can sample the root/canvas background's *un-inverted* luminance at the
exact place it decides whether to invert — no circularity (it reads the input to
the hook, not its output). The JS actor cannot do this (getComputedStyle is
post-inversion); the engine can.

## The five coordinated changes

### (A) Hybrid defaults to inverted at the engine — `nsPresContext::UpdateColorInversion` (`nsPresContext.cpp:789`)
After the `Inactive` check, before the global-pref fallback: if the override is
`None` and `Preferences::GetBool("gjoa.darkmode.hybrid.default-invert", false)`,
return `true`. So a themeless top http(s) doc has `mColorInversion=true` at
construction — before first paint. "Start dark, maybe back off."

### (B) Pre-paint native-dark classification — `PresShell::Initialize` (`PresShell.cpp:1643`, after `ContentInserted` at `:1696`, before the paint-suppression block at `:1737`)
Call a new `nsPresContext::ClassifyAuthoredRootDarkness()`:
- Reads `FrameConstructor()->GetRootElementStyleFrame()` (exists here; same frame
  `DefaultBackgroundColorScheme` reads at `nsPresContext.cpp:1670`).
- Computes the **specified/authored** `background-color` (NOT the computed/
  inverted one — the specified value never went through `to_computed_color`).
- WCAG luminance test (`LookAndFeel::IsDarkColor`-style; threshold 0.22 to match
  the JS `#luminance`). Returns tri-state dark / light / unknown.
- If **dark** → set `mColorInversion=false` (retract; native-dark keeps its
  theme). If **unknown** → leave the default-invert (themeless-safe).

This runs BEFORE the paint-suppression timer arms, so the retraction lands before
the first cascade is painted — native-dark sites never have an inverted frame.

### (C) Canvas backstop honors inversion — `nsPresContext::DefaultBackgroundColor()` (`nsPresContext.cpp:1676`)
Currently returns `PrefSheetPrefs().ColorsFor(DefaultBackgroundColorScheme()).mDefaultBackground`.
Gate: when `ColorInversion()` is true AND `DefaultBackgroundColorScheme()==ColorScheme::Light`,
return the luminance-inverted light background (reuse the `RelativeLuminanceUtils::Adjust`
math from the servo `invert_color_luminance`, `color.rs:279`) — opaque (the
`LoadColors` opaque-force + `nsCanvasFrame` opacity assert require it). This one
function feeds `GetDefaultBackgroundColorToDraw` / `ComputeCanvasBackground` /
`ComputeBackstopColor`, covering both the suppressed-paint backstop and the
inter-page blank. `mColorInversion` is already correct here (UpdateColorInversion
runs in `nsPresContext::Init` before `Initialize`).

### (D) Share the invert math — `color.rs:279`
Factor `invert_color_luminance` so the C++ backstop (C) calls byte-identical math
(shared `RelativeLuminanceUtils::Adjust` / a small FFI). No behavior change to the
END-hook.

### (E) Chrome arm — `src/gjoa/chrome/bjs/dark-mode/index.bjs:70-86`
Add a real `hybrid` arm to `apply!`: `set-chrome-scheme! true`, `set-content-override! 0`,
`set-invert! false`, AND `set-pref-bool! "gjoa.darkmode.hybrid.default-invert" true`.
EVERY other arm (`off`/`engine`/`filter`/`:else auto`) must set it `false` so the
engine default never leaks into non-hybrid modes. Add the pref const near
`PREF-INVERT` (`:23`).

## Why all-or-nothing (do NOT ship A without B)
With (A) default-invert + Tier 1's actor reset: a native-dark page resets to
`none` → (A) makes `none`→invert → it renders inverted (light) → the actor
measures the inverted (light) result → decides `active` → stays inverted. So (A)
WITHOUT (B) inverts native-dark sites. (B) retracts pre-paint by reading the
AUTHORED bg, which the actor cannot. Ship A+B+C+D+E together.

## The actor's new role (refiner, not decider) — the LOAD-BEARING subtlety
The post-paint actor STAYS but is demoted to a refiner for cases the engine's
root-only classifier misses (dark bg on an inner wrapper, late JS theming,
per-site user overrides). CRITICAL: when the engine default is invert-on, the
actor must read the AUTHORED root luminance, NOT the inverted computed style, or
its detection breaks. Expose the engine's pre-inversion root luminance to the
actor via a readonly `BrowsingContext` field set during (B)'s classification, so
the actor never has to un-invert a computed read. Without this, flipping the
default to invert breaks the actor (research pitfall 2).

## Smarter algorithm (separable, also Lane 3)
Skip inverting images/video/canvas in the servo invert path (the blunt invert
currently mangles photos — the legacy filter path already counter-inverts media).
Lower-risk than the FOUC; can ship independently to raise Tier 0's floor.

## Build + validate
1. `bun run import` (engine compiles from `engine/`, not `src/gjoa`).
2. `bun run preflight` (gates A–I; the `gjoa preflight` wrapper currently points
   at a stale `.ts` path — use `bun run preflight`).
3. Full `./mach build` inside `nix develop .#mach`. Append outcome to BUILD-LEDGER.
4. Tests — extend `tests/integration/darkmode-hybrid.bjs` (the `/dark` fixture
   route already exists; the "actor keeps native-dark" assertion lands here, now
   deterministic because (B) decides pre-paint, no cross-nav circularity):
   - themeless paints inverted on FIRST paint (probe immediately, no rAF) — proves
     (A)+(C) at construction/Initialize, not the actor.
   - native-dark stays dark on first paint — proves (B) retracted pre-paint.
   - canvas/Canvas system-color backstop is dark for a themeless doc — proves (C).
   - actor refiner retracts an inner-wrapper-dark site the root classifier missed.
5. `nix build .#gjoa --impure` for the native binary.

## Runner-up (if `ClassifyAuthoredRootDarkness` proves unreliable at Initialize)
Keep (A)+(C), drop (B), extend the paint-suppression window by one style flush
(`nglayout.initialpaint.delay`) to do a synchronous pre-inversion root-bg check
before unsuppressing. Adds first-paint latency on the hot path; the recommended
approach decides within the existing pre-paint window with no added latency.

Full research: session workflow `wf_dabd653c` (FOUC) + `wf_ea21f849` (quality).
