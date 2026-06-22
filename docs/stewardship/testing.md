# Test Suite Stewardship

> A slow, un-stewarded test suite is the single thing most likely to kill this
> project. gjoa is gigachurn: the suite runs constantly. So we steward it
> deliberately — **lean, robust, comprehensive, fast** — and we *track the
> stewardship itself* so we can see where effort stops paying off.

This is **policy**, not a suggestion. It is referenced from `CLAUDE.md` and
enforced by a preflight gate. Keep it green; keep it honest.

## The contract

Every integration test (`tests/integration/*.bjs`, real browser boot via
Marionette) has, in `configs/test-budgets.json`:

- **`category`** — its subsystem (mirrors `tests/integration/tags.json`).
- **`budgetMs`** — a realistic *lean* wall-time target. Not the current time —
  the time it *should* take if written without waste.
- **`note`** — optional: known optimization potential, or why it's inherently slow.

The profiler (`tools/test-driver/test-profile`) reads the duration **history**
(`.test-metrics/runs.jsonl`, written by `record-metrics`) and reports, per test:
`p50` / `p95` / `last` actual vs `budgetMs`, **flaky** (status varied or p95/p50 > 2),
and **regressed** (p50 crept above budget). It also enforces a **suite-total cap**.

## Leanness rules (how we judge a test)

1. **No fixed sleeps as synchronization.** `(sleep N)` is a smell — it pays the
   *worst-case* wait every run. Replace with `await-true` on the *real* condition
   (a DOM node, a pref, a state attribute). A short settle after a known async
   paint is the only acceptable fixed wait, and it must be justified in a comment.
2. **Minimize boots.** Each fresh page/tab/window load is ~1–2s. Share setup
   across assertions within a test; don't re-boot to check a second thing.
3. **One reason to exist.** A test asserts one behaviour. Redundant assertions and
   "while we're here" checks bloat wall time and blur failure attribution.
4. **Prefer the cheapest level.** Pure logic (keymap resolution, the editable
   predicate, colour math) is a **unit test** (`beagle test`, milliseconds) — NOT
   a browser boot. Integration tests are reserved for what genuinely needs a
   browser. Pushing logic down a level is the highest-leverage speedup.
5. **No silent flake.** A flaky test is worse than no test — it trains us to
   ignore red. Fix the race (await the real condition) or quarantine + file it.
6. **Comprehensive ≠ bloated.** Cover the behaviour, not every permutation;
   table-drive variants in one boot where possible.

## Modularity — tiered, local runs (do NOT run all 81 cases for a local change)

Running the whole suite on every change is the slow death. Tests are **tiered**
(in `configs/test-budgets.json`) and **categorized** (`tests/integration/tags.json`),
so you run only what your change can break:

| tier | what | when |
|---|---|---|
| **unit** | pure logic — keymap resolver, editable predicate, colour math — `beagle test`, **no browser** | every edit, ms feedback |
| **smoke** | the few core-sanity boots (`smoke`) | pre-commit, fast |
| **fast** | sub-2s integration (most tabs/spaces/newtab/urlbar) | the subsystem you touched |
| **slow** | render/measure-heavy (darkmode, adblock, contrast) | when you touch that subsystem, or pre-build |
| **network** | live-site tests (youtube/adblock-production) | opt-in only (`--lane network`) |

**Locality is the default, not the exception.** The runner already filters:

- `--files a,b` — exactly these.
- `--subsystem darkmode` — the subsystem (via `tags.json`).
- `--lane slow` / `--exclude-lane slow,network` — by tier.
- `--grep "rebind"` — by test name.

And `tags.json` maps **source dirs → subsystems**, so the right move after editing
`src/gjoa/chrome/bjs/dark-mode/` is the *darkmode* subset, never the full suite.
The full suite + `--lane network` is for pre-build / CI, not the inner loop. (A
`--changed` knob — `git diff` → source map → subset — is the next step; until then
pick the `--subsystem` for what you touched.)

## The audit (tracked over time)

We **audit** the whole suite on a cadence (and after any test-heavy change). The
audit re-profiles every test, re-estimates budgets, and finds the next
optimization. Crucially, **each audit is itself recorded** in
`.test-metrics/audit-ledger.jsonl` — one line per audit:

```
{ "date": "...", "suiteP50Ms": N, "overBudget": K, "flaky": F,
  "estSavingsMs": S, "topHits": [...], "note": "..." }
```

So we can see the trend: a falling `estSavingsMs` across audits means we're
hitting **diminishing returns** (the suite is near-optimal — stop polishing). A
rising `overBudget`/`flaky` means rot is creeping back (steward harder). The
profiler prints `since last audit: …` so every run is in context.

## Workflow

- `bun run test:profile` — profile vs budgets; prints the report, the
  diminishing-returns trend, and a non-zero exit if the suite or any test is over
  budget (the **hygiene gate**).
- `bun run test:audit` — a full audit: re-profiles, writes a fresh
  `audit-ledger` entry, and surfaces the top optimization candidates with
  estimated savings.
- When you add a test: give it a `budgetMs` in `configs/test-budgets.json` and a
  category. An un-budgeted test fails the gate (no test enters un-stewarded).

## Why this exists (don't delete it)

This is the anti-rot layer for velocity. The moment we stop measuring, the suite
slows by a thousand cuts and every future change pays the tax. Treat a budget
regression like a failing test — because it is one, just on the time axis.
