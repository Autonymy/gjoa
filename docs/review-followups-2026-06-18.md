# Review follow-ups — 2026-06-18 (overnight adversarial review)

A 28-agent adversarial review swept this session's new code (dark-mode hybrid,
scriptlet engine, tab fixes) + the deferred #40 audit bugs. Findings below are
**verified** (each cited file:line, adversarially re-checked). Applied items are
marked; the rest are deferred with precise fixes for a quick awake-pass.

## APPLIED autonomously (safe, low-risk)

- **B1 — dark-mode native-dark misdetection (CRITICAL, the "white background"
  bug).** `GjoaDarkmodeChild.sys.mjs` transparency regex
  `rgba?\([^)]*,\s*0…\)$` greedily matched the *blue* channel of opaque
  `rgb(0,0,0)`, so the most common dark bg was treated as transparent → page
  judged "not dark" → inverted to **white**. Fixed: require a real 4th alpha
  channel (`^rgba?\([^,)]*,[^,)]*,[^,)]*,\s*0…\)$`). Lane 1, zero test coverage
  to regress.
- **Cargo.lock --frozen fix.** `patches/0008` modified `content_classifier_engine/
  Cargo.toml` (added `serde_json`) without updating `Cargo.lock`; CI/nix
  re-extract pristine + `--frozen` → `cannot update the lock file`. Folded the
  1-line `serde_json` edge into `patches/0008` (forward-applies on pristine).

## DEFERRED — touch load-bearing tab code or are design choices (do awake)

- **B3 / #40 bug7 — uncancellable horizontal-grid rAF.** `tabs/rows.bjs:256`
  schedules a popout-positioning rAF whose handle is discarded;
  `clear-horizontal-grid` (`:312`) never cancels it. Rapid h→v→h double-toggle
  runs two passes (redundant work / brief flicker — the `(when (is-horizontal))`
  guard already prevents *wrong-orientation* application, so it is cosmetic).
  Fix: `cancelAnimationFrame` extern + `:grid-raf` counter; wrap the rAF in
  `(set! (.-grid-raf counters) (requestAnimationFrame …))`, reset to 0 at the
  top of the callback, cancel any prior before scheduling and at the top of
  `clear-horizontal-grid`. Validate with `tab-mode-toggle.bjs` after.
- **R1 / #40 bug5 — compact MutationObserver re-enters positionPanel.**
  `tabs/index.bjs:412-416` observer on `data-gjoa-compact`/`gjoa-has-hover`/
  `sidebar-launcher-expanded`; `compact.bjs` bursts those, each synchronously
  firing un-debounced `positionPanel` (which reads them back). DOM thrash, no
  infinite loop. Fix: rAF-coalesce — add a `request-position-panel` wrapper in
  `layout.bjs make-layout!` (one rAF/turn) and point the observer + pref
  observer at it; keep the initial direct `positionPanel` sync call.
- **R7 / #40 bug3 — spaceOf has no gjoa-id fallback.** `spaces/manager.bjs`
  `hydrate` tabSpaces loop (`:108-114`) silently drops entries whose tab can't
  be resolved at restore → those tabs strand in Main. Touches `spaceOf` →
  `reconcile-selection!`/`onActivated` → **spaces invariants**: must run spaces
  integration tests. Defer to awake.
- **R2 — hybrid: no SPA/soft-nav re-measure.** Child measures once at
  DOMContentLoaded (2× rAF). Client-rendered apps that paint their real theme
  post-hydration latch the wrong decision for the document's life (BC field is
  sticky). Plan item 6 specced a debounced re-measure; not yet built. Design
  choice — worth doing but changes WIP detection.

## CONFIRMED NON-ISSUES (no action)

- WebIDL `colorInversionOverride` attribute **is** present (patch 0009 line 133)
  — the per-site hybrid inversion is fully wired.
- `layoutCollapsed` is fully quarantined from persistence (written only in
  layout/rows; every snapshot path reads `.collapsed`). Mode-toggle fix intact.
- `reconcile-selection!` is a behavior-preserving extraction; spaces invariants
  hold. Non-group/group-source drag drops unaffected by the new group block.

## PERF (Lane 3 — needs rebuild + re-validate, not autonomous)

- R3/R5 — cosmetic `getUrlCosmeticResources` runs twice per document
  (`GjoaCosmeticParent` GetForUrl `:166` + GetScriptlets `:207`), ×subframes.
- R4 — 872 KB scriptlet JSON re-parsed per-engine on every `applyFilterLists()`
  under `mLock`. Clean fix (shared parsed storage) is a new FFI surface
  (single-thread `!Sync`).
- B2 — YouTube scriptlet double-injection (curated `YOUTUBE_PRUNE` + engine
  `+js`); redundant, not conflicting (uBO `set-constant` chains). Low severity.
