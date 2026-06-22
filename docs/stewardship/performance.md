## Performance — the stewardship domain

> **Thesis.** Win on the axis users actually feel, against the browser they
> actually run (stock Firefox 152). gjoa's perf wins are *structural* — they ride
> the engine's own paint pipeline and process model, not a per-frame JS tax we own
> and must defend against churn. Every budget is **measured or honestly marked
> unmeasured**; a regression past budget is a failure, same as a red test.

This is an anti-rot doc. It names the real instruments that hold the perf
posture green, and it is explicit about where a budget is enforced vs. where it
is only a discipline (the honest gaps are the point).

---

### 1. The three perf surfaces gjoa owns (and how they're kept honest)

| Surface | Where | Instrument | Budget kind |
|---|---|---|---|
| **Dark-mode legibility** (contrast + glare) | engine paint-time, `patches/0013` `GjoaDarkText.{h,cpp}`; actor `src/gjoa/.../content-classifier/GjoaDarkmode*.sys.mjs` | `tools/darkmode-regress/runner.bjs` (APCA Lc band) + `scorer.js` (coverage) | **measured**, gated nonzero-exit |
| **Suite wall-time** (dev velocity) | `tests/integration/*.bjs` | `tools/test-driver/test-profile.mjs` + `configs/test-budgets.json` | **measured**, gate exists, *not yet CI-wired* (§5) |
| **Page-load / runtime prefs** | `src/gjoa/defaults/pref/perf-prefs.bjs` | none yet — reasoned, not benchmarked | **honestly unmeasured** (§4) |
| **Patch fragility** (maintenance cost, not runtime) | `patches/*.patch` | `tools/prep/patch-cost.bjs` (`bun run cost`) | **measured** seam-cost |

---

### 2. Dark mode: a paint-time engine win, not a per-frame filter (the load-bearing perf decision)

The whole dark-mode perf posture flows from one rejected alternative. A
per-frame CSS `filter: invert()` / Dark-Reader-style overlay is **work gjoa
would own and pay every paint** — it fights the compositor, re-runs on every
scroll/reflow, and is a patch surface that rots per Firefox version. gjoa
instead does the solve **once, at style-resolution / paint time, inside the
engine** (`patches/0013 GjoaDarkText.{h,cpp}`, the M3 paint-time text solve;
luminance threshold `0.22` in `patches/0009`). Per `docs/darkmode-v2.md`: the
retone is *surfaces-frozen-then-text*, computed against the real backdrop, cached
at paint-time granularity — so the cost is amortized into the frame the engine
was already going to paint, not added on top of it.

Perf consequence: dark mode adds ~no per-frame steady-state cost. That is the
*reason* it's an engine patch and not chrome JS — the one case where Lane 3
native code is correct precisely because the cheaper Lane-1 version (a JS
overlay) would be the slower-at-runtime version. (Contrast the general doctrine
in `CLAUDE.md`: prefer chrome JS for *maintenance* cost — here runtime perf
overrides it, and the doc says why.)

**The legibility budget is APCA, and it is enforced.** `runner.bjs` boots a real
headless gjoa under Marionette with engine dark mode ON, navigates the
`corpus.json` site list (**227 sites**, `threshold: 45`), and per painted text
element computes `APCA Lc(text, median-backdrop)` via `drawSnapshot` (chrome-side,
Fission-safe — the content BC handle detaches under inversion, per the
Marionette content-ctx memory). The budget is a **two-sided band**, not a floor:
- **floor** ~Lc 45/60 — below = dark-on-dark, illegible → FAIL.
- **ceiling** ~Lc 90 (`:halation` count in `runner.bjs`) — *above* = glare/halation
  on the dark-adapted eye, the over-contrast metric a floor-only gate is blind to.

`runner.bjs` exits nonzero on any floor fail; `:painted` (text below floor *after*
the M3 paint solve) is the real legibility gate and should trend to ~0. The
profile measures **what ships** — `make-profile!` defaults `normalize.enabled
true` to match the shipped config (`GJOA_DM_NORMALIZE_PREF=0` to measure raw
engine). Fast iteration without a build: `tools/darkmode-regress/dm.sh` syncs the
loose actor/`darkmode-fixes.json` into `engine/` via the dist symlink (no
`import`, no `mach`), then `fastgallery.sh` renders in parallel.

---

### 3. Patch seam-cost: the maintenance-perf budget (`bun run cost`)

`tools/prep/patch-cost.bjs` turns the Lane doctrine into a **number**: each
patch's expected `rebases-broken-per-year ≈ rung_base × upstream-churn`.
- **rung_base** = seam-tier cadence by the highest-cadence file kind touched:
  native `.rs/.cpp/.cc/.h/.webidl` = **3.0** (conflicts per release), `.mjs/.js`
  overlay = **0.5** (per major version), build-wiring (`moz.build`/`jar.mn`) =
  **0.05** (~never).
- **churn** = commits touching each file in `~/code/reference/firefox` over the
  last year (`git log --since='1 year ago'`).

This is a *perf budget on our own maintenance throughput* — it ranks the
**10 patches** so demotion effort targets the costliest carriers first, keeping
us fast at *responding* to upstream churn (the second half of the thesis). The
dark-mode native patches (`0013`/`0009`) are deliberately the most expensive rows
here — accepted because their runtime win (§2) is worth the seam, and the cost is
*visible* rather than hidden.

---

### 4. Networking / runtime prefs: speed-positive, and honest about being unmeasured

`src/gjoa/defaults/pref/perf-prefs.bjs` is shipped as defaults (appended to the
branding pref file at import by `tools/prep/branding.bjs`). The load-bearing
posture, with the thesis baked into a comment:

> Firefox ships prefetch / DNS-prefetch / speculative-connect ON. They were being
> DISABLED here (lumped in with telemetry as a privacy nicety), which directly
> HURTS page-load — the opposite of gjoa's speed thesis. **Restored to Firefox
> defaults.** Minor privacy cost; speed wins.

So `network.prefetch-next=true`, `network.dns.disablePrefetch=false`,
`network.http.speculative-parallel-limit=6` — gjoa explicitly **refuses** the
common "privacy fork" net-pessimization. Other levers: large JS nursery + 4
parallel-marking GC threads, `dom.ipc.processCount=4`, WebRender + GPU-process +
HW video decode forced on, and telemetry/Pocket/Normandy/contile stripped (a real
boot-time + idle win).

**Honesty gate:** none of these prefs has a benchmark in-repo. They are *reasoned*
from the Firefox defaults + the power-user (32GB+) target, **not measured**. Per
the thesis, an unmeasured perf claim is marked unmeasured — these are a defensible
default posture, not a proven page-load win, until a load-time harness exists
(proposed in §6). Do not let "speed-positive" rot into an unfalsifiable slogan.

---

### 5. Suite wall-time: the velocity budget (measured, gate exists, CI gap)

A slow suite is the project's top velocity risk (`docs/stewardship/testing.md`).
Every integration test carries a **lean `budgetMs`** + `tier` in
`configs/test-budgets.json` (**44 budgeted**, `suiteBudgetMs: 134250`).
`record-metrics.bjs` tees the runner's NDJSON into `.test-metrics/runs.jsonl`;
`test-profile.mjs` reads that history and reports per-test `p50` vs budget,
flags `OVER` (p50 > budget × 1.15) and **un-budgeted** tests (no test enters
un-stewarded), excludes dead-binary runs (>50% fail) so a broken binary can't
poison the stats, and tracks the audit itself in `audit-ledger.jsonl` for the
diminishing-returns trend.

The leanness rule that dominates the budget: **no fixed sleeps as
synchronization** — `(sleep N)` pays worst-case every run; replace with
`await-true` on the real condition. The last audit (`lastAudit` in
test-budgets.json, 2026-06-22) found **~80s of fixed-sleep dead time** convertible
to `await-true`, dominated by `darkmode-hybrid` (-18s, a baked
`setTimeout(r,3500)` per painted read), `darkmode-invert` (-11s), `contrast`
(-10s). That hitlist is task #133.

**The honest gap.** `test-profile.mjs --gate` *exists* and `process.exit(1)`s on
any over-budget or un-budgeted test — but it is wired into **neither** preflight
gates A–S (`tools/scripts/preflight.bjs`) **nor** any `.github/workflows/`. Today
the wall-time budget is a *manual discipline* (`bun run test:profile` /
`test:audit`), not an enforced wall. Per the thesis it should be a gate; until it
is, treat it as measured-but-unenforced and run it before any test-heavy change.

---

### 6. The budget discipline (proposed, to close the gaps)

The rule, uniform across surfaces: **a perf number is measured or it is marked
unmeasured; a measured regression past budget is a failure, full stop.**

1. **Wire the velocity gate.** Add `test:profile --gate` as a preflight step (a
   new wall-time gate, sibling to A–S) and to the build CI. The gate already
   exists in `test-profile.mjs`; this is wiring, not new code. Closes §5.
2. **Land a page-load harness** so §4's prefs stop being unmeasured: a Marionette
   `performance.timing` / FCP capture over a fixed local-fixture corpus, with a
   a `perf-budgets` manifest (proposed — not yet created) mirroring `test-budgets.json`. Until then,
   perf-prefs claims stay tagged *reasoned, unmeasured* in this doc — do not
   upgrade the language.
3. **Keep `bun run cost` in the rebase loop.** After any Firefox bump, re-run it;
   a row whose seam-cost jumps means upstream churn moved under a patch — demote
   it to a `.sys.mjs` overlay or chrome JS if the change allows (Lane doctrine).
4. **Dark-mode budget is the model to copy:** real binary, real corpus, two-sided
   band, nonzero exit. Replicate that shape (boot → measure → band → exit) for
   every new perf surface rather than inventing a bespoke metric.

The anti-goal: a perf claim in marketing or a comment that no instrument backs.
If it isn't in `runner.bjs`'s APCA report, `test-profile`'s p50, or `patch-cost`'s
ranking, it is **unmeasured** — and this doc says so out loud.
