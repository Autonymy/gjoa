# Building skiff + the dev feedback loop

> "skiff" is the project. "engine/" is its Firefox source tree on disk.
> "tools/prep/" is the script that turns mozilla-central into engine/.

This doc answers the questions that come up over and over when you're
working on a Firefox fork:

- What are all these file types? (`.ja`, `.so`, `.cpp`, `.xhtml`)
- Why does the build take 30+ minutes the first time?
- Do I really need to recompile if I'm only touching JS or CSS?
- What's `mach build faster` actually doing?
- What is PGO and why does it make builds twice as slow?
- When should I use `nix build` vs `mach` directly?

If you came here trying to figure out "how do I just iterate on a CSS
change," skip to **[The dev loop](#the-dev-loop)**.

---

## The build pipeline at a glance

```
mozilla-central source (~5 GB, 350k files)
        │
        │  `bun run import` (fast — file copies + patch apply)
        ▼
   engine/ overlaid with skiff source
        │
        │  ./mach configure (~30 sec)
        │  ./mach build     (cold: 30-90 min, warm-incremental: seconds-minutes)
        ▼
   engine/obj-x86_64-pc-linux-gnu/
   ├── dist/bin/skiff      ← the launcher binary (~50 KB stub)
   ├── dist/bin/libxul.so    ← the engine (~250 MB compiled C++ + Rust)
   └── dist/bin/omni.ja      ← the JS/CSS/XHTML zip (~10 MB)
```

The output is three kinds of artifact and you need to understand which one
your change touches to know which build command to run.

---

## File type reference

### `.cpp` / `.h` — C++ source

Firefox is mostly C++. About 70% of mozilla-central is C++. Touching a
`.cpp` file means recompiling that translation unit and re-linking
`libxul.so`. With incremental build (`./mach build`) this is usually
seconds-to-minutes; with cold build it's the dominant cost (everything
gets compiled from scratch).

Output: `.o` object files → linked together into `libxul.so`.

### `.rs` — Rust source

Firefox uses Rust for ~10% of the codebase (stylo, webrender, parts of
networking, parts of media). Same compile-then-link cost as C++. Cargo
manages the dependency graph. `bindgen` generates Rust ↔ C++ bridge
code at build time — this is why we need `LIBCLANG_PATH` set.

Output: `.rlib` archives → linked into `libxul.so` alongside the C++.

### `.idl` / `.webidl` — interface definitions

XPCOM uses `.idl` for cross-component interfaces (the
"Components.interfaces.nsIFoo" world). Web-facing APIs use `.webidl`
(WebIDL — same format that web standards use). Both get translated
into C++ and Rust bindings during `./mach build`. You usually don't
edit these unless you're adding a new chrome-exposed API.

Output: generated `.cpp` and `.h` files in `objdir/dist/include/`.

### `.so` — shared libraries (Linux)

Compiled native code. The big one is `libxul.so` (~250 MB) which is
basically all of Firefox's engine fused together. There's also
`libmozglue.so`, `libnspr4.so`, `libnss3.so` etc — smaller helper
libraries. On macOS these are `.dylib`, on Windows `.dll`.

Live at `engine/obj-*/dist/bin/`.

### `.xhtml` / `.html` — chrome UI markup

Firefox's UI is built with HTML/XHTML running in a chrome-privileged
window. The browser window itself is `chrome://browser/content/browser.xhtml`.
The new-tab page is HTML. Sidebars, panels, menus — all chrome XHTML.

Lives in source under `browser/components/`, `toolkit/content/`,
etc. At build time, gets bundled into `omni.ja` (see below).

### `.css` — chrome styling

Chrome stylesheets controlling the browser UI's look. Reference
existing chrome variables (`--toolbar-bgcolor`, etc) for theme parity.
Lives next to the XHTML it styles. Bundled into `omni.ja`.

### `.mjs` / `.js` / `.sys.mjs` — chrome JavaScript

Privileged JS that runs the browser. `.sys.mjs` is the modern
ES-module-flavored variant that replaces the older `.jsm` system
modules. JS that talks to `gBrowser`, `Services`, `ChromeUtils`, etc.
Bundled into `omni.ja`.

### `omni.ja` — the bundle

A ZIP file (despite the `.ja` extension, which stands for "Java
Archive" but Firefox repurposed the format) containing **all the
JS, CSS, XHTML, JSON, and string-bundle files** that make up the
chrome UI and JS components.

When Firefox boots, it doesn't read individual files from disk — it
reads `omni.ja` once, decompresses entries on demand. This is a big
startup speedup vs reading thousands of tiny files.

There are actually two: `omni.ja` (browser app) and `browser/omni.ja`
(browser-component-specific stuff).

**Why omni.ja matters for dev loop**: re-zipping omni.ja takes ~30 seconds.
Recompiling C++ and re-linking libxul takes minutes-to-hours. So if
your change is JS/CSS/XHTML only, you want to ONLY re-zip omni.ja and
skip the C++ entirely. That's what `./mach build faster` does.

---

## Build commands

### `./mach configure` (~30 sec)

Reads `mozconfig`, probes the toolchain, generates `objdir/`. You
rarely run this manually — `./mach build` invokes it on first run
or when configure inputs change. Run it directly when you want to
verify a mozconfig change without triggering a build.

### `./mach build` (cold: 30-90 min, incremental: seconds-minutes)

Full incremental build. Compiles whatever source files have changed
since the last build, links libxul, re-zips omni.ja. Cost depends on
what you touched:

- One `.cpp` file → recompile that file, re-link libxul (~1-3 min)
- A header included by 50 files → recompile 50 files, re-link (~5-15 min)
- One `.rs` file → recompile that crate + dependents, re-link (~2-10 min)
- One JS/CSS file → re-zip omni.ja (~30 sec — same as `build faster`)
- Configure-flag change → reconfigure + full rebuild (~30-90 min)

### `./mach build faster` (~30 sec)

**Skips C++/Rust entirely.** Re-zips `omni.ja` from the current source
tree and that's it. Use this for JS/CSS/XHTML changes when you know
nothing native changed. If you accidentally edited a `.cpp` file too,
this command will silently skip it — your change won't be in the binary.

This is the **default daily-loop command** for fork work where most
edits are chrome JS/CSS.

### `./mach clobber`

Wipes `objdir/`. Forces a cold rebuild on next `./mach build`. Use
when:
- The build state is corrupt (rare — usually `./mach build` recovers)
- You changed a configure flag and want to rule out stale cache
- You changed compilers or major toolchain versions

### `./mach run`

Builds (incrementally) and launches the binary with a fresh-ish
profile. Mostly useful as a smoke test. For real dev work, run the
binary directly: `$MOZ_OBJDIR/dist/bin/skiff`.

### `nix build .#skiff`

The nuclear option. Runs the entire build inside a Nix sandbox using
the toolchain from `flake.nix`. Reproducible, hermetic, slow. Each
invocation is a full cold build because Nix derivations are atomic
(no in-derivation incremental). Use only for:

- First-time bring-up on a new machine
- Producing a release artifact
- Testing flake.nix changes

---

## The dev loop

### Daily JS/CSS iteration

```bash
nix develop                              # one-time per shell — sets PATH/env
# edit src/skiff/foo.mjs ...
bun run import                           # ~10 sec, copies overlays into engine/
cd engine && ./mach build faster         # ~30 sec, re-zips omni.ja
$MOZ_OBJDIR/dist/bin/skiff             # launch
```

About 60 seconds per iteration. Most of that is the manual restart of
Firefox to pick up the new omni.ja.

### C++ / Rust iteration

```bash
# edit engine/foo/bar.cpp ...
cd engine && ./mach build                # ~1-15 min depending on blast radius
$MOZ_OBJDIR/dist/bin/skiff
```

For tight C++ iteration, get familiar with `./mach build path/to/dir` to
build a single subtree without walking the entire dependency graph.

### Configure-flag changes

```bash
# edit configs/common/mozconfig ...
cd engine && ./mach configure            # re-probe toolchain
./mach build                             # full rebuild from configure
```

### Cold start (first time, or after `git clean -fdx`)

```bash
bun run init                             # download + import (~10 min)
nix build .#skiff --impure               # 30-45 min cold compile (dev variant)
./result/bin/skiff                       # launch
```

`bun run init` handles tarball download + SHA256 verification + extract +
overlay apply + branding generation. See [`tools/prep/README.md`](../tools/prep/README.md)
for what each phase does.

After a successful cold build, you can drop into `nix develop` and
use `./mach build` directly — `nix build` was just to bootstrap the
`engine/obj-*/` tree.

---

## PGO and LTO — the slow stuff

### PGO (Profile-Guided Optimization)

A two-pass compile:

1. **First pass**: compile Firefox with `-fprofile-generate`. The
   resulting binary records every branch decision and call frequency
   into a profile file when it runs.
2. **Profile collection**: run the instrumented Firefox through a
   synthetic browsing workload. Mozilla ships `build/pgo/profileserver.py`
   that loads a fixed corpus of pages.
3. **Second pass**: re-compile from scratch with `-fprofile-use`,
   feeding the profile data to the optimizer. The optimizer now knows
   which branches are hot, which functions are inlined, which code
   layouts maximize cache hits.

The result is ~5-15% faster runtime — significant for a browser. Cost:
~50-100% longer build (you compile everything twice, plus the profile
collection step in the middle).

### LTO (Link-Time Optimization)

Defers a lot of optimization (inlining, dead-code elimination,
whole-program devirtualization) until link time, after the linker can
see the full program. Cost: link time goes from minutes to tens of
minutes. Benefit: ~5-10% smaller and faster binary.

### Why we have two flake variants

```bash
nix build .#skiff          # DEV  — no PGO, no LTO — ~30-45 min cold
nix build .#skiff-release  # RELEASE — full PGO + LTO — ~60-90 min cold
```

PGO + LTO are essential for a shipped browser (no one wants to give up
10-20% performance vs upstream Firefox). They're useless during
development — the dev iteration cost is much higher than the runtime
cost. So the default `nix build .#skiff` is the dev variant; the
release variant is what we use when cutting an actual distribution
artifact.

---

## "Do I really need to rebuild Firefox just to change a CSS rule?"

No. The answer is `./mach build faster` (~30 sec to re-zip `omni.ja`).

For cases where even 30 seconds is too slow, there's the **runtime
injection escape hatch**: drop a `.uc.js` or `.css` into a profile's
`chrome/` directory, restart Firefox, and the changes load via the
old fx-autoconfig pattern. This was the entire architecture of pre-fork
skiff (lives in `archive/`). It's still useful for prototyping in
the fork:

```bash
# In a running skiff profile:
~/.mozilla/firefox/<profile>/chrome/JS/my-experiment.uc.js   # write code
# Restart Firefox → script loads via fx-autoconfig
```

When the experiment stabilizes, port it into `src/skiff/` as a proper
source-tree file and rebuild via `./mach build faster`.

---

## When the build breaks

### `./mach build` fails after a configure change

```bash
./mach configure   # re-probe
./mach build
```

If still broken: `./mach clobber && ./mach build`.

### `./mach build faster` works but `./mach build` fails

Native code is broken. The faster path skipped it. Look at the C++/Rust
error and fix the source.

### Nix build fails partway

The sandbox throws away all work. Re-running starts over. If it's a
toolchain mismatch, fix `flake.nix` and re-run. If it's a source
issue, fix in `src/skiff/`, `bun run import`, then re-run nix build.

### "MissingVCSTool: git not found"

Surfer creates `engine/.git/`. Mach detects it and tries to invoke
`git`. The fix is in `flake.nix`: `extraNativeBuildInputs = [ pkgs.git ];`
in the `mkSkiff` derivation. Already wired.

### `engine/mozconfig` has stale flags

Surfer writes `engine/mozconfig` based on `configs/`. Sometimes it
disagrees with what `nix build` wants. If you see "configure flag X
conflicts with Y", wipe `engine/mozconfig` and let `nix build`
regenerate it.

---

## Disk and time budget

```
mozilla-central source     ~5  GB
~/.mozbuild (toolchain)    ~2  GB  (only used in mach-direct mode)
engine/obj-* (objdir)      ~5  GB  cold
nix store (per build)      ~10 GB  (deduplicated across builds)
                          ─────────
total working set         ~15-20 GB
```

Cold build wall time on a modern machine (16-32 cores, NVMe):

- Dev variant: 30-45 min
- Release variant (PGO + LTO): 60-90 min

Incremental build wall time (after a cold build):

- One JS/CSS file (`mach build faster`): 30 sec
- One `.cpp` file: 1-3 min
- A header included by many files: 5-15 min
- Touching a configure flag: full rebuild (30-90 min)

---

## Why we picked this setup

- **`tools/prep/`** (Bun-native, ours) for source preparation. Initially
  considered surfer (Zen's tool) but it hardcodes Zen-specific URLs and
  brand strings into generated branding files, which leaked into our
  build. Replacing it was ~500 LoC and we now own the whole pipeline.
  See `tools/prep/README.md`.
- **`buildMozillaMach`** (from nixpkgs) for the cold/release build
  because it's ~750 lines of carefully-tuned Nix that handles every
  toolchain quirk for upstream firefox-unwrapped. We don't want to
  re-derive that.
- **mach directly** for daily iteration because Nix derivations are
  atomic and have no in-derivation incremental — running `nix build`
  per edit would take 30-90 min per iteration. `mach` with a populated
  `objdir/` recovers the actual incremental cost.
- **Two flake variants** so the default command is the fast dev build,
  not the slow release build. Nobody iterates on PGO.
- **Runtime injection still works** so that prototyping doesn't
  require any rebuild at all. The fx-autoconfig pattern from palefox
  v0.43.0 is intact inside the fork.
