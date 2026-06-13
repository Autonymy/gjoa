# nix dev options

Short reference: when to use mach vs nix, and the impurity tradeoffs.
For the full story see the 2026-05-27 postmortem at the top of
[`../CLAUDE.md`](../CLAUDE.md).

## TL;DR

- **Daily dev = mach.** `nix develop .#mach` then `cd engine && ./mach build [faster]`. Writable install at `engine/obj-*/dist/bin/`. Chrome JS hot-reloads via `gjoa-dev/`.
- **Nix = distribution only.** `nix build .#gjoa --impure`. Read-only install at `/nix/store/...`. Sealed `omni.ja`. No iteration.
- **If chrome JS/CSS/layout is broken: use mach.** Nix gives you an immutable binary you cannot fix without another nix rebuild — exactly the cycle Rule #0 is trying to prevent.

## What triggers a nix rebuild

| Change | Triggers full nix? |
|---|---|
| `src/gjoa/chrome/src/*.ts` (chrome bundles) | No — Lane 1 via `gjoa sync` |
| `src/gjoa/browser/**/*.sys.mjs` overlay | Yes (source tree → engine/) |
| `patches/*.patch` | Yes |
| `gjoa.json` version pin | Yes (fresh tarball + full build) |
| `flake.nix` | Yes |

Mach handles all of the above incrementally once the objdir exists.

## Impurity options (ranked)

1. **`--impure` flag (already used)** — reads env vars and paths outside
   the flake. Required so engine/ can live outside the flake source.
   Keep.
2. **`__noChroot = true`** — disables sandbox for the derivation, lets
   sccache write to a persistent host path. Requires
   `sandbox = relaxed` in nix.conf at the daemon level. Not currently
   wired; cost 2 builds on 2026-05-26.
3. **`__impure = true`** — full impurity, no input hashing. Don't use;
   no win over `__noChroot` and breaks output-path stability.
4. **`sandbox = false` globally** — system-wide. Too broad.
5. **Direct mach in dev shell** — the recommended daily path. Skip nix
   entirely for development.
6. **`programs.ccache` NixOS module** — alternative to sccache, system-
   wide. Worth it only if you build many nix C/C++ projects.

## Re-enabling sccache later

If you want sccache persistence across nix builds, two prereqs:

1. `sandbox = relaxed` in your nixos-config nix-settings module.
2. Re-add the `__noChroot = true` + `SCCACHE_DIR` block to the
   `overrideAttrs` in `flake.nix` (was removed 2026-05-26; the dead
   code block is in git history if you want to restore it).

Until then, every nix build is cold. Mach iteration via `gjoa sync` is
unaffected and remains sub-second.
