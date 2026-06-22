_Anti-rot doc. The core fork-survival concern: minimizing the cost of tracking Firefox 152 upstream. Grounded in the real artifacts under `patches/`, `tools/prep/`, `tools/scripts/preflight.bjs`, and `gjoa.json`. If the code below diverges from these files, the code is right — fix the doc._

## The problem

gjoa is a Firefox 152.0.1 fork (`gjoa.json` → `firefox.version`). Mozilla ships a new release ~monthly and refactors constantly: methods move modules, struct fields get removed, JS object properties get deleted, signatures change. Every edit gjoa owns against that moving tree is a liability that has to be re-rolled when upstream churns under it. The fork survives by **owning the smallest, cheapest-to-maintain surface possible**, and by **seeing churn coming before it costs a build** (a Lane 3 mach/nix compile is 30–60 min; a `.rej` discovered mid-compile burns the whole thing).

The surface we own today: **10 `patches/`** (against Mozilla source) + the `src/gjoa/` overlay (chrome JS + the `GjoaLoader.bjs` ESM loader) + pinned `beagle`/`fram` toolchain deps. The discipline below keeps that surface from rotting.

## The Lane doctrine — conflict cadence is a function of seam depth

The organizing principle (CLAUDE.md, "Lane classification" + Hard rule 3). Patch-conflict frequency rises monotonically with how deep into native code an edit reaches:

| Lane | Seam | Conflict cadence | Iteration cost |
|---|---|---|---|
| **1** | chrome JS/CSS via `ChromeUtils.importESModule` | **~never** | `gjoa sync` + restart, ~1 sec, no rebuild |
| **2** | `.sys.mjs` overlay / patch / branding | **per major Firefox version** | `mach build faster`, ~30 sec |
| **3** | C++/Rust/WebIDL source patch | **per release** (Mozilla refactors signatures every cycle) | full mach or nix, 30–60 min |

The doctrine is **demotion**: always ask "can this be done in chrome JS?" before writing a source patch, and within Lane 3 prefer `.sys.mjs` overlays over Mozilla-source C++/Rust. Chrome JS conflicts ~never because it rides a stable `ChromeUtils` API surface; a source patch conflicts every release because it's anchored into code Mozilla rewrites freely. **Every step shallower divides the expected rebase rate.**

The current patch set, classified by seam (from each patch's `# touches:` header):

- **build** (~never conflicts): `0001` (moz.build include), `0007` (enable-sqlite-fts5)
- **sys.mjs** (per major): `0002` (glue → loader import), `0011` (newtab redirector)
- **native-src** (per release — the costly carriers): `0008` (cosmetic-filter content-classifier), `0009`/`0010`/`0012`/`0013`/`0014` (the dark-mode engine-inversion stack — `.rs`/`.cpp`/`.h`/`.webidl`)

The six dark-mode native patches are exactly the population the demotion strategy targets first. That's not a guess — it's what the scorer below outputs.

## Turning the doctrine into a number — `tools/prep/patch-cost.bjs`

`bun run cost` makes "which patches are costliest" measurable instead of intuited. For each patch it computes:

```
seam-cost  =  rung_base  ×  upstream_churn
```

- **`rung_base`** — the Lane cadence multiplier, inferred from the highest-cadence file kind the patch touches: native `.rs/.cpp/.cc/.h/.webidl` = **3.0**, `.mjs/.js` = **0.5**, build-wiring (moz.build/jar.mn) = **0.05** (`rung-base`, patch-cost.bjs:33).
- **`upstream_churn`** — commits touching each declared file in `~/code/reference/firefox` over the last year (`churn`, patch-cost.bjs:20, shells `git log --since='1 year ago'` against the mozilla-central clone).

The product approximates **expected rebases-broken-per-year**, and the report ranks descending so demotion effort targets the costliest carriers first. The rung multipliers encode the Lane doctrine's cadence claim directly (native = 6× a sys.mjs seam, 60× a build seam).

## Seeing it coming before the build — `tools/prep/conflict-forecast.bjs`

Before committing to a Firefox bump, `bun run forecast [from] [to]` intersects the **upstream delta** (files Mozilla changed between two release tags) with the files gjoa's patches touch — **no download, no build**:

1. Resolve `from` (gjoa.json) / `to` (latest stable via `product-details.mozilla.org`) to Mozilla release tags. `version->tag` (conflict-forecast.bjs:26) hard-rejects any string that isn't `^[0-9]+(\.[0-9]+){1,3}(esr)?$` — these flow from the network and gjoa.json into a `git` shell-out, so the regex is a command-injection guard.
2. `git diff --name-only <from-tag> <to-tag>` against the reference clone = the changed-file set.
3. For each patch, intersect its `# touches:` files with the delta; report affected patches **ranked by seam tier** (review `native-src` first).

Output is either `CLEAN — all patches apply unchanged` or the blast-radius list. Validated against the real `152.0 → 152.0.1` bump: fully disjoint → clean. This converts "will this bump hurt?" from a 45-min gamble into a sub-second read. (Precise per-symbol blast-radius ranking via the fram call graph is the deferred turtle; v1 ranks by tier, which needs no graph.)

## Is the patch set coherently ordered? — `tools/prep/patch-order.bjs` (Gate U)

The patch *numbers* carry a latent theory: they ascend by **engine depth** — chrome (`browser/`) → third_party → toolkit → engine (`layout/servo/docshell`). `patch-order.bjs analyze` derives that grouping from the diffs (no hand-list) and answers "optimally ordered/batched?" mechanically:

- **file-overlap components** — patches sharing a touched file are the *only* hard ordering constraints. Alpha-apply already satisfies them, so the order is **apply-sound by construction**; batching is the open question.
- **domain runs** — sorted by number, each subsystem should form one contiguous run. A domain appearing in two non-adjacent runs = a foreign patch wedged into another's block (a comprehension/rebase smell).
- **minimal renumber** — the fix is a longest-increasing-subsequence over the canonical-order number sequence: the LIS is the largest already-correct run; its complement is the minimal set to move into free gap slots. On today's set it finds exactly one defect — `0011-newtab` sits inside the dark-mode/engine block (0009–0014) — and one move (`0011 → 0003`) that heals it.

**Gate U** (`preflight.bjs`, WARN) runs `patch-order check` and warns on a split domain — advisory, because numbering is batching, not correctness. `renumber --apply` executes the move (rename + rekey `configs/patch-hashes.json`, content-preserving); deferred when a build is in flight or the shared worktree is hot.

## Content-addressing the seam — `tools/prep/upstream-provenance.bjs` (Gate V)

`baseline-firefox: 152.0.1` is a *version label*. The sharper question is: has the upstream file this patch cuts into changed **byte-for-byte** since we validated it? Git already content-addresses every file by blob OID, so we don't hash anything — we **record which content we validated against** and let git's object DB do the differential.

`provenance lock` writes `configs/upstream-provenance.json`: for each patch, the blob OID of every file it touches, at the baseline FF tag (`FIREFOX_152_0_1_RELEASE`). `provenance check [ref]` recomputes against any ref:

- **OID identical** → that patch's context *provably cannot* have rotted → skip it with certainty.
- **OID differs** → surface it, ranked native-first (potential conflict).
- **OID vanished** → the file moved/deleted upstream → the patch *will* fail (highest alert).
- **`"absent"`** → a file gjoa *creates* (no upstream context); checked for the inverse — did Mozilla start shipping a colliding file at our path?

This is strictly finer than the release-tag forecast: baseline-anchored, works against **any** commit (nightly / arbitrary SHA, not just tags), and a per-file mathematical guarantee. **Gate V** runs integrity mode (lock vs its own baseline tag) — asserting the lock still describes the current patch surface at the declared baseline; skip-aware (FF clone is dev-only) and WARN-level.

### The galaxy-brain play — the blob OID is a coordinate in Mozilla's history

Once a patch's baseline is a content OID instead of a version string, each layer reuses git's existing machinery for a compounding win:

1. **Provable skip-set** (shipped) — most patches are untouched on any given bump; prove it and shrink the audit to the truly-affected set.
2. **Hunk-anchor precision** (next) — hash only the lines a hunk's context depends on, not the whole file: a file edited *elsewhere* than where we cut stays provably-safe (kills false positives).
3. **Blame-locator** — when an anchor *did* move, `git log -L`/`blame` the FF clone names the exact upstream commit (author, date, bug, message). A conflict stops being "this file changed" and becomes "Mozilla commit abc123 touched your anchor — here's why."
4. **3-way at the anchor** — the lock hands you the baseline blob for free (`git cat-file <oid>`); with baseline + new-upstream + our-patched, an anchor-local 3-way merge is mechanical, escalating to human only on real conflict.
5. **Baked provenance identity + security cross-check** — fold the lock's aggregate hash into the binary (supply-chain: built against *unmodified* Mozilla blobs); and cross-reference the `# security:` manifest — if upstream's blob at a mitigation's anchor changed, Mozilla may have fixed it themselves (drop the patch) or refactored around it (re-verify). That's the rebase-survivability question from the resilience audit, answered by lookup.

We are not building a hashing system — we are harvesting the one Mozilla already maintains. "Is this patch still valid?" becomes a lookup; "what changed and why?" becomes a graph walk.

## Anchoring against churn, not line numbers

Two layers protect the surface from *silent* loss when upstream moves:

### Gate L — surface contracts (`preflight.bjs:372`, `tools/prep/symbol-resolve.bjs`)

A patch/overlay often **depends on** upstream symbols it references but does not patch — a Rust path, a generated style-struct accessor, a JS object property. `git apply` (Gate A) is blind to these: they're added tokens, not context, so an upstream MOVE/REMOVAL passes apply clean and then either dies 26 min into the compile (the `ComputedValueFlags` module move; the `background_image` field removal) or ships a **silent no-op** (FF152 deleting `AboutNewTab.newTabURL`).

The fix: a patch declares its non-patched dependencies in a `# depends-on:` / `;; @gjoa-depends-on` block, and Gate L resolves each against the extracted `engine/` tree **before** the build. The contract vocabulary (`parse-depends-on`, symbol-resolve.bjs:193): `rust-path`, `rust-field`, `rust-method`, `cpp-symbol`/`-method`/`-field`/`-member`, `webidl-attr`, `js-prop`. Each resolver is cheap (rg/fs class, no build) and returns `resolved` / `not-found` (RED, hard fail) / `ambiguous` (cfg-gated/deep-glob/no-objdir → warn, **never** a false green). Five patches carry live `depends-on` contracts today — e.g. `0009` declares `rust-path crate::computed_value_flags::ComputedValueFlags`, the exact anchor whose module-move would otherwise blow up mid-compile.

This is the structural complement to the seam-cost scorer: cost tells you *which* native patch is fragile; Gate L tells you *the moment* its anchor actually moved.

### Structural patch anchoring — the projector (`docs/why-beagle.md`)

A textual `.patch` is anchored to line numbers and surrounding context; when Mozilla reflows or renames around a hunk it `.rej`s. gjoa's **projector** (`tools/projector/`) expresses selected edits as **claim-docs** — JSON verbs like `set-body`, anchored by *structural identity* (parameter list, ordinal, body identifiers) **not by line**. When the source moves, the claim-doc re-locates its target by identity and re-applies; anchor-recovery survives reflow *and* a method rename. CI-gated: `bun run projector:test` Gate A round-trips the `.sys.mjs` corpus byte-identically; Gate B proves `patches/0011-newtab-redirector-gjoa.claims.json` reproduces its textual patch output exactly. **The payoff: a patch you can't silently lose to an upstream refactor.**

## Pinned toolchain — churn isolation on the authoring side

Upstream churn isn't only Mozilla's. The `beagle` compiler and `fram` engine are dependencies that move too, and a compiler emit/runtime skew silently broke chrome four serial times. So gjoa **freezes** them:

- `configs/beagle.ref` pins beagle to SHA `9d791ed` — **compiler and runtime**. A dedicated worktree at `~/code/beagle-pin` (never the shared `../beagle`, which is concurrent-agent-shared) supplies the compiler via `PLTCOLLECTS`, and `core.js` is vendored from the same ref. **Gate M** (`preflight.bjs:410`) is a HARD FAIL on drift — a warn here is what let the four breaks ship.

This means Firefox churn and beagle churn are **decoupled**: a Firefox bump can't move the compiler, and a beagle bump is a deliberate, reviewed event (re-point worktree → re-import → re-vendor), never an ambient surprise.

## The standing strategy, in one line per lever

1. **Demote toward chrome JS.** Lane 1 conflicts ~never; every demotion divides the rebase rate. The six dark-mode native patches are the named demotion backlog (`bun run cost` ranks them).
2. **Prefer overlays over source.** Within Lane 3, `.sys.mjs` overlays conflict per major version; C++/Rust per release.
3. **Anchor structurally.** Gate L declares the non-patched dependencies; the projector anchors edits by identity, not line. Upstream can't silently lose either.
4. **Forecast before you build.** `bun run forecast` intersects the upstream delta with the patch surface for free — no `.rej` discovered 26 minutes into a compile.
5. **Pin the toolchain.** `configs/beagle.ref` + Gate M freeze the compiler so authoring-side churn is a decision, not an accident.

The thesis throughout: **minimize the surface we own, and make every remaining piece of it loudly self-report the instant upstream moves under it** — before a build, not during one.

## See also

- `docs/why-beagle.md` — code-as-claims, the projector, the call graph
- `tools/prep/patch-cost.bjs` (`bun run cost`), `tools/prep/conflict-forecast.bjs` (`bun run forecast`)
- `tools/prep/patch-order.bjs` (ordering/batching analyzer + minimal renumber)
- `tools/prep/upstream-provenance.bjs` + `configs/upstream-provenance.json` (per-file upstream blob-OID lock)
- `tools/scripts/preflight.bjs` Gate L (surface contracts), Gate M (beagle-currency), Gate S (security-critical patches persist), Gate U (patch numbering coherence)
- `BUILD-LEDGER.md` — the postmortems that motivated each gate
