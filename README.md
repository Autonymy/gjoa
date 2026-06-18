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

This README describes the stable shape of the project. For volatile detail —
exact feature state, list composition, build outcomes — see
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md),
[`docs/daily-loop.md`](docs/daily-loop.md),
[`BUILD-LEDGER.md`](BUILD-LEDGER.md), and the GitHub releases.

## What's different

Everything below is a capability that's in the build today, described by the
mechanism that makes it work.

### Tree-style tabs with a vim keymap

A vertical, keyboard-driven tab tree in the sidebar: parent/child nesting,
named folder groups, collapse, multi-select. A modal vim layer drives it —
`hjkl` motion, indent/outdent, swap, leader chords, `/` filter, and a `:`
ex-command set with a picker and help overlay. Implemented as a chrome bundle
over Firefox's `gBrowser`; tree structure is per-tab metadata, and the vim
layer is a keydown state machine with declared key/command tables
(`chrome/bjs/tabs/index.bjs`, `chrome/bjs/tabs/vim.bjs`).

### Workspaces (spaces)

Tabs are partitioned into named workspaces; switching shows only that
workspace's tabs, and the selected tab always stays inside the active
workspace. Managed via `:space new/rename/delete/switch`. A spaces manager
holds the mapping, and the space id is also persisted on each tab so it
survives Firefox session restore (`chrome/bjs/spaces/manager.bjs`,
`chrome/bjs/spaces/index.bjs`).

On the niri Wayland compositor, focusing an OS virtual workspace switches gjoa
to the same-named space — a one-way OS→gjoa binding over the
`niri msg event-stream` subprocess, inert when niri isn't present
(`chrome/bjs/spaces/niri.bjs`).

The tab picker can also fuzzy-find and activate tabs across every open window,
not just the current one (`:tabs all`, `chrome/bjs/platform/cross-window-tabs.bjs`).

### Sidebar drawer + floating urlbar

The tab sidebar behaves as a drawer — expand/collapse, compact mode,
drag-resize, hover-reveal — and a floating urlbar is reachable with Ctrl/Cmd-L.
A chrome bundle repositions the sidebar and toolbox and tracks sidebar state via
`MutationObserver` (`chrome/bjs/drawer/index.bjs` and siblings).

### Searchable session history

Every meaningful workspace change is auto-saved to a searchable timeline; you
can name checkpoints (`:checkpoint`), browse history (`:history`), and restore
sessions (`:restore`). Backed by an append-only, hash-deduped event log in a
SQLite file (`<profile>/gjoa-history.sqlite`) with WAL journaling and schema
migrations, plus an **FTS5** full-text index over tab URLs and titles (enabled
by a build patch; falls back to `LIKE` search when FTS5 is unavailable).
Retention prunes untagged events by age and count
(`chrome/bjs/tabs/history.bjs`).

### Native ad / tracker blocking

Firefox 152 ships Brave's `adblock-rust` engine *in-tree* but leaves it doing
only tracker-list processing. gjoa drives it as a real content blocker through
the in-tree `toolkit/components/content-classifier`, fed EasyList/EasyPrivacy
and uBlock Origin filter lists. No extension, no content-script ad blocker —
requests are killed before they leave the browser. Three layers:

- **Network** — the classifier blocks requests against the loaded filter
  lists. A gjoa RemoteSettings-client overlay sources the lists from a
  profile cache (fetched, integrity-checked, refreshed when stale) and pushes
  them into the engine; a per-site allow-list synthesizes an exception engine
  so you can toggle blocking for the current host without a restart
  (`chrome/bjs/blocking/index.bjs`,
  `toolkit/components/content-classifier/ContentClassifierRemoteSettingsClient.sys.mjs`).
- **Cosmetic** — element hiding the network layer can't do. A
  `GjoaCosmetic` JSWindowActor pair asks adblock-rust for element-hiding and
  generic class/id selectors and injects them as a single `USER_SHEET`
  (`display:none!important`), feeding newly-appearing classes/ids back through
  a debounced coalescer; the parent derives the document URL from trusted state
  (`toolkit/.../GjoaCosmeticParent.sys.mjs`, `GjoaCosmeticChild.sys.mjs`).
- **Scriptlets** — small JS snippets injected at document-start in a
  `Cu.Sandbox` over the content window, for ads that survive both layers (the
  canonical case being first-party video ads). Curated-only by default; the
  list-driven `+js()` path via a vendored uBO scriptlet-resource library is
  wired behind an opt-in pref.

### Engine-level dark mode (per-site hybrid)

Dark mode that respects each site rather than inverting everything blindly.
Sites that ship their own dark theme get it; themeless sites are darkened by the
engine with no white flash; a curated registry plus per-site user overrides
refine the rest. Default mode follows the OS theme live; the user cycle is
system-follow / force-on / off.

It runs on three Gecko-native levers driven by prefs: a `prefers-color-scheme`
content override, an engine style-resolution-time luminance inversion read by
`nsPresContext`, and a pre-paint default-invert flag — so there's no per-page
content-script darkening on the core path. A `GjoaDarkmode` JSWindowActor pair
refines per document from trusted parent state: a curated fix registry
(`darkmode-fixes.json`) and user per-site prefs applied pre-paint, plus a
post-paint refiner that retracts inversion on sites that authored themselves
dark. A chrome `filter: invert()` mode remains as a legacy fallback
(`chrome/bjs/dark-mode/index.bjs`, `toolkit/.../GjoaDarkmodeParent.sys.mjs`).

### Custom new-tab / home page

New tabs, the home button, and home-based startup land on a minimal forced-dark
page (a live clock and date). It's a content-accessible chrome document
(`chrome://gjoa-newtab/content/newtab.html`) installed as
`AboutNewTab.newTabURL`, with `browser.startup.homepage` defaulted to
`about:newtab` (`browser/components/gjoa/content/newtab/`, wired in
`GjoaLoader.bjs`).

### Security freshness gate

gjoa refuses to keep running a dangerously out-of-date build. On startup and
hourly it probes Mozilla's `firefox_versions.json` and compares against the
running version: a full major behind latest stable shows a modal and quits; one
point-release behind warns and surfaces a stale state. It fails open when
offline, and `GJOA_ALLOW_INSECURE=1` bypasses it for one process
(`chrome/bjs/security/index.bjs`).

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
bun run init                    # download mozilla-central + apply overlays
nix build .#gjoa --impure       # personal build — LTO + -march=native (THIS CPU only)
nix build .#gjoa-dev --impure   # dev variant — fast, no LTO, CPU-portable
./result/bin/gjoa
```

`.#gjoa` is tuned to the building machine's CPU (`-march=native`) — fastest at
runtime, but **not portable** (it SIGILLs on a different chip), so it's the
maintainer's local daily driver, never a thing you hand out. `.#gjoa-dev` is the
portable, fast-to-build variant for iteration.

**Builds for other people.** Portable, distributable builds are the CI
artifacts, not a nix package: `.github/workflows/` builds with mach on GitHub
Actions — a Linux x86_64 tarball, a macOS (`macos-26`, Apple Silicon)
`.dmg`/`.app`, and a Windows x86_64 `.zip`/installer, none of them
`-march=native`. For a self-contained Linux executable that runs on any glibc
distro with **no Nix on the target**, `nix bundle .#gjoa-dev --impure` emits a
single relocatable file. (CI needs the
[Beagle](https://github.com/tompassarelli/beagle) compiler as a sibling checkout
— the workflows clone it and install Racket before `import`.)

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
.github/workflows/   cross-platform CI (Linux x86_64 + macOS + Windows mach builds)
configs/branding/    icons + brand assets
docs/                deep-dive documentation
BUILD-LEDGER.md      every build's outcome + postmortems
```

## License

[MPL-2.0](LICENSE) — same as Firefox.
