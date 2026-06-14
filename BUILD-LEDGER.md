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
