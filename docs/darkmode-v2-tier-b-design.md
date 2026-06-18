# Dark-mode-v2 Tier b — no-flash hybrid (AS BUILT)

Tier 1 (curated registry + YouTube native-dark) shipped first. Tier b removes the
flash-of-light in the per-site **hybrid** mode by moving the dark/native decision
*before the first paint*, at the engine. **Lane 3 (engine rebuild).**

> This document was rewritten after implementation. The original plan was
> "default every page to inverted at construction, then *retract* native-dark
> pages by reading their (already-inverted) background and un-inverting it." A
> pre-build review killed that: the luminance inversion `Y -> 1-Y` is **not**
> losslessly reversible once channels clamp (saturated darks like navy/maroon),
> so recovering the authored luminance from an inverted read misclassifies them.
> The shipped design **flips the polarity** to avoid any recovery — see below.

## The flash, and why pre-paint is the only cure
A dark mode that may flash is easy (paint light, measure after paint, invert).
That is exactly Tier 1, and you see the white frames. "No flash" forces the
decision *before* the first paint — but whether a page is "already dark" is only
knowable *after* it has styled itself. We resolve that paradox inside Firefox's
existing **paint-suppression window** (the page is laid out but not yet revealed):
classify there, commit, then reveal. One render, no clone, no wait-for-settle.

## The core move (polarity flip — dissolves the chicken-and-egg)
In hybrid mode a top content document **starts un-inverted**. Its first cascade
therefore computes the page's **AUTHORED** colors (accurate — nothing went through
the inversion hook yet). At `PresShell::Initialize`, after the root frame exists
but before paint is unsuppressed, we read the authored root background:
- **themeless** (light or transparent ⇒ the UA white canvas shows) → flip the
  whole document to inverted, pre-paint, so it renders dark from frame 1.
- **native-dark** (authored luminance < 0.22) → leave it; it keeps its own theme.

No inverted-value recovery anywhere on the engine path: we read the authored color
directly because the first cascade was never inverted.

## The engine changes (patch `0009-dark-mode-engine-color-inversion.patch`)

### `nsPresContext` — the flip + a durable bit
- `mHybridDefaultInvert` (member): the pre-paint classification result. Durable so
  it survives later `UpdateColorInversion` re-derives (BC field changes, etc.).
- `UpdateColorInversion` precedence (unchanged head, new tail): override `Active`
  → invert; override `Inactive` → don't; else `if (mHybridDefaultInvert) invert`;
  else the global `gjoa.darkmode.invert.enabled` pref. The hybrid pref does **not**
  force inversion at construction — that is what keeps the first cascade authored.
- `ApplyHybridDefaultInvertIfThemeless()` (new): returns early if already inverting
  / pref off / an explicit override already decided; reads
  `nsCSSRendering::FindEffectiveBackgroundColor(rootStyleFrame, /*stopAtThemed*/true,
  /*preferBodyToCanvas*/true)`; if transparent or `RelativeLuminanceUtils::Compute
  (bg) >= 0.22` (themeless) sets `mHybridDefaultInvert=true` and calls
  `UpdateColorInversion(true)` → flips `mColorInversion` + restyles pre-paint.
- `DefaultBackgroundColor()`: when inverting a light-scheme document, returns the
  luminance-inverted canvas background (`RelativeLuminanceUtils::Adjust(bg,
  1-Compute(bg))`) so the canvas backstop / inter-page blank is dark, not white.

### `PresShell::Initialize`
One call: `mPresContext->ApplyHybridDefaultInvertIfThemeless()`, placed after the
root `ContentInserted` block, before `MaybeScheduleRendering` and the paint-
suppression setup. The restyle it posts flushes before the first paint (Gecko
flushes style before paint within a refresh tick; paint is also suppressed here).

## The chrome arm (`src/gjoa/chrome/bjs/dark-mode/index.bjs`)
The `hybrid` mode arm sets `gjoa.darkmode.hybrid.default-invert` true (plus
`prefers-color-scheme: dark` via content-override 0, so native-dark sites that key
on the media query activate). Every other mode (`off`/`engine`/`filter`/`auto`)
sets it false, so the engine flip never leaks outside hybrid.

## The actor (refiner, not decider) — `GjoaDarkmode{Parent,Child}.sys.mjs`
The engine is the primary classifier now. The actor does two things on top:
- **document-start (DOMWindowCreated):** ask the parent for an EXPLICIT curated
  decision (fix registry / user per-site pref) and apply its `override` + `css` +
  `inject` immediately, so curated sites (YouTube `html[dark]` + a `#0f0f0f` USER
  sheet) are correct from frame 1. The reset-to-`none` here clears any inherited
  override so a fresh same-tab navigation re-classifies cleanly. The explicit work
  is stored as a promise the DOMContentLoaded path awaits, so the refiner can never
  race the curated decision.
- **post-paint (DOMContentLoaded), refiner:** only for non-explicit sites. Samples
  the body/root background, probing the live inversion state (white→black AND
  black→white swatches) to read it the right way round, and retracts the engine's
  invert (`override:"inactive"`) for a site that turned out dark via **late**
  JS/CSS theming the pre-paint check ran too early to see. Best-effort, threshold-
  based — the engine is the precise classifier.

## Known limitations / follow-ups
- **Curated attribute-gated sites (e.g. YouTube)**: a ~1-IPC window where the
  engine flip runs before the child's async `override:"inactive"` lands → a brief,
  self-correcting double-dark. Fix: seed the curated override pre-layout from a
  parent-process host check (task #49).
- **Late-theme non-curated sites**: handled by the post-paint refiner with a brief
  flash (same as Tier 1, no regression); the refiner's luminance flip is a coarse
  threshold, not exact.
- **Policy layer (task #48)**: discrete modes should become escape hatches; the
  default should follow the system theme (system dark → hybrid engages). This sits
  on top of the Tier-b mechanism.

## Validation
`tests/integration/darkmode-hybrid.bjs`: (1) engine default-invert darkens a
themeless page; (2) a native-dark (`/dark`, authored `#111`) page keeps its theme
(root stays dark + an injected white box stays white ⇒ inversion was not applied).
Plus the P0/P1/P2 global-invert tests in `darkmode-invert.bjs` (unaffected:
`default-invert` defaults off).
