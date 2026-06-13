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

---

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
