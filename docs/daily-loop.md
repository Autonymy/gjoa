# gjoa daily-loop cheatsheet

One-screen reference for the commands you run all the time. For
architecture, decision trees, and "why does it work this way", see
[`ARCHITECTURE.md`](ARCHITECTURE.md). For rebuild discipline, see
[`../CLAUDE.md`](../CLAUDE.md) Rule #0.

## Launch the browser

| Command | Binary | Mode |
|---|---|---|
| `gjoa` | nix (packaged) | detached — closes the terminal |
| `gjoa -f` | nix | foreground — shows stdout/stderr |
| `gjoa dev` | mach (dev build) | detached |
| `gjoa dev -f` | mach | foreground |

## Where am I?

```
gjoa status
```

Versions vs Mozilla/nixpkgs/Zen/LibreWolf, CVE count against your pin,
build-state, rebuild budget, and the next recommended command. Fresh
pulls, ~1–2 sec, no cache.

## I edited a chrome TypeScript file (Lane 1, sub-second)

```
gjoa sync          # bundle src/gjoa/chrome/src/* → dist/chrome/{JS,CSS}/
                   # then symlink into <mach-install>/gjoa-dev/
gjoa dev           # restart the mach binary to pick up the new bundles
```

For continuous bundle-on-save:

```
gjoa watch         # rebundles on file change; restart browser to see
```

## I edited a Firefox `.sys.mjs` overlay / patch / branding string (Lane 2, ~30 sec)

```
gjoa import        # copies src/gjoa/ → engine/, applies patches, bakes branding
gjoa build faster  # mach re-zips omni.ja (no C++ compile)
gjoa dev
```

`gjoa build faster` requires `engine/obj-*/` to already exist (one
prior `gjoa build` cold-built it). If it doesn't, run a full
`gjoa build` first — that's a Sunday-only commitment.

## I want to run the tests

```
bun test                            # unit tests (happy-dom, ~300ms)
gjoa test:integration               # Marionette tests against the mach binary
gjoa test:integration:nix           # same suite against result/bin/gjoa
                                    # (use this to confirm a fresh nix build is healthy)
```

## I want to rebuild from scratch (Lane 3 — Sunday only)

Before you do anything, **read CLAUDE.md Rule #0** and check
`BUILD-LEDGER.md` for this week's budget. The cadence is one nix
build per week, Sunday. Strictly enforced through 2026-06-26.

If approved:

```
gjoa import                                 # ensure engine/ is fresh
nix build .#gjoa --impure --cores 8 -j 1   # ~30-60 min cold
gjoa test:integration:nix                  # confirm sidebar + chrome bundles load
```

## I want to bump the Firefox version

That's a Lane 3 change to `gjoa.json`. Implies a Sunday rebuild.
Workflow:

```
bun run security:bump        # writes the latest stable to gjoa.json
bun run import               # re-extracts the new tarball, applies patches
# if any patch fails to apply → regen via `git diff` inside engine/
# update its baseline-firefox header to the new version
```

…then queue the actual rebuild for Sunday per Rule #0.

## I broke something and want to start over

Mach state confused:

```
gjoa clean        # mach clobber — wipes engine/obj-*/
```

Engine state confused (overlays mid-apply or patches half-applied):

```
bun run clean     # removes engine/
bun run init      # downloads + re-imports from scratch (~10 min)
```

## Glossary, in one line each

- **Lane 1** = chrome TS/CSS, no rebuild, seconds.
- **Lane 2** = `.sys.mjs` / patch / branding, `mach build faster`, ~30 s.
- **Lane 3** = C++/Rust / version bump / configure flags, full rebuild, 30–60 min.
- **mach** = Mozilla's build tool, lives at `engine/mach`. Used for Lane 2/3 iteration.
- **nix build** = hermetic packaged build via `flake.nix`. Used for distribution.
- **omni.ja** = the zip inside the binary holding all chrome JS/CSS. Re-zipped by `mach build faster`.
- **`gjoa-dev/`** = symlink to `dist/chrome/` next to the mach binary. Lets you iterate on chrome bundles without re-zipping.
