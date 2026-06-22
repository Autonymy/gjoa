# gjoa stewardship manifesto

> gjoa is a Firefox 152 fork carried by ~10 `patches/` + a `src/gjoa/` overlay
> against an upstream that refactors signatures every release. The only way a
> two-person fork survives that churn is to **own as little surface as possible**
> and to **respond to security/churn FAST by leveraging structure** — beagle
> types, the claim graph, structurally-anchored patches, the Lane 1/2/3 doctrine,
> and a wall of anti-rot gates. This doc is the index to that machinery. It is a
> *maintained* artifact, not marketing: every claim below names a real file, gate
> id, or tool. If a name here stops resolving, that is a bug.

## The one principle: stewardship artifacts are PROJECTIONS, never hand-lists

A hand-maintained list (of "security mitigations", "slow tests", "what each
patch depends on") rots the instant the code moves and the list doesn't. So gjoa
forbids that shape. Every stewardship artifact is either:

1. **Generated** from the code it describes — so it *cannot* lie; a drift shows
   up as a diff in a tracked file. (`configs/security-patches.json` is regenerated
   from patch `# security:` headers by `tools/security/patch-disclosure.bjs`; the
   correct current state is an empty list, and a dropped mitigation would appear
   as a tracked-file diff.)
2. **Gated** — a mechanical check (`tools/scripts/preflight.bjs`, Gates A–S)
   re-derives the assertion from current source on every preflight and fails
   *closed*. The list isn't trusted; the gate re-proves it. New failure modes get
   a new gate, never a line in a mental checklist (`preflight.bjs` header:
   "Gates are MECHANICAL. New failure modes get added here, not to a mental
   checklist that gets skipped.").
3. **A live query** over a claim graph — the codegraph projector
   (`tools/projector/codegraph.bjs`) parses gjoa's *emitted* chrome JS with acorn
   and answers `who-calls` / `blast-radius` / `leverage` from the real call graph,
   so "what breaks if I touch this" is computed, never remembered.

When you find yourself about to write down a fact the code already knows, stop:
make it a generator, a gate, or a query instead.

This tapestry obeys its own rule. `tools/stewardship/topology.mjs` generates
[`topology.md`](topology.md) — the gate registry + the docs↔machinery
cross-reference health — from `tools/scripts/preflight.bjs` and these docs, and
**Gate T** (`stewardship:check`) fails the build on a dangling reference or a
stale index. If a file/gate/tool named here stops resolving, preflight goes red;
the map cannot rot.

## The tapestry — four domains of concern

Stewardship is n-tier: distinct domains, each with its own machinery, all sharing
the projection-not-list discipline above. The per-domain docs are the deep dives;
this table is the map.

| Domain | The risk it answers | Stewarded by | Deep dive |
|---|---|---|---|
| **Security** | a Firefox vuln silently re-opens on a version bump; a mitigation we shipped silently rots | Gates **R** (code mitigations) + **S** (patch mitigations), `configs/security-mitigations.json`, generated `configs/security-patches.json`, `tools/security/{check,bump,patch-disclosure,audit-ledger}.bjs`, `bin/gjoa` staleness refusal | [`security.md`](security.md) |
| **Testing / maintainability** | a slow, flaky, un-budgeted suite taxes every future change to death | `configs/test-budgets.json` (tiered budgets), `tools/test-driver/test-profile.mjs` (actual-vs-budget hygiene gate + diminishing-returns trend), `.test-metrics/audit-ledger.jsonl`, `tags.json` locality | [`testing.md`](testing.md) |
| **Performance** | a perf flag silently no-ops (cc-wrapper strips `-march=native`), a build ships stale, PGO deadlocks | `private-docs/build-logs/` (append-only, postmortem-per-anomaly), perfFlags audit, Blacksmith CI runner topology | [`performance.md`](performance.md) |
| **Churn-minimization** | upstream refactors a signature and our patch/overlay breaks at compile time, three hours in | Gates **A/K/L/M/P/Q** + the Lane 1/2/3 doctrine + the codegraph projector + `src/gjoa/` overlay over native patches | [`churn.md`](churn.md) |

### Security — a shipped fix can't be deleted by accident

The threat model is *silent regression*: a `security:`-tagged patch stops applying
on a bump and the vuln re-opens with no error. Two gates make that unshippable.
**Gate S** (`security-critical patches persist`) treats a non-apply of any patch
carrying a `# security:` header as a HARD build-stop (not Gate A's ordinary
warn/drift), and fails *closed* if a declared `depends-on` anchor no longer
resolves. **Gate R** (`security mitigations intact`) guards the *non-patch*
mitigations via the per-mitigation manifest `configs/security-mitigations.json`:
every `mustMatch` source assertion must still hit, and for the cosmetic-filter
validator it *extracts the live `UNSAFE_SELECTOR` regex literal from source* and
re-tests it against a `mustReject`/`mustAccept` corpus — so the CSS-injection belt
can't be loosened silently. Cadence + SLAs live in
[`docs/security-policy.md`](../security-policy.md) (48h for an MFSA major,
same-day for an in-the-wild CVE); `bin/gjoa` refuses to launch a STALE/CRITICAL
binary. Both R and S are vacuously green when zero patches are security-tagged and
arm automatically the moment one is.

### Testing / maintainability — the suite is stewarded, and the stewardship is tracked

Policy lives in [`docs/stewardship/testing.md`](testing.md): every
integration test carries a `budgetMs` (a *lean* target, not its current time),
a `category`, and a tier (`smoke|fast|slow|network`) in
`configs/test-budgets.json`. `bun run test:profile` is the hygiene gate — it reads
the duration history (`.test-metrics/runs.jsonl`), reports p50/p95 vs budget,
flags `flaky`/`regressed`, and exits non-zero over budget. The meta-move that
makes this anti-rot: each audit is itself recorded in
`.test-metrics/audit-ledger.jsonl`, so a *falling* `estSavingsMs` across audits
proves diminishing returns (stop polishing) and a *rising* `overBudget` proves rot
is creeping back. An un-budgeted test fails the gate — no test enters un-stewarded.

### Performance — the ledger is the memory; postmortems are the gates' seed corn

`private-docs/build-logs/` is append-only, one row per real `nix`/`mach` build, and every
*unexpected* outcome gets a postmortem (trigger / why preflight missed it / new
gate to add / could it have been Lane 1). This is where the perf machinery is held
honest: it caught the cc-wrapper silently stripping `-march=native`
(`NIX_ENFORCE_NO_NATIVE=1` default → "Skipping impure flag"), the 3-week-stale
`engine/` shipping because `bun run import` was skipped (now Gate K), and the
PGO-vs-history-sqlite shutdown deadlock that no static gate could see. Real wins
recorded: O3 + full LTO + native-arch release flags, and the CI runner migration
to Blacksmith (Linux 130 → ~24 min, ~5.3x). The postmortem template is the feeder
for new gates — anomalies become mechanical checks so they never recur.

### Churn-minimization — own less, anchor structurally, stay in the cheap lane

This is the load-bearing thesis. The doctrine (`CLAUDE.md`) ranks every change by
patch-conflict cadence: chrome JS via `ChromeUtils.importESModule` conflicts
*never* (**Lane 1**, `gjoa sync`, sub-second); `.sys.mjs` overlays conflict per
major Firefox version (**Lane 2**); C++/Rust patches conflict per release because
Mozilla refactors signatures constantly (**Lane 3**). Always ask "can this be
chrome JS?" before writing a source patch. The gates catch a broken surface
*before* a 2–3h compile: **Gate A** (patches apply clean, cumulatively, on a fresh
tarball + WARNs on line-offset drift), **Gate K** (refuse to build if `src/gjoa/`
is newer than the last `import` — kills the stale-`engine/` class), **Gate L**
(a patch/overlay's declared `# depends-on:` upstream symbols still resolve in
`engine/` — catches a Rust path move / field removal *before* the compile),
**Gate M** (beagle compiler pinned), **Gate P** (patch hashes match the recorded
manifest), **Gate Q** (`$$bc` runtime export-closure: emit ↔ pinned `core.js`).
The codegraph projector turns "blast radius of this change" from a guess into a
query over the emitted-JS call graph.

## The topology generator

The tapestry's own structure — gjoa's chrome as a queryable relational graph — is
emitted, not drawn by hand. **`tools/projector/codegraph.bjs`** parses every
emitted `dist/chrome/JS/gjoa-<module>.uc.js` with acorn and projects it into Fram
claim triples:

```
bun run projector:codegraph -- emit --fram     # the graph as claim triples / fram log
bun run projector:codegraph -- leverage 20     # functions ranked by transitive blast-radius
bun run projector:codegraph -- blast-radius <fn>
```

It parses *emitted* JS (not `beagle callers`, which under-reports call sites inside
`(js/export …)` bodies and conflates same-named defs across files), so the graph is
complete and collision-free. Honest scope: it is the intra-module bare-call graph;
cross-module `window.gjoa*` dispatch is a separate edge type and future work
(macros are compile-time-inlined and correctly are not nodes). This is the same
machine that backs the projector's reflector/roundtrip gate (`projector:roundtrip`,
`projector:fram`) — the structural integrity check that the claim projection
round-trips back to source.

## How to add to the tapestry (the rule)

1. A new failure mode → a new **gate** in `tools/scripts/preflight.bjs` (lettered,
   mechanical), plus a `private-docs/build-logs/` postmortem if a build exposed it. Never a
   line in a checklist.
2. A new fact about the code → a **generator** (like `patch-disclosure.bjs`) or a
   **claim projection** (codegraph), so it's regenerable and a drift is a diff.
3. A new domain of concern → a `docs/stewardship/<domain>.md` deep dive + a row in
   the table above, backed by real machinery before it's documented.

Keep every gate green; keep every named path resolving. The day a stewardship
artifact has to be hand-maintained is the day it starts lying.
