# skiff

A Firefox fork.

Status: scaffold. Builds end-to-end via `nix build .#skiff --impure`,
but has no skiff-specific features yet — produces vanilla Firefox 150
with skiff branding. Real features (vim keymap, tree tabs, hash-pinned
loader) get ported in subsequent commits from
[palefox v0.43.0](https://github.com/tompassarelli/palefox), the
userscript-bundle predecessor.

## Build

NixOS (or Nix on any Linux):

```sh
bun run init                  # download mozilla-central + apply overlays
nix build .#skiff --impure    # cold build (dev variant — no PGO/LTO)
./result/bin/skiff
```

Other Linux: not supported yet — the build pipeline assumes Nix for
the toolchain. Will be supported once we factor out the toolchain
configuration.

## Dev loop

```sh
nix develop                          # enter shell with mach + env wired
# edit src/skiff/foo.mjs ...
bun run import                       # re-apply overlays, regen branding
cd engine && ./mach build faster     # ~30 sec, re-zips omni.ja
$MOZ_OBJDIR/dist/bin/skiff
```

Full deep dive: [`docs/build-and-dev-loop.md`](docs/build-and-dev-loop.md).

## Layout

```
skiff.json           project config (version, branding, URLs)
flake.nix            NixOS build (dev + release variants)
tools/prep/          Firefox-source preparation pipeline (Bun-native)
src/skiff/           our source overlays
configs/branding/    icons + brand assets
docs/                deep-dive documentation
```

## License

[MPL-2.0](LICENSE) — same as Firefox.
