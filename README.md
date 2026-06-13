# gjoa

A Firefox fork.

Status: feature-parity with [palefox v0.43.0](https://github.com/tompassarelli/palefox),
the userscript-bundle predecessor. Tree tabs, vim keymap, sidebar
drawer, drag-and-drop, tab groups, and history live as TypeScript
modules under `src/gjoa/chrome/src/` and load via the native chrome
loader (`src/gjoa/browser/components/gjoa/GjoaLoader.sys.mjs`).

## Build

NixOS (or Nix on any Linux):

```sh
bun run init                  # download mozilla-central + apply overlays
nix build .#gjoa --impure    # cold build (dev variant — no PGO/LTO)
./result/bin/gjoa
```

Other Linux: not supported yet — the build pipeline assumes Nix for
the toolchain. Will be supported once we factor out the toolchain
configuration.

## Dev loop

```sh
nix develop .#mach                   # enter shell with mach + toolchain
cd engine && ./mach build            # one-time, ~30-60 min cold
# edit src/gjoa/chrome/src/*.ts ...
gjoa sync                            # bundle TS, symlink into mach install (~1s)
gjoa dev                             # restart mach binary
```

See [`docs/daily-loop.md`](docs/daily-loop.md) for the command cheatsheet
and [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full map.

## Tests

```sh
bun test                       # unit tests (happy-dom)
bun run test:integration       # headless Marionette tests against gjoa
```

## Layout

```
gjoa.json           project config (version, branding, URLs)
flake.nix            NixOS build (dev + release variants)
tools/prep/          Firefox-source preparation pipeline (Bun-native)
src/gjoa/           our source overlays
configs/branding/    icons + brand assets
docs/                deep-dive documentation
```

## License

[MPL-2.0](LICENSE) — same as Firefox.
