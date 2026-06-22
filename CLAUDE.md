# CLAUDE.md — gjoa project guide

gjoa is a Firefox 152 fork authored in **beagle** (`.bjs` → JS / `.sys.mjs`). This
file is the always-loaded surface: load-bearing rules + thin pointers. The rich
detail lives in the docs it references — keep those current, keep this lean.

## Build lanes — seam depth sets conflict cadence

- **Lane 1** — chrome JS/CSS, `gjoa sync` + restart, **~1 s, no rebuild**. *Default new code here.*
- **Lane 2** — `.sys.mjs` overlay / patch / branding, `mach build faster`, **~30 s**.
- **Lane 3** — C++/Rust / version bump / configure flags, full mach or nix, **30–60 min**.
- **Release is NOT a lane.** A local build is dev *verification*; the release is
  **CI-built on a `vX.Y.Z` tag push** (free GitHub runners by default; Blacksmith =
  paid opt-in `fast: true`). → `docs/daily-loop.md` "I want to cut a release".

🚨 **Chrome JS/CSS/layout broken? Mach, not nix** (2026-05-27 postmortem). Nix =
sealed `/nix/store` omni.ja; mach = writable `engine/obj-*/` + `gjoa sync`
hot-reload. Proposing a nix rebuild to verify a *chrome* fix is the smell.

## Hard rules

1. **No `./mach build` / `nix build` without explicit user permission.** `mach build
   faster` is OK with a concrete Lane 2 reason.
2. **Don't rebuild to verify.** `bun run test:integration` or read the load path —
   a stale binary is the LAST hypothesis.
3. **Default new code to chrome bundles (Lane 1).** Within Lane 3, prefer `.sys.mjs`
   overlays over C++/Rust: conflict cadence rises with seam depth (chrome JS via
   `ChromeUtils.importESModule` ~never · `.sys.mjs` per major FF · native per
   release, Mozilla refactors signatures constantly). Ask "can this be chrome JS?"
   before any source patch.
4. **Audit-before-modify on big tasks.** List Lane 1/2/3 candidates, propose Lane 1
   first, wait for go.
5. **`patches/*.patch` files are harmless; *applying* them (the rebuild) isn't.**
6. **Lane 3 queue lives in TaskCreate**, not in this file.

## Before any Lane 3 build — prevent the *wasted* build (the actual goal)

1. **`bun run import` first** — the flake compiles `engine/`, which reflects
   `src/gjoa/` only after an import (a stale engine cost a whole build 2026-06-14).
2. **`bun run preflight`** — 23 gates (A–W) catch patch / eval / alignment /
   security breakage before a 2–3 h compile. The live gate registry + what each
   enforces is **GENERATED** in [`docs/stewardship/topology.md`](docs/stewardship/topology.md)
   (Gate T fails on docs↔machinery drift) — never hand-maintain a gate list here.
3. **Log the outcome** to `private-docs/build-logs/` (a new atomic file per build).
   Any unexpected rebuild gets a postmortem: trigger / why preflight missed it /
   new gate to add / could it have been Lane 1.

(The Sunday-only cadence rule was rescinded 2026-06-15 — build whenever needed.)

## Test stewardship — a slow suite is the project-killer

The integration suite runs constantly; un-stewarded it rots into a compounding
velocity tax. Policy + profiler:
[`docs/stewardship/testing.md`](docs/stewardship/testing.md) — read it before
adding/editing tests. No test enters un-budgeted (`configs/test-budgets.json`);
prefer a unit test over a browser boot; a fixed `(sleep N)` is a smell —
`await-true` a real condition. `bun run test:profile` grades actual-vs-budget +
gates regressions.

## Anti-goals

- Don't depend on surfer / external fork tooling — use `tools/prep/`.
- Don't patch surfer output post-import; add to `tools/prep/branding.bjs`
  substitution table + a test.

## Lessons not yet encoded as a gate

(The gated ones — jar.mn no-op, `__noChroot` sandbox, version-bump cascade — now
live in the gates + [`docs/stewardship/topology.md`](docs/stewardship/topology.md).)

- **One rebuild ≠ one binary.** Mach (`engine/obj-*/`) and nix (`/nix/store/`) are
  separate builds for separate purposes; doing one doesn't give you the other.
- **Explicit CLI, not auto-detect:** `gjoa` (nix) vs `gjoa dev` (mach) — whatever
  you typed runs.
- **Production-mode paths must work in nix** — the dev overlay hides `// TODO`
  stubs that a nix build exposes.

## Reference + pointers

- On disk: `~/code/reference/zen-browser/` (peer fork) ·
  `~/code/reference/firefox/` (mozilla-central).
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — map, rebuild ladder, decision tree.
- [`docs/build-pipeline.md`](docs/build-pipeline.md) — binary-vs-chrome cadence, what
  `gjoa dev` loads, the "looks broken / stale chrome" recovery. **Verify chrome
  visually with `bash tools/test-driver/chrome-gallery.sh` — never push manual QA back on the user.**
- [`docs/daily-loop.md`](docs/daily-loop.md) — command cheatsheet + verify-vs-release tree.
- [`docs/nix-dev-options.md`](docs/nix-dev-options.md) — when mach vs nix.
- [`docs/stewardship/`](docs/stewardship/README.md) — the maintenance manifesto
  (security / testing / performance / churn + the generated gate topology).
- `private-docs/build-logs/` — every build's outcome + postmortems (private).
- `bun run status` · `bun run preflight` — operational dashboard · mandatory pre-build gate.
