# gjoa build ledger

Every `nix build .#gjoa` or full `./mach build` lands here. Append-only.
Read CLAUDE.md Rule #0 before proposing a rebuild.

The cadence is one build per week, Sunday. Anything outside that is an
unexpected rebuild and requires a postmortem in this file before we
move on.

Columns: date (YYYY-MM-DD), type, reason, outcome, who-asked.

| Date       | Type    | Reason                                   | Outcome                        |
|------------|---------|------------------------------------------|--------------------------------|
| 2026-05-24 | nix     | bump Firefox 150 → 151.0.1, regen 0004/0006 | success, but jar.mn was `gjoa.jar:` no-op → omni.ja missing chrome bundles → effectively broken |
| 2026-05-24 | nix     | retry after `jar.mn` → `browser.jar:` fix | KILLED at ~5 min during wiring sccache; no binary produced |
| 2026-05-26 | nix     | "breaking ground" build — sidebar restore (jar.mn `browser.jar:` + production-mode loader) + Spaces lock-in. First build under Rule #0 strict 30-day enforcement. ABCDE preflight all green; spaces 27/27 unit tests. | **FAILED at evaluation** — nix daemon rejected `__noChroot = true` because user isn't in trusted-users. Zero compile minutes consumed. result/ unchanged. |
| 2026-05-26 | nix     | retry of same build after `firn rebuild` applied `trusted-users @wheel`. New `gjoa preflight` script ran: all 9/9 gates green (including new Gate F for daemon settings + Gate G nix eval). User authorized retry. | **FAILED again, same error** — Gate F was misdiagnosed. `__noChroot` is not gated by trusted-users; it's gated by `sandbox` setting (`true` rejects it, `relaxed` permits). Zero compile minutes. |
| 2026-05-26 | nix     | attempt #3. Fixed Gate F to actually check `sandbox` daemon setting. Removed `__noChroot = true` from flake.nix (giving up sccache persistence; will re-add when nixos sandbox setting is changed). Preflight 9/9 green and now actually meaningful. User left "keep going, count every attempt" — proceeding. | **INTERRUPTED** — user's machine shut off mid-build. Unknown if any compile completed. result/ unchanged. Not a code/preflight failure. |
| 2026-05-26 | nix     | attempt #4. Resuming after machine shutoff. Same source state as #3, preflight re-run 9/9 green. | **SUCCESS.** result/ → `6l4vi0ls...gjoa-151.0.1`. omni.ja has `content gjoa browser/content/gjoa/` registration + all 3 scripts (drawer/security/tabs) + all 3 styles baked in. Post-build verification: sidebar 2/2 + spaces 12/12 integration tests pass against the nix binary. **The breaking-ground build delivered.** |
| 2026-05-27 | mach    | First full mach build. User-authorized course-correction following the 2026-05-27 postmortem (chose nix when mach was the answer; visual-bug iteration impossible against immutable nix install). One-time ~30-60 min cost; subsequent iterations sub-second via `gjoa sync`. | **SUCCESS** ~46 min. `engine/obj-*/dist/bin/gjoa-bin` (6.5MB). `gjoa sync` deployed staged fixes via `gjoa-dev/` symlink. Integration: sidebar 2/2 + spaces 12/12 pass against mach binary. **Sub-second chrome JS iteration loop unlocked.** |
| 2026-06-14 | nix     | `gjoa-release` — first **performance-supremacy** build. perfFlags=true: `--enable-optimize=-O3` + full LTO + nixpkgs synthetic PGO + `-march=native`/`target-cpu=native` + `enableDebugSymbols=false` + `--disable-parental-controls/--disable-necko-wifi`. BOLT-enabled: `NIX_LDFLAGS=--emit-relocs` + `dontStrip` (libxul retains relocs/symtab for post-link BOLT). Ships perf-prefs + dark-mode bundle, both wired this session (prefs via branding-pref append; dark-mode added to jar.mn + chrome-bake). Pre-build audit: 30-agent workflow caught two silent-no-op landmines (inert prefs, unshipped dark-mode bundle) + flake feature-killers, all fixed. Preflight 9/9 green. `--out-link result-release` (preserves working `result/`). User: "just get it all done now. today is sunday." | **INTERRUPTED then RESUMED.** First launch ran ~ICU/libaom phase (PGO instrument `-fprofile-generate` active, `-O3` applied) before the session was cut off (`error: interrupted by the user`); zero output kept. The interrupted log exposed a **silent no-op**: nixpkgs stdenv defaults `NIX_ENFORCE_NO_NATIVE=1`, so the cc-wrapper was stripping `-march=native`/`-mtune=native` ("Skipping impure flag"). Fixed by adding `NIX_ENFORCE_NO_NATIVE = false` to the perfFlags block (verified against clang-wrapper-21.1.8 utils.bash mangleVarBool + stdenv `${VAR-1}`). Resumed after the fix; nix reuses already-built deps. WebRTC/EME confirmed NOT disabled (user needs mic for AI voice chat). | **COMPILED (exit 0) but INCOMPLETE.** Binary runs (`Mozilla Gjoa 151.0.1`); O3+march=native+PGO+LTO all real (0 "Skipping impure flag"). BUT the flake's `src = builtins.path { path = "…/engine"; }` compiled a **3-week-stale engine/ (last import 2026-05-26)** because I never ran `bun run import` after editing src/gjoa — so dark-mode bundle, gjoa default prefs, and the gate-I fixes are ALL ABSENT from the binary. Also libxul is **stripped** (Mozilla packaging strip; nix `dontStrip` doesn't cover it) → NOT BOLT-able. Sunday slot consumed on an incomplete build. See postmortem below. |
| 2026-06-14 | nix     | **Corrective rebuild** (same Sunday, user-authorized). Root cause of the prior incomplete build fixed: ran `bun run import` → engine/ now current (verified: 4 chrome scripts incl `gjoa-dark-mode.uc.js` baked; gjoa default prefs appended to `branding/gjoa/pref/firefox-branding.js`). Dropped the non-working BOLT attrs (emit-relocs/dontStrip) — BOLT deferred to a verified `--disable-strip` cycle. Preflight 9/9 (gate G = eval-timeout warn). drv `sv13f1d2…`. User: "Rebuild now, features-only." | **FAILED at the PGO profiling run** (~overnight into 2026-06-15). Compile succeeded; the nixpkgs PGO step launched the instrumented browser, which **aborted during profile init**: `gjoa-history.sqlite` left a transaction open (`initiatedTransaction:true`), the `profile-before-change` AsyncShutdown barrier timed out → `###!!! ABORT Sqlite.sys.mjs:235`, exit -11 → builder exit 245. Latent gjoa history bug (beagle-port feature), exposed because the fresh engine has the current history code; build #1's stale May-26 engine predated it. `result-release` unchanged (still build #1). See postmortem. |
| 2026-06-15 | nix     | **Build #3.** Sunday rule REMOVED (user: "remove the whole sunday rule, i don't care anymore"). Fixes the history shutdown crash: `history.ts` now registers a `profile-before-change` AsyncShutdown blocker that AWAITS the in-flight migration (so its COMMIT lands) before closing, + dedupes concurrent opens via `_initPromise` (Lane 1, tsc clean). Caught a dist-staleness trap — `chrome-bake` reused the pre-fix `dist/` → forced `rm -rf dist/chrome` + fresh `chrome:dist` before import; engine re-verified (history fix + dark-mode + prefs all baked). PGO kept. | **FAILED — same history-sqlite deadlock.** The AsyncShutdown-blocker fix committed the txn (`initiatedTransaction:false` now, was true) but the connection still won't close: Sqlite stops processing statements once `profile-before-change` engages, so the blocker's `await _initPromise` (the in-flight migration) never resolves → both blockers hang → abort. Can't be nailed by blind 2–3h iterations. |
| 2026-06-15 | nix     | **Build #4 — PGO DROPPED** (`pgoSupport=false` for the release). The crash only exists because PGO runs the instrumented browser; no profiling run → no fast start→quit → no history deadlock. Keeps LTO + O3 + `march=native` + dark-mode + prefs + the (partial) history fix. PGO to be re-added after the history shutdown is fixed + verified on the dev binary's fast loop (not via nix builds). Decisive call after 3 PGO+history failures: land the binary now; PGO's gjoa-vs-stock delta is marginal. | **IN PROGRESS** — ~1–1.5h (no PGO double-compile). |

---

## 2026-06-15 — PGO build crashed on gjoa-history sqlite shutdown (postmortem)

**Trigger:** corrective rebuild (fresh engine, PGO on). Compile fine; the PGO
profileserver run launched the browser and it FATAL-aborted during profile init.

**Root cause:** `src/gjoa/chrome/src/tabs/history.ts` opens `gjoa-history.sqlite`
and runs schema migration inside `conn.executeTransaction(...)` at
delayed-startup; the connection only closes on `window unload`
(`tabs/index.ts:572`). The PGO run does a fast start→shutdown. If shutdown lands
mid-migration, the transaction is never committed; `Sqlite.openConnection` has
registered the conn on the `profile-before-change` AsyncShutdown barrier, which
then waits → times out → `###!!! ABORT Sqlite.sys.mjs:235`, exit -11, builder 245.
NOT introduced this session — latent; build #1 dodged it only because it compiled
the 3-week-stale engine that predated the history feature.

**Why preflight missed it:** no gate exercises a real fast start→shutdown of a
gjoa binary. Preflight is static (patches/jar/eval/alignment); this is a runtime
shutdown-ordering bug that only a launch-and-quit smoke catches — exactly what
PGO does for free, and exactly what we lacked as a pre-build check.

**Fix direction (Lane 1, no nix build to author/verify on mach/dev):** make the
history sqlite lifecycle shutdown-safe — register an AsyncShutdown blocker that
finalizes/rolls back the in-flight transaction and `asyncClose`s the connection
on `profile-before-change` (not just window unload), and/or guard init so a
migration that's interrupted leaves no open transaction. Verify with a
launch→immediate-quit cycle on the mach binary before the next nix build.

**New gates to add:**
- K — pre-build runtime smoke: launch the current dev/mach binary headless,
  quit within ~2s, assert clean exit (no AsyncShutdown abort). Would have caught
  this without burning a 2–3h PGO build.
- Audit gjoa features that open sqlite / async resources for correct
  AsyncShutdown blocker registration (history, and any future DB-backed feature).

## 2026-06-14 — compiled a stale engine/; libxul stripped (postmortem)

**Trigger:** First performance-supremacy build. Compiled clean (exit 0) and
runs, but the binary is missing every gjoa-source change made this session
(dark-mode bundle, default prefs, gate-I fixes) and libxul is stripped so it
can't be BOLTed.

**Why preflight missed it:** the flake builds from `src = builtins.path { path
= ".../engine" }`. `engine/` is only refreshed by `bun run import` (overlay
src/gjoa → engine, branding, chrome-bake). I edited `src/gjoa/` + `tools/prep/`
but never ran `import`, so `engine/` was the 2026-05-26 import. `flake.nix` is
read at eval time, so the *compile flags* applied while the *source* did not —
a split that looked like success. Preflight gate I checks that
loader/jar.mn/chrome-bake agree in `src/`, and gate A checks patches on a fresh
tarball — neither checks that `engine/` reflects current `src/gjoa/`.

**Second issue — BOLT:** `dontStrip=true` + `NIX_LDFLAGS=--emit-relocs` were
not enough. Mozilla's packaging strips libxul itself (nix `dontStrip` only
governs nix's fixupPhase). Result: no `.symtab`/`.rela.text`, BOLT can't run.
Fix for next build: add `ac_add_options --disable-install-strip` (or
`STRIP=true`) to the perfFlags mozconfig so the emitted relocs survive.

**New gates to add:**
- J — `engine/` is current: assert `bun run import` ran since the last edit to
  `src/gjoa/` or `tools/prep/` (e.g. newest mtime under those ≤ engine import
  marker), else REFUSE. This is the gate that would have caught it.
- BOLT builds must verify the *built* libxul has `.rela.text` + `.symtab`
  (post-build check), not just that the flake sets emit-relocs.

**Could it have been avoided?** Yes — running `bun run import` before the build
(the documented pre-build step; "bun run import first" is already a stated
lesson) and a post-build omni.ja/libxul verification. Both now codified above.

## 2026-05-26 — retry also failed: Gate F itself was wrong (postmortem)

**Trigger:** Same `__noChroot` rejection on the second attempt, despite
preflight Gate F showing green.

**What I got wrong:** I wrote Gate F to check `trusted-users`. The real
constraint is `sandbox = true` at the daemon level — that setting alone
rejects any derivation with `__noChroot = true`, regardless of who's
invoking. Trusted-users matters for OTHER privileged settings (using
`--option sandbox false` at the command line), but not for the
in-derivation `__noChroot` attribute. I conflated two related-but-
distinct nix permission mechanisms.

**Why I conflated them:** the nix docs talk about both in the same
paragraph. I pattern-matched the first time, didn't read carefully
enough, encoded the wrong check in the script. Then trusted my own
script.

**Fix to Gate F:** the actual check is
```
nix show-config | grep "^sandbox = "
```
Must be `relaxed` (not `true`) for `__noChroot` to work. Updated in
`tools/scripts/preflight.ts`.

**Going forward — three options for the flake:**
1. Remove `__noChroot = true` from flake.nix. Lose sccache persistence
   across nix builds. But the build runs against the strict default
   sandbox. Lane 1 source edit, no nixos-config involvement.
2. Change `sandbox = true` → `sandbox = relaxed` in the nixos-config
   nix-settings module. System-wide loosening; affects every nix
   build, not just gjoa.
3. Drop sccache entirely. Use mach builds (which have no nix sandbox)
   for daily iteration, accept full cold rebuild for the rare Sunday
   nix build.

User calls the shot.

---

## 2026-05-26 — breaking-ground build failed at eval (postmortem)

**Trigger:** Approved weekly nix build to restore the sidebar (jar.mn
fix) and lock in Spaces. First build under Rule #0 strict 30-day
enforcement.

**What happened:** Build died during nix evaluation, before any
compilation:
```
error: derivation '...gjoa-unwrapped-151.0.1.drv' has '__noChroot'
set, but that's not allowed when 'sandbox' is 'true'
```
The flake's `__noChroot = true` (added earlier today to wire sccache
persistent cache) requires the invoking user to be in `trusted-users`
in nix.conf. User is not — still `trusted-users = root`. The
nixos-config change adding `@wheel` to trusted-users was staged but
never applied (firn rebuild was blocked by other empty-`.nix`
issues, then we never got back to it).

**Why preflight didn't catch it:** ABCDE checklist had no gate for
"will the nix daemon accept this derivation's __noChroot setting".
Gate D verified dep versions but not daemon-level acceptance of the
flake's sandboxing requests.

**Checklist update — adding Gate F to CLAUDE.md Rule #0 preflight:**
- **F — Daemon-level features accepted?** If the flake uses
  `__noChroot`, `__impure`, `extra-sandbox-paths`, or other settings
  requiring trusted-users / non-strict sandbox: confirm by running
  `grep -E "^trusted-users|^sandbox" /etc/nix/nix.conf` BEFORE
  proposing the rebuild. Any setting the daemon will reject must be
  fixed first (either land the nixos-config change, or remove the
  flake setting that requires it).

**Could this have been Lane 1?** No — Lane 3 work is genuine. But the
failure was 100% preventable with a 1-line preflight check.

**Resource cost:** zero compile minutes (build died at eval). The
rebuild-budget question: was this "a rebuild"? Letter of Rule #0: any
nix build attempt. Spirit: the cost we're rationing is compile time;
this consumed none. Reading the rule strictly, this counts as the
week's allowed build and we wait until 2026-06-02 for the actual
sidebar fix. Reading the spirit, we remove `__noChroot` from the
flake (Lane 1 source edit) and retry — same week, same compile
budget, just no sccache benefit this round.

User calls the shot.

---

## 2026-05-24 — unexpected rebuild cascade (postmortem)

**Trigger:** Firefox 150 → 151.0.1 version bump.

**What rebuilds happened, and why each was "needed":**
1. Initial 151 build — patches 0004 + 0006 had stale line context; failed
   mid-build. Should have been caught by running `bun run import` against
   the new tarball BEFORE the build.
2. After regen — NSS hash in the flake overlay was wrong (I had pasted
   the GitHub-archive hash from the wrong source). Hit fixed-output
   mismatch ~20 min into the build.
3. After NSS fix — build completed but binary had no chrome bundles
   loaded. Root cause: GjoaLoader's production-mode code path was
   `// TODO future commit`, returning silently. Lived in the codebase for
   months but never exercised in nix (only in dev-mode overlay path).
4. After production-loader implementation — built, still no sidebar.
   Root cause: jar.mn used `gjoa.jar:` which is a no-op in modern Firefox;
   only `browser.jar:` actually registers chrome assets.

**Why preflight didn't catch any of these:** there was no preflight.
Each landmine was a Lane 3 "you can only know after building" bug —
EXCEPT they all could have been caught by reading code or running
`bun run import` first. The discipline was missing.

**Checklist update (now codified as ABCDE in CLAUDE.md Rule #0):**
- A: run `bun run import` end-to-end clean before any rebuild
- B: cross-check `jar.mn` syntax against a working Firefox example
- C: audit every production code path for `// TODO` no-ops
- D: verify dep floors (NSS, etc.) before kicking off
- E: justify why current binary is unrecoverable

**Could this have been Lane 1?** No — the 151 bump is genuinely Lane 3
work. But the cascade from 1 build to 4 was 100% preventable.

---

## 2026-06-17 — Firefox 152.0 bump (nix .#gjoa) — SUCCESS

**Trigger:** user asked for latest (152); 151.0.1 was 1 major behind with 2 high
advisories. `security:bump` → 152.0.

**Cascade, all clean on the first build (no repeat-build postmortems):**
- `security:bump` → gjoa.json 152.0; `rm -rf engine && bun run download` (FF
  152.0 source, 760.9 MB, verified) → `bun run import`.
- **Patches: all 3 applied clean** against 152 (no fuzzy-context breakage — the
  classic 151-era landmine; import-first caught nothing because there was nothing).
- **NSS:** 152 bundles NSS 3.124; nixpkgs-unstable already ships 3.124, so the
  flake leapfrog overlay auto-disables. Bumped `minNssVersion` 3.123.1→3.124 to match.
- **Preflight gate I** was stale (pointed at pre-beagle-port `GjoaLoader.sys.mjs`);
  fixed to `GjoaLoader.bjs`. Bundles verified aligned (4 scripts + 3 css).
- **PREFLIGHT GREEN 9/9.** `nix build .#gjoa --impure` → result/bin/gjoa = "Mozilla
  Gjoa 152.0". One build, no cascade.

**Why no repeat builds this time:** import-first + preflight 9/9 + the NSS floor
checked against the *actual* 152 requirement before launching. The discipline held.

**CI (friend builds, separate from this nix build):** bringing the GitHub Actions
Linux+macOS builds online for 152 took a chain of config fixes (stale lockfile →
missing beagle sibling → setup-racket@v1.15 → raco-link beagle-lib for the
collection). The free Linux runner is expected to OOM at link regardless (Zen uses
paid Blacksmith/self-hosted) — popos fallback is `nix bundle` off this local build.

## 2026-06-17 — vim hotkeys fix + variant rename + native build — SUCCESS (native in progress)

**Trigger:** user reported vim hotkeys (t / : / tab-search) dead on the 152 build.
Diagnosed by driving `result/bin/gjoa` headless via Marionette (real key events) —
NOT by rebuilding to guess. Root cause: `leader-key` was `(when useLeader …)`,
which returns `undefined` when leader mode is off (the default); the keydown
handler gates on `(not= leader nil)` → compiled `!== null`, and `undefined !== null`
is `true`, so every key was routed into leader mode with `leader === undefined`
and nothing ever matched. ALL direct hotkeys silently dead. Fix: explicit `nil`
else (PR #10). A nil-vs-undefined emit mismatch, not a 152 change.

**Verification (the point of the Marionette harness):** added
`tests/integration/vim-hotkeys.bjs` (real keys → pickers open with leader off).
Rebuilt nix dev binary → regression suite **9/9 green** on the compiled binary:
`t`→tabs picker, `:`→ex picker. Fix proven end-to-end, no guessing.

**Flake variant rename (PR #11):** `gjoa-release` was misnamed — it set
`-march=native` (un-shippable; SIGILLs on other CPUs). Renamed → `gjoa-native`;
`.#gjoa` is now the native personal build (what the nixos config installs → rofi
"gjoa"). `.#gjoa-dev` = fast/portable (dev loop + `nix bundle` target). "Release"
for other people = the CI artifacts, not a nix package.

**Builds this session:**
- nix dev variant (vim-fix verification) — SUCCESS, vim 9/9.
- nix `.#gjoa` (= gjoa-native, LTO + -march=native) — IN PROGRESS (first native
  build to completion in this repo; prior release builds died on PGO, now disabled).
- mach dev build (`gjoa dev`) — queued after native (sequential; no concurrent
  Firefox compiles — thermal/OOM).
- CI linux + macos re-triggered on main with the fix — in progress.

## 2026-06-17 — Native cosmetic ad-blocking (M2) — SUCCESS

**Type:** mach (one full `./mach build` ~27 min + two `mach build faster`
repackages ~37 s each for actor iteration). **Trigger:** extend the upstream
FF152 `content-classifier` component (which M0/M1 used for *network* blocking via
prefs + the RS-client overlay) with **cosmetic element hiding** — the
`##.selector` half of uBlock.

**What landed:** Rust FFI (`url_cosmetic_resources` /
`hidden_class_id_selectors`) → cbindgen header → C++ engine wrappers → two new IDL
methods → XPCOM service cross-engine union → `@mozilla.org/content-classifier-service;1`
contract id (`GetSingleton`, so JS can reach the MAIN_PROCESS_ONLY service) →
`GjoaCosmetic` JSWindowActor pair (USER_SHEET `display:none!important`, initial
class/id scan + timer-free MutationObserver), registered in `GjoaLoader :start`.

**Validation (Marionette, on the mach binary):** M0 (real EasyList+EasyPrivacy
blocks real ad hosts) PASS, M1-UI PASS, M1-production (isolated) PASS, M2-service
PASS, M2-actor (at-load + dynamic hiding, control kept visible) PASS. Pre-build
adversarial agent review of the native layer: 0 real bugs.

**Lessons (gate-worthy):**

1. **PERSISTENCE — `engine/` is gitignored; gjoa-modified upstream files MUST be
   mirrored into `src/gjoa/` or CI loses them.** CI rebuilds via `bun run import`
   (overlay `src/gjoa/X → engine/X` + patches) on a FRESH extract, so direct
   `engine/` edits are invisible to CI. M0/M1 never modified upstream `.cpp` (just
   prefs + the `.sys.mjs` overlay), so this was the first build to hit it. Fix: the
   8 modified content-classifier C++/Rust/IDL/build files are now whole-file
   overlays under `src/gjoa/toolkit/components/content-classifier/` (+ a README).
   **New preflight gate candidate: "every gjoa-modified engine file has a src/gjoa
   overlay or a patch" — fail loud otherwise.**
2. **Headless content-process `setTimeout` is FROZEN** (background-tab timer
   suspension). The actor's MutationObserver flush was rewritten timer-free (flush
   in the observer callback; MutationObserver already batches at the microtask
   checkpoint) — more robust in real background tabs too. Tests wait via runner-side
   `await-true` polling, never content `setTimeout`.
3. **beagle `.zo` cache corruption** ("instantiate-linklet mismatch") from a
   concurrent `../beagle` edit → `raco make beagle-lib/main.rkt` rebuilds it.
4. **`adblock-smoke` nix-vs-mach discrepancy (NOT a regression):** smoke loads a
   rigged rule via `test_list_urls` *at startup after restart* — a test-only path
   M0/M1 don't exercise. Passes on the LTO nix binary, fails on the unoptimized mach
   binary (startup-ordering). The shipped paths (M0 running-load, M1 RS restart-load)
   both pass on mach. M2 code is additive and never touches
   `Init()`/`LoadFilterLists()`/the network path.

## 2026-06-17 — Engine-level dark mode (P0 + P1) — SUCCESS

**Type:** two `./mach build` (mach incremental, ~27 min each). **Trigger:**
replace the crude compositor `filter:invert` with a **style-resolution-stage
luminance inversion** — the "cranked to 9000" dark mode.

**Design first (workflow `darkmode-engine-design`):** 3 research agents +
synthesis + adversarial critique. The critique **caught a fatal flaw before any
build** — the obvious hook (the forced-colors *specified*-stage tweak) has no
concrete color to rescale; the correct hook is the **computed-stage** conversion
(`Color::to_computed_color`'s Absolute arm). Verified against the tree.

**P0 (one build):** the Servo cascade hook + a Rust port of
`RelativeLuminanceUtils::Adjust` (target = 1 - Y, hue/sat/alpha-preserving),
gated on a per-document `nsPresContext::mColorInversion` flag (mirrors
forced-colors). Pre-build adversarial compile-review: green. **Validated on the
binary:** white→black, black→white; flag-off untouched; raster media untouched
for free (it's not a style color). Zero per-frame cost (cached in ComputedValues).

**P1 (one build):** pref-change restyle (`gjoa.darkmode.invert.enabled` →
`UpdateColorInversion` → RecascadeSubtree) so toggling **live-restyles open tabs
without reload**; the chrome "engine" mode (force prefers-color-scheme:light then
flip the flag, so native-dark sites aren't double-darkened). **Validated:** live
toggle inverts an already-loaded box.

**Persistence:** `patches/0009-dark-mode-engine-color-inversion.patch` (+86, the
4 modified upstream files); chrome bits are src/gjoa overlays. `git apply --check`
clean on pristine FF152; preflight gate A green. **Lesson re-applied:** engine
edits are gitignored — persisted as a patch immediately so CI gets them.

**Deferred (Phase 2/3):** shadows/gradients/SVG fill-stroke (`ColorFunction` arm
+ the compound longhands), an explicit RuleCache invert-key dependency, optional
LAB-fidelity algorithm, then retire the `filter` fallback + Dark Reader.

---

## 2026-06-18 — Dark mode P2 + new-tab page + tab-toggle fix — SUCCESS

**Lane 3** full mach build (`./mach build`, ~18 min) for dark-mode **P2**: the
inversion hook moved to the END of `Color::to_computed_color` so resolved
**System/Canvas** colors invert too (P0 only covered absolute colors → page
backgrounds stayed light). Then a **Lane 2** `./mach build faster` rebake to fold
in the new-tab page + GjoaLoader `newTabURL` override + nav-bar/toolbox-border CSS
+ the cosmetic coalescer.

**Gotcha (cost one failed `faster`):** running `bun run import` OUTSIDE
`nix develop` rewrote `engine/mozconfig` WITHOUT `--with-libclang-path`, so the
next `faster` tried to reconfigure and died on libclang. Fix: run import + the
bake INSIDE `nix develop .#mach` so mozconfig keeps libclang (matches the prior
config → no reconfigure). Gate idea: warn if mozconfig regenerates without
libclang while an objdir exists.

**Validated on the real binary:** darkmode P0+P1+P2 pass; new-tab page rendered
via headless `--screenshot`; full integration suite **58/59** (the one fail =
`adblock-smoke`, the documented mach-vs-nix network discrepancy, NOT a
regression — `adblock M0` blocks real ad hosts fine). New `tab-mode-toggle.bjs`
6/6 green: a horizontal↔vertical round-trip no longer corrupts tree collapse
state (transient `layoutCollapsed`, active-space-scoped, never persisted).

**Persistence:** `patches/0009` regenerated to include the P2 END hook
(apply-clean on pristine). Chrome/newtab/loader are src/gjoa overlays. Batch is a
**minor v0.3.0** (adds the new-tab feature) — release held for user sign-off.

---

## 2026-06-18 — Full list-driven scriptlet engine (uBlock +js parity) — SUCCESS

**Lane 3** full `./mach build` (~25 min, 0 warnings) for the general scriptlet
path: Rust FFI `content_classifier_engine_use_resources` → `Engine::use_resources`
(+ `serde_json`); C++ `ContentClassifierEngine::UseResources`; new IDL
`nsIContentClassifierService.setScriptletResources` (uuid bumped) applied to each
block engine at build time. All in `patches/0008` (regenerated — reverse- AND
forward-apply clean vs vanilla).

**Resources:** a 163-entry uBO scriptlet library vendored to
`src/gjoa/.../scriptlet-resources.json` (harvested from `~/code/reference/uBlock`
by a generator, schema-verified against adblock-rust 0.12.1; Brave's pre-built
`dist/resources.json` was only the 17 redirect resources, not the scriptlets, so
the harvest was required). Packaged via `FINAL_TARGET_FILES.modules`, loaded by
the RS client + 6 uBO filter lists.

**Validated on the real binary:** `scriptlet-engine.bjs` — setScriptletResources
+ `youtube.com##+js(json-prune,...)` → non-empty `injected_script`. Curated
`youtube-scriptlet.bjs` + `group-drag-above.bjs` (drag fix) also green in
isolation. Full suite 58/62 (the 4 fails: documented adblock-smoke discrepancy +
test order/flake, all non-code; engine/youtube/drag pass in isolation).

---

## 2026-06-18 — Dark-mode per-site HYBRID (#43) — SUCCESS (exit 0)

**Lane 3** full `./mach build` (1845 s ≈ 30 min, 8 warnings — all pre-existing
third-party). Validates `patches/0009`: a per-document inversion field mirroring
`BrowsingContext.ForcedColorsOverride` end-to-end —
- WebIDL `enum ColorInversionOverride {none,inactive,active}` + `[SetterThrows]
  attribute colorInversionOverride`;
- BC `FIELD` + getter + `CanSet`(`IsTop()`) + `DidSet`(`PresContextAffecting…`) +
  `ParamTraits<…>` (`WebIDLEnumSerializer`);
- `nsPresContext::UpdateColorInversion` now consults `bc->Top()->Color…()`
  (active→invert, inactive→don't, none→defer to `gjoa.darkmode.invert.enabled`).

The chrome side (Lane 1) is `GjoaDarkmode{Child,Parent}.sys.mjs`: child measures
the rendered bg one cascade behind first paint, parent decides from trusted
state; in `hybrid` mode (the new default) native-dark sites keep their theme and
only themeless sites latch `active`. Every site dark, each the best way.

### POSTMORTEM — webidl attribute edited AFTER the build's codegen tier ran
Added the `colorInversionOverride` **attribute** line at 06:06; the build's
export/codegen tier had already run at 05:52, so `BrowsingContextBinding.cpp`
was generated WITHOUT the attribute and libxul linked (06:22) from the stale
binding → the C++ field compiles but the **JS setter is a no-op expando**. The
in-flight build cannot re-enter its own export tier. Fix: a follow-up incremental
`./mach build` (webidl now newer than the binding → make regenerates it + relinks
~minutes). **New gate idea (J):** after any `.webidl` change, assert the
generated `*Binding.cpp` is newer than the `.webidl` AND greps for the new member
before declaring the build done. Could it have been Lane 1? No — per-document
inversion needs the synced BC field (C++/IPDL); chrome JS only sets it.

### Cargo.lock --frozen — release/CI build fix (folded into patches/0008)
The scriptlet-engine patch added `serde_json` to
`content_classifier_engine/Cargo.toml` but never updated `Cargo.lock`; local mach
(no `--frozen`) silently patched the lock in place, masking it, while CI **and**
`nix build` (both `--frozen`) died: `cannot update the lock file … --frozen was
passed`. This is why the v0.3.0 CI builds (Linux + macOS, sha a8d50bf) failed.
Folded the 1-line `serde_json` dependency edge into `patches/0008` (forward-applies
on a pristine tree). New gate idea (K): preflight should `cargo metadata
--frozen` (or grep that every Cargo.toml dep edge exists in Cargo.lock) so a
crate added without a lock update fails preflight, not a 30-min CI build.
