# CLAUDE.md — gjoa project guide

## 🚨 2026-05-27 postmortem — chose nix when mach was the answer

User had a broken sidebar in their nix binary. I drove 4 nix-build
attempts across 3 hours (3 of them eval-failures, one success that
exposed more bugs that I couldn't iterate on). The right move was
**ONE mach build**: ~30–60 min once, writable install, sub-second
chrome-JS iteration via `gjoa sync` forever after. I had
`docs/nix-dev-options.md` open earlier arguing exactly that — and went
the wrong way anyway.

**Rule:** chrome JS / CSS / layout broken? **Mach, not nix.** Nix
outputs to `/nix/store/` (immutable, sealed omni.ja). Mach outputs to
`engine/obj-*/` (writable, supports `gjoa-dev/` hot-reload). If you
find yourself proposing a nix rebuild to verify a chrome-bundle fix —
stop and use mach.

---

## Build cadence: Sunday rule REMOVED 2026-06-15 (user rescinded)

The "one nix build per week, Sunday-only" gate is **gone** — the user
explicitly removed it ("remove the whole sunday rule, i don't care
anymore"). Build whenever it's needed. No calendar window, no per-build
approval ceremony, no abandon-the-fork threat.

What REMAINS — not as permission gates, but because they prevent *wasted*
builds (which is the actual goal):

1. **Run `bun run import` FIRST.** The flake compiles from `engine/`,
   which only reflects `src/gjoa/` after an import. Skipping it compiles
   stale source — cost a whole build on 2026-06-14.
2. **Run `bun run preflight`** (gates A–I) — catches patch/jar/eval/
   alignment breakage before a 2–3 h compile.
3. **Append every build's outcome to `BUILD-LEDGER.md`** — the postmortems
   are how we stop repeating failures (stale engine, `march` no-op,
   history-sqlite shutdown). Still required.
4. **Prefer Lane 1/2 when the change allows it** — still the cheapest path.

### Preflight gates (automated by `tools/scripts/preflight.ts`)

- A — patches apply clean on fresh tarball
- B — `jar.mn` uses `browser.jar:` (not `<pkg>.jar:` which is no-op)
- C — no `TODO`/`future commit` no-ops in production code paths
- D — dep floors satisfied (NSS overlay, etc.)
- E — current binary actually unrecoverable
- F — daemon accepts flake settings (`sandbox = relaxed` for `__noChroot`)
- G — `nix eval` succeeds (catches eval-time rejections before compile)
- H — diff since last working build reviewed for prereqs
- I — chrome bundles aligned across loader / `jar.mn` / `chrome-bake.ts`
- J — scriptlet bundle integrity (`scriptlet-resources.json` matches pinned SHA-256)
- K — engine-currency (refuse build if `src/gjoa/`/`patches/`/`tools/prep/` is newer than the last `bun run import` — kills the stale-`engine/` class). Gate A also WARNs on patch line-offset drift (early `.rej` warning).
- L — surface contracts (a patch/overlay's declared `# depends-on:` upstream symbols still resolve in `engine/` — catches a Rust path move / field removal / JS prop deletion *before* the compile)

### Postmortem on any unexpected rebuild

Append to `BUILD-LEDGER.md` BEFORE moving on. Template: trigger / why
preflight missed it / new gate to add / could it have been Lane 1.

---

## Lane classification

- **Lane 1** — chrome JS/CSS, `gjoa sync` + restart, **~1 sec, no rebuild**
- **Lane 2** — `.sys.mjs` overlay / patch / branding, `mach build faster`, **~30 sec**
- **Lane 3** — C++/Rust / version bump / configure flags, full mach or nix, **30–60 min (build whenever needed)**

## Hard rules

1. **No `./mach build` or `nix build` without explicit user permission.**
   `mach build faster` is OK with a concrete Lane 2 reason.
2. **Don't rebuild to verify.** Use `bun run test:integration` or read
   the load path. Stale binary is the LAST hypothesis.
3. **Default new code to chrome bundles (Lane 1).** Source-tree changes
   are the exception, not the default. **Within Lane 3 patches, prefer
   `.sys.mjs` overlays over Mozilla-source C++/Rust.** Patch-conflict
   cadence rises with every step deeper into native code: chrome JS via
   `ChromeUtils.importESModule` conflicts ~never; `.sys.mjs` overlays
   conflict per major Firefox version; C++/Rust patches conflict per
   release because Mozilla refactors signatures constantly. Always ask
   "can this be done in chrome JS?" before writing a source patch.
4. **Lane 3 queue lives in TaskCreate**, not in this file.
5. **Audit-before-modify on big tasks.** "Don't modify or build. List
   Lane 1/2/3 candidates. Propose Lane 1 first." Wait for go.
6. **Creating `patches/*.patch` is fine; applying them isn't.** The
   file is harmless. The rebuild is what activates it.

---

## Lessons learned

- **Mach, not nix, for chrome bug fixes.** See top postmortem.
- **Firefox version bumps cascade.** `bun run import` first — patches
  with fuzzy context fail HERE, before a 45-min build gets wasted.
  Check NSS floor against nixpkgs. Update stale `baseline-firefox:`
  headers so warnings clear.
- **Production-mode code paths must actually work in nix builds.**
  Dev-mode overlay hides "// TODO future commit" stubs that nix
  exposes. Audit them before claiming "ships."
- **Auto-detect-with-override CLI is wrong.** Explicit `gjoa` (nix)
  vs `gjoa dev` (mach). Whatever you typed runs.
- **`<package>.jar:` in jar.mn is a no-op.** Modern Firefox merges
  into `browser.jar:`. Verify with `unzip -p omni.ja chrome.manifest`
  AFTER any chrome-registration change.
- **`__noChroot` requires `sandbox = relaxed`, not trusted-users.**
  Cost the 2026-05-26 build (gate F now catches it).
- **One rebuild ≠ one binary.** Mach (`engine/obj-*/`) and nix
  (`/nix/store/`) are separate builds for separate purposes. Doing
  nix doesn't give you a mach objdir, and vice versa.

---

## Anti-goals

- Don't depend on surfer or external fork tooling. Use `tools/prep/`.
- Don't pre-port palefox v0.43.0 wholesale; promote deliberately.
- Don't patch surfer output post-import; add to
  `tools/prep/branding.ts` substitution table with a test.

## Reference materials on disk

- `~/code/palefox/archive/` — userscript-era palefox v0.43.0
- `~/code/zen-browser/` — peer fork, reference only
- `~/code/firefox/` — mozilla-central source

## Pointers

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — map, rebuild ladder, decision tree
- [`docs/daily-loop.md`](docs/daily-loop.md) — command cheatsheet
- [`docs/nix-dev-options.md`](docs/nix-dev-options.md) — when mach vs nix
- [`BUILD-LEDGER.md`](BUILD-LEDGER.md) — every build's outcome + postmortems
- `bun run status` / `gjoa status` — operational dashboard
- `bun run preflight` / `gjoa preflight` — mandatory before any rebuild
