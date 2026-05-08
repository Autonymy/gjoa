# CLAUDE.md — skiff project guide

This file is loaded into Claude's context for every conversation in
this repo. Keep it short, current, and oriented toward "what would
help me NOT make the same mistake twice."

---

## What this is

Skiff is a Firefox fork. Source overlays in `src/skiff/`, branding
in `configs/branding/skiff/`, build pipeline in `tools/prep/`,
NixOS build via `flake.nix` (uses nixpkgs's `buildMozillaMach`).

The fork was forked from [palefox v0.43.0](https://github.com/tompassarelli/palefox)
— a userscript bundle for Firefox. Skiff inherits palefox's goals
(keyboard-first chrome, tree tabs, hash-pinned loader baked in) but
implements them as Firefox source-tree files instead of runtime-loaded
`.uc.js` userscripts.

The userscript-era palefox lives at [github.com/tompassarelli/palefox](https://github.com/tompassarelli/palefox)
and is no longer developed. Skiff is the successor.

## Status

- ✅ Repo scaffold (skiff.json, flake.nix, tools/prep, dir tree)
- ✅ Build pipeline owned end-to-end (no surfer dependency)
- ✅ First successful `nix build .#skiff` — produces working binary
- ⬜ Bake the hash-pinned loader from palefox's `program/config.template.js`
     into omni.ja as a JSWindowActor
- ⬜ Port palefox tabs sidebar to `src/skiff/browser/components/`
- ⬜ Port palefox vim keymap
- ⬜ Distribution + release pipeline + update mechanism

## Repo layout

```
skiff/
├── skiff.json             config: name, version, branding, URLs
├── flake.nix              NixOS build (dev + release variants)
├── package.json           bun scripts wrapping tools/prep
├── tools/prep/            our Firefox-source preparation pipeline
│   ├── cli.ts             command dispatch
│   ├── download.ts        fetch mozilla-central tarball + verify SHA256
│   ├── import.ts          orchestrates overlay/patches/branding
│   ├── overlay.ts         copies src/skiff/ → engine/
│   ├── patches.ts         applies patches/*.patch (idempotent)
│   ├── branding.ts        derives engine/.../skiff/ from mozilla unofficial
│   └── README.md          how the pipeline works
├── configs/
│   └── branding/skiff/    icons (PNGs at logo16.png ... logo512.png)
├── src/
│   └── skiff/             source overlays (mirrors mozilla-central paths)
├── prefs/
│   └── skiff/             default prefs (TODO; not yet wired)
├── docs/
│   └── build-and-dev-loop.md   deep dive on file types, mach, PGO/LTO
└── tests/                 regression tests
```

## Reference materials on disk

- `~/code/palefox/archive/` — the userscript-bundle palefox (v0.43.0).
  Source of truth for porting features to skiff: vim keymap is in
  `chrome/JS/palefox-vim.uc.js`, tab sidebar in `palefox-tabs.uc.js`,
  CSS in `chrome/CSS/`. Loader architecture writeup at
  `archive/docs/dev/loader-pipeline.md`.
- `~/code/zen-browser/` — Zen Browser repo. Reference for how a similar
  fork organizes overlays. We do not depend on their tooling.
- `~/code/firefox/` — mozilla-central source. Reference for Firefox-internal
  types (XPCOM IDLs, JSWindowActor patterns, chrome manifests).

## Naming convention

Everything skiff-prefixed where prefixes apply:

- CSS variables: `--skiff-tab-bg`, `--skiff-sidebar-width`
- Chrome JS files: `skiff-tabs.uc.js`, `skiff-vim.uc.js`
- Pref keys: `skiff.tabs.tree.enabled`, `skiff.vim.leader-key`
- about: pages: `about:skiff`, `about:skiff-config`
- Distribution ID: `org.skiff` (set in flake.nix)

Long but unambiguous. No abbreviation.

## Workflow

**Two iteration modes:** `nix build` for cold-start / releases (slow,
reproducible). `mach build faster` for daily iteration (sub-30-sec
JS/CSS, few-min C++).

For the deep dive on file types (`.ja`/`.so`/`.cpp`/`.xhtml`), what
`mach build faster` actually does, what PGO/LTO buy you, and the full
dev loop, see [`docs/build-and-dev-loop.md`](docs/build-and-dev-loop.md).

### One-time setup (cold start)

```bash
bun run init                  # download + import (~10 min, ~700MB tarball)
nix build .#skiff --impure    # ~30-45 min cold compile (dev variant)
./result/bin/skiff
```

DO NOT run mach bootstrap on NixOS — it doesn't support NixOS as a
distro. nixpkgs's `buildMozillaMach` provides the toolchain instead.

### Daily dev loop (after cold start)

```bash
nix develop                          # enter shell with toolchain + env
# edit src/skiff/foo.mjs ...
bun run import                       # re-applies overlays + branding
cd engine && ./mach build faster     # ~30 sec, re-zips omni.ja
$MOZ_OBJDIR/dist/bin/skiff           # run rebuilt binary
```

For C++/Rust changes: `./mach build` (incremental, minutes).
For configure-flag changes: `./mach configure && ./mach build`.

### When to use `nix build .#skiff` (rare)

- First time on this machine (or after `git clean -fdx`)
- Firefox version bump (skiff.json change → fresh download → must rebuild from scratch)
- Touched flake.nix toolchain inputs

Otherwise stay in `mach build faster` land — 60-180x faster than
`nix build`.

### Two build variants

```bash
nix build .#skiff          # DEV — no PGO, no LTO
nix build .#skiff-release  # RELEASE — full PGO + LTO
```

Default `.#skiff` is the dev variant. PGO (the 2-pass profile-collect
rebuild) doubles build time at a 5-15% runtime speed cost — invisible
during development. Use `-release` only for distribution artifacts.

### Runtime injection (no rebuild at all)

For exploratory UI work, the v0.43.0 fx-autoconfig pattern still works
inside the fork — drop a `.uc.js` into the running profile's `chrome/JS/`,
restart Firefox. Use this for prototyping; promote to `src/skiff/`
when stable.

## Common pitfalls

- **`buildMozillaMach` has TWO arg lists.** `pgoSupport`/`ltoSupport`/
  `crashreporterSupport` go through `.override`, not the user args.
  See flake.nix's `mkSkiff` for the pattern.
- **Disk usage is heavy.** mozilla-central source is ~5GB, build outputs
  another ~5GB, downloaded toolchain ~2GB. Plan ~15GB before `bun run init`.
- **`engine/.git/` is intentional.** `tools/prep/patches.ts` initializes it
  so `git apply` works. mach detects it; flake.nix passes `pkgs.git` as a
  build input so the build doesn't fail looking for git.

## Anti-goals

- **Don't depend on surfer (or any external Firefox-fork tooling).** We
  vendored the build pipeline (`tools/prep/`) for a reason — it was the
  only way to keep Zen-isms out of our build. Don't add it back.
- **Don't pre-port palefox v0.43.0's full feature set.** Re-add features
  deliberately, prioritizing the ones that benefit most from being
  source-level (loader, vim keymap, tab tree).
- **Don't write quick-fix scripts that patch surfer's output post-import.**
  We're past that. Add to `tools/prep/branding.ts`'s substitution table
  instead, with a regression test.

## When extending skiff

- **New skiff source file:** drop into `src/skiff/<area>/` mirroring
  the Firefox source-tree path it should overlay.
- **Mozilla source patch:** add as `patches/<NNNN>-name.patch`. Filename
  prefix controls apply order (alphabetical).
- **Default pref:** add to `prefs/skiff/`. (Not yet wired into the
  pipeline — currently a stub.)
- **New brand string or URL:** add to `skiff.json` AND to the substitution
  table in `tools/prep/branding.ts`. Add a check that it landed correctly
  in `tests/`.
