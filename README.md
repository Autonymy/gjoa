# gjoa

A Firefox fork tuned for a single power user. The idea: do natively, at
near-zero runtime cost, the things most people bolt onto Firefox with a stack
of extensions — an ad blocker, Dark Reader, tree-style tabs — and ship it as
one aggressively optimized build.

Built on Firefox 152. The UI is written in [Beagle](https://github.com/tompassarelli/beagle)
(a typed Clojure subset) as `.bjs` modules under `src/gjoa/chrome/bjs/`,
compiled to chrome JS and loaded through a native chrome loader
(`src/gjoa/browser/components/gjoa/GjoaLoader.bjs`, itself compiled to a
`.sys.mjs`) baked into `omni.ja` — no fx-autoconfig, no extension process,
no per-page injection.

## What's different

**Shipped**

- **Tree-style tabs + vim keymap** — a vertical, keyboard-driven tab tree in
  the sidebar.
- **Workspaces** — multiple isolated tab sets ("spaces"), each with a
  protected home tab.
- **Sidebar drawer + searchable session history** — append-only and
  FTS5-indexed.
- **Engine-level dark mode** — forces a dark color scheme through a Gecko
  agent stylesheet (plus an optional compositor inversion filter for sites
  without native dark CSS). Zero per-page content scripts, zero
  MutationObservers — roughly Dark Reader's outcome without its per-page
  CPU/memory tax.

**In progress**

- **Native ad / tracker blocking** — Firefox 152 ships Brave's `adblock-rust`
  engine *in-tree* but leaves it disabled (Mozilla uses it only for
  tracker-list processing). gjoa wires it on with real filter lists:
  network-layer blocking + cosmetic filtering, uBlock-Origin-compatible
  syntax, requests killed before they leave the browser — no extension. The
  engine is in the binary and verified blocking; default lists + UI are
  landing.

## Performance

The release build is compiled with `-O3`, full LTO, and `-march=native` (tuned
to the building machine's CPU — so the release binary is **not** portable to a
different CPU). Honest framing: stock Firefox is already PGO+LTO, so the
gjoa-vs-stock delta is modest. The real win is the absence of the **extension
tax** — native dark mode and native blocking do for free what Dark Reader and a
content-script ad blocker do at real per-page cost. Measured against the
Firefox-plus-extensions setup people actually run, gjoa is dramatically lighter.

## Build

**NixOS / Nix (the primary path):**

```sh
bun run init                       # download mozilla-central + apply overlays
nix build .#gjoa --impure          # dev variant — fast, no LTO, CPU-portable
nix build .#gjoa-release --impure  # release — O3 + LTO + march=native (this CPU only)
./result/bin/gjoa
```

**Other platforms.** `.github/workflows/` builds portable artifacts with mach on
GitHub Actions — a Linux x86_64 tarball and a macOS (`macos-26`) `.dmg`/`.app`.
For a self-contained Linux executable that runs on any glibc distro with **no Nix
on the target**, `nix bundle .#gjoa --impure` emits a single relocatable file.
(CI needs the [Beagle](https://github.com/tompassarelli/beagle) compiler as a
sibling checkout — the workflows clone it and install Racket before `import`.)

## Dev loop

Source-tree changes (`.sys.mjs`, branding, configure flags) need a build, but
chrome JS/CSS iterates in ~1s without one:

```sh
nix develop .#mach          # shell with mach + toolchain
cd engine && ./mach build   # one-time, ~30-60 min cold
# edit src/gjoa/chrome/bjs/*.bjs (or chrome/css/*.css) ...
gjoa sync                   # compile the .bjs chrome + deploy into the mach install (~1s)
gjoa dev                    # restart the mach binary
```

See [`docs/daily-loop.md`](docs/daily-loop.md) for the cheatsheet and
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full map.

## Tests

```sh
bun test                  # unit tests (happy-dom)
bun run test:integration  # headless Marionette tests against a gjoa binary
bun run preflight         # pre-build gates (patches, chrome alignment, nix eval)
```

## Layout

```
gjoa.json            project config (version, branding, URLs)
flake.nix            Nix build (dev + release variants)
src/gjoa/            source overlays — chrome UI (.bjs/.css), prefs, branding, loader
tools/prep/          Firefox-source preparation pipeline (Beagle, run on Bun)
tools/test-driver/   Marionette integration harness
.github/workflows/   cross-platform CI (Linux x86_64 + macOS mach builds)
configs/branding/    icons + brand assets
docs/                deep-dive documentation
BUILD-LEDGER.md      every build's outcome + postmortems
```

## License

[MPL-2.0](LICENSE) — same as Firefox.
