# tools/prep — Firefox source preparation pipeline

What this is: ~500 lines of Bun-native TypeScript that downloads
mozilla-central, overlays our customizations onto it, and produces
a tree at `engine/` that `nix build .#skiff --impure` can compile.

What it replaces: this used to be `@zen-browser/surfer`. We replaced it
because surfer hardcodes Zen-specific URLs and assumptions that we don't
want leaking into our build (see `branding.ts` for the regression
sanity-check that ensures `zen-browser.app` never appears in our
generated branding tree).

## Commands

| Command | What it does |
| --- | --- |
| `bun run download` | Fetch firefox-VERSION.source.tar.xz from archive.mozilla.org, verify SHA256 against the published SHA256SUMS, extract to `engine/`. Cached at `~/.cache/skiff/sources/`. |
| `bun run import` | Three phases: (1) overlay `src/skiff/` files onto `engine/`, (2) apply patches from `patches/` via `git apply`, (3) generate `engine/browser/branding/skiff/` from mozilla's `unofficial` template + `skiff.json`. |
| `bun run init` | Both of the above, in order. Cold-start command. |
| `bun run clean` | Remove `engine/`. Forces full re-download next time. |

## Files

| File | Responsibility |
| --- | --- |
| `cli.ts` | Command dispatch. |
| `config.ts` | Loads + validates `skiff.json`. |
| `paths.ts` | Filesystem constants (REPO_ROOT, ENGINE_DIR, etc). |
| `log.ts` | Tiny prefixed logger. |
| `download.ts` | Tarball download + SHA256 verify + extract. |
| `import.ts` | Orchestrates overlay/patches/branding. |
| `overlay.ts` | `cp -a src/skiff/. engine/`. |
| `patches.ts` | `git apply` each `patches/*.patch`, idempotent via applied-log. |
| `branding.ts` | Clone `engine/browser/branding/unofficial` → `…/skiff`, substitute brand strings + URLs from `skiff.json`, install our PNG icons. |

## Branding strategy

We derive our branding tree from mozilla-central's `unofficial` branding
(which ships with empty welcome URLs and Nightly placeholder names),
then string-substitute brand names + URLs based on `skiff.json`. This
avoids needing to maintain our own branding template — whenever we bump
the Firefox version, we automatically pick up any structural changes to
mozilla's branding format.

The substitutions live in `branding.ts`. If you add a new brand-string
or URL that mozilla's template uses, add it both to `skiff.json`
(so it's configurable) and to the substitution table in `branding.ts`.

A regression check at the end of `branding()` asserts no
`zen-browser.app` substring leaked through. If that ever fires, the
substitution table needs updating.

## Adding a new patch

Drop a `*.patch` file into `patches/`. Filenames are applied in
alphabetical order (prefix with `0010-`, `0020-` etc. if order matters).
Re-run `bun run import`. The tool records applied patches in
`engine/.skiff-applied-patches` so re-runs skip already-applied ones.

## Adding a new source overlay

Drop the file into `src/skiff/<path-mirroring-engine>/`. e.g.
`src/skiff/browser/components/sidebar/foo.mjs` overlays
`engine/browser/components/sidebar/foo.mjs`. Re-run `bun run import`.

## Why Bun

Bun runs `.ts` files directly with no build step, has a fast `fetch`,
ships a hash API (`Bun.CryptoHasher`), and has a clean shell DSL (`$`).
We rely on these instead of pulling Node + tsx + a separate hash lib +
shell escape hell.
