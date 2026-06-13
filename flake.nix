{
  description = "Gjoa — a Firefox fork built via nixpkgs's buildMozillaMach";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        # NSS leapfrog overlay — auto-disabling.
        #
        # Firefox bumps its NSS floor faster than nixpkgs ships it (e.g. 151
        # needs 3.123.1 while nixpkgs may still be on 3.123.0). When nixpkgs
        # is behind, we substitute Mozilla's upstream RTM tarball; when it
        # catches up, the overlay short-circuits and we use nixpkgs's
        # nss_latest unchanged.
        #
        # The auto-off uses a two-pass nixpkgs evaluation:
        #   1. Import a bare nixpkgs (no overlays) → basePkgs
        #   2. Compare basePkgs.nss_latest.version against minNssVersion
        #   3. Apply the overlay only when basePkgs is strictly behind
        #
        # This avoids the recursion you hit if you probe `prev.nss_latest`
        # from inside the overlay closure (final↔prev fixed-point).
        #
        # To raise minNssVersion when Firefox needs a newer NSS than the
        # hardcoded floor:
        #   1. Bump minNssVersion to the new requirement
        #   2. Update nssUrl (RTM tarball from
        #      https://ftp.mozilla.org/pub/security/nss/releases/) and
        #      compute nssHash via:
        #        nix-prefetch-url --unpack <url> \
        #          | xargs nix hash convert --hash-algo sha256 --to sri
        #
        # The block is dead weight (but harmless) once nixpkgs has
        # permanently outpaced minNssVersion; safe to delete the
        # let-bindings + the if-branch then.
        minNssVersion = "3.123.1";
        nssUrl = "https://github.com/nss-dev/nss/archive/NSS_3_123_1_RTM.tar.gz";
        nssHash = "sha256-VHlcr/B04ijcZgt9XPLkBsnoJmuHjWZkdrOBYSqyYMg=";

        basePkgs = import nixpkgs { inherit system; };
        nssOverlayNeeded =
          builtins.compareVersions basePkgs.nss_latest.version minNssVersion < 0;

        pkgs = if nssOverlayNeeded then
          import nixpkgs {
            inherit system;
            overlays = [
              (_final: prev: {
                nss_latest = prev.nss_latest.overrideAttrs (_old: {
                  version = minNssVersion;
                  src = prev.fetchurl {
                    url = nssUrl;
                    hash = nssHash;
                  };
                });
              })
            ];
          }
        else basePkgs;

        # Single source of truth for the Firefox pin: gjoa.json. Bumping
        # `bun run security:bump` writes here; flake.nix re-reads on next
        # `nix build`. No more "I bumped gjoa.json but the build said 150."
        gjoaConfig = builtins.fromJSON (builtins.readFile ./gjoa.json);
        firefoxVersion = gjoaConfig.firefox.version;

        # Delegate the actual Firefox compile to nixpkgs's `buildMozillaMach`
        # — ~750 lines of carefully-tuned Nix that handles every toolchain
        # quirk (libclang paths, AS=clang, sccache invocation order,
        # wasm-sandbox libs, RLBox, mold linker, etc.) for upstream
        # firefox-unwrapped.
        #
        # We feed it our customized source: tools/prep/ downloads
        # mozilla-central to ./engine/ then overlays src/gjoa/, branding,
        # patches. Nix imports ./engine/ as the derivation source.
        #
        # TWO BUILD VARIANTS:
        #   gjoa         = dev quality (no PGO, no LTO, no crashreporter)
        #                   what `nix build .#gjoa` produces — fast iteration
        #   gjoa-release = release quality (full PGO + LTO + everything)
        #                   what we ship — same correctness, longer build,
        #                   ~5-15% faster runtime. Use only for distribution.
        #
        # buildMozillaMach has TWO arg lists:
        #   1. user args (pname, version, src, branding, ...) → passed directly
        #   2. callPackage args (pgoSupport, ltoSupport, crashreporterSupport, ...)
        #      → set as defaults inside, override via .override
        # The dance: build with user args, then .override the feature flags.
        mkGjoa = { pgoSupport, ltoSupport, crashreporterSupport, suffix ? "" }:
          ((pkgs.buildMozillaMach {
            pname = "gjoa${suffix}";
            version = firefoxVersion;
            applicationName = "Gjoa";
            binaryName = "gjoa";

            # Prepared source. Must run `bun run init` (downloads mozilla-central +
            # applies overlays) before `nix build .#gjoa`.
            #
            # Reference engine/ as an absolute path because it's gitignored
            # (5GB of mozilla-central source — too big to git-track). Pure
            # flake evaluation can't read paths outside the flake source, so
            # invoke with `--impure`. For a release build reproducible
            # without --impure, we'd commit a tarball of the prepared source
            # OR build engine/ as its own Nix derivation. Out of scope today.
            src = builtins.path {
              name = "gjoa-source";
              path = "/home/tom/code/gjoa/engine";
            };

            # buildMozillaMach defaults to extracting a tarball. Our src is
            # already-extracted source, so override unpack to a copy.
            # chmod +w because Nix store paths are read-only by default and
            # mach writes into the source tree during build.
            #
            # Delete engine/mozconfig: it's generated by tools/prep for
            # dev-shell mach builds and sets `--without-wasm-sandboxed-libraries`,
            # which conflicts with buildMozillaMach's `--with-wasi-sysroot`
            # (mozilla configure rejects the combo). Removing it here lets
            # buildMozillaMach's own configure flags be the only source of
            # truth for nix builds.
            unpackPhase = ''
              runHook preUnpack
              cp -r $src source
              chmod -R u+w source
              rm -f source/mozconfig
              cd source
              runHook postUnpack
            '';

            # Branding lives at browser/branding/gjoa/ inside the source
            # (placed there by the prep tool). buildMozillaMach picks up
            # `branding` and translates to --with-branding= and friends.
            branding = "browser/branding/gjoa";

            extraConfigureFlags = [
              "--with-distribution-id=org.gjoa"
              "--with-app-name=gjoa"
              "--with-app-basename=Gjoa"
            ];

            # Prep tool creates engine/.git/ for change tracking. mach
            # detects .git/ → tries to invoke `git` for VCS metadata →
            # fails because buildMozillaMach's deps don't include git.
            extraNativeBuildInputs = [ pkgs.git ];

            meta = with pkgs.lib; {
              description = "Gjoa — a Firefox fork";
              homepage = "https://github.com/tompassarelli/gjoa";
              license = licenses.mpl20;
              platforms = platforms.linux;
              mainProgram = "gjoa";
            };
          }).override {
            inherit pgoSupport ltoSupport crashreporterSupport;
          }).overrideAttrs (old: {
            # nixpkgs's buildMozillaMach applies a set of patches calibrated
            # to whatever Firefox version nixpkgs currently ships (149 at
            # time of writing). Two of those patches are macOS-SDK-version
            # reverts that target lines in `build/moz.configure/toolchain.configure`
            # which have already shifted in newer Firefox releases — they
            # fail to apply, and the build bails.
            #
            # On Linux those macOS reverts are no-ops anyway, so we drop them
            # and keep only the two version-stable nixpkgs build-system
            # patches (`136-no-buildconfig.patch`, `133-env-var-for-system-dir.patch`).
            patches = pkgs.lib.filter (p:
              let n = baseNameOf (toString p);
              in n == "136-no-buildconfig.patch"
              || n == "133-env-var-for-system-dir.patch"
            ) (old.patches or []);

            # =================================================================
            # sccache wiring is DISABLED here for now.
            #
            # Background: we tried `__noChroot = true` to give the build
            # write access to ~/.cache/sccache-gjoa so cache state survives
            # across nix builds. The nix daemon rejected it with
            # `sandbox = true` in nix.conf (not just a trusted-users
            # question — `__noChroot` requires `sandbox = relaxed`). Two
            # build attempts on 2026-05-26 died at evaluation before we
            # caught this; see BUILD-LEDGER postmortems.
            #
            # To turn sccache persistence back on, either:
            #   (a) set `sandbox = relaxed` in nixos-config nix-settings
            #       (system-wide loosening, affects every nix build), or
            #   (b) run sccache as a daemon outside the sandbox + connect
            #       via SCCACHE_REDIS (more setup, narrower blast radius)
            #
            # Until either lands, this block stays empty and nix builds
            # are cold every time. Mach builds (the daily path) have no
            # sandbox and already share state across runs via the objdir.
          });

        # Dev variant — what you build day-to-day. Skips PGO+LTO.
        gjoa-dev-unwrapped = mkGjoa {
          pgoSupport = false;
          ltoSupport = false;
          crashreporterSupport = false;
        };

        # Release variant — full PGO + LTO. What we ship.
        gjoa-release-unwrapped = mkGjoa {
          pgoSupport = true;
          ltoSupport = true;
          crashreporterSupport = false;  # would need dump_syms; not yet wired
          suffix = "-release";
        };

        # Wrap the unwrapped derivations with `wrapFirefox` — adds the .desktop
        # file, app icon registration, manpage, dbus name, GTK paths, plugin
        # dirs, and the binary launcher script. Without this, `nix profile
        # install` / home-manager install produces a binary in the nix store
        # but no XDG integration → invisible to rofi/drun/dock/launchers.
        #
        # Mirrors nixpkgs's own pattern:
        #   firefox = wrapFirefox firefox-unwrapped { };
        # Most attrs (applicationName, binaryName, branding, mainProgram) flow
        # through from the unwrapped derivation — `wrapFirefox { }` reads them
        # from there.
        gjoa-dev = pkgs.wrapFirefox gjoa-dev-unwrapped { };
        gjoa-release = pkgs.wrapFirefox gjoa-release-unwrapped { };
      in
      {
        # Defaults: `nix build .#gjoa` is the wrapped DEV variant — the thing
        # you actually install. The `*-unwrapped` outputs are the raw
        # buildMozillaMach derivations, exposed for downstream consumers that
        # want to do their own wrapping (and for our `mach build`-driven dev
        # iteration which doesn't go through wrapFirefox at all).
        packages.default = gjoa-dev;
        packages.gjoa = gjoa-dev;
        packages.gjoa-unwrapped = gjoa-dev-unwrapped;
        packages.gjoa-release = gjoa-release;
        packages.gjoa-release-unwrapped = gjoa-release-unwrapped;

        # ===================================================================
        # Dev shells — split into two intentionally:
        #
        #   default — minimal. bun + python + git. Tiny closure (~50MB).
        #             What direnv loads on `cd ~/code/gjoa`. Enough for
        #             editing TS, running `bun test`, `bun run import`,
        #             `bun run chrome:dist`. Should never trigger a
        #             multi-GB substituter fetch on terminal spawn.
        #
        #   mach    — full Firefox build toolchain. Heavy (~3GB closure).
        #             Enter explicitly with `nix develop .#mach` only when
        #             you're about to `./mach build` / `./mach build faster`.
        #
        # Why split: previously, opening any terminal in the repo pulled in
        # gtk3 + xorg.* + mesa + pulseaudio + cups + etc., which is the
        # Firefox link/runtime closure. That's ~3GB of substituter fetches
        # the first time, or whenever nixpkgs renames an attribute. The
        # user's actual daily workflow (edit TS, run bun) doesn't need any
        # of it. Splitting the shells gates the heavy fetch behind an
        # explicit opt-in.
        # ===================================================================
        devShells.default = pkgs.mkShell {
          packages = with pkgs; [
            # Bun is the runtime for all tools/* (TS without node).
            bun
            # mach itself wants python3, even though we drive it via fish/bun.
            python3
            python3Packages.pip
            python3Packages.virtualenv
            # tools/prep/patches.ts shells out to git for git-apply.
            git
            # SVG → PNG icon rendering (tools/icons/generate.ts).
            librsvg
          ];

          shellHook = ''
            if [[ $- == *i* ]]; then
              echo "gjoa devShell (minimal). For mach builds: nix develop .#mach"
            fi
          '';
        };

        devShells.mach = pkgs.mkShell {
          packages = with pkgs; [
            # Same as default + the Firefox build toolchain.
            bun
            python3
            python3Packages.pip
            python3Packages.virtualenv
            git
            mercurial
            gnumake
            librsvg

            # Toolchain — match what buildMozillaMach uses (llvm 19+).
            llvmPackages_19.clang
            llvmPackages_19.bintools
            llvmPackages_19.libclang
            llvmPackages_19.lld
            rustc
            cargo
            rust-cbindgen
            nasm
            yasm
            autoconf
            m4
            pkg-config
            unzip
            zip
            perl
            which

            # Build acceleration.
            sccache
            ccache
            mold

            # Native deps Firefox links against at compile/link time.
            gtk3
            glib
            dbus
            libGL
            libdrm
            mesa
            libxkbcommon
            wayland
            libx11
            libxcomposite
            libxdamage
            libxext
            libxfixes
            libxrandr
            libxtst
            libxcb
            libxi
            libxrender
            libxscrnsaver
            alsa-lib
            libpulseaudio
            cups
            nss
            nspr
            libffi
            zlib
            bzip2
            libjpeg
            libpng
            libvpx
            libwebp
            libevent
            fontconfig
            freetype
            pango
          ];

          shellHook = ''
            # ---- Toolchain env (mirrors what buildMozillaMach sets up) ----
            # bindgen needs libclang for Rust ↔ C bridge generation.
            export LIBCLANG_PATH="${pkgs.llvmPackages_19.libclang.lib}/lib"

            # AS=as in env causes mach failure (see mozilla bug 1497286).
            # mach picks the right assembler from clang automatically.
            unset AS

            # Don't try to send libnotify desktop notifications during build.
            export MOZ_NOSPAM=1

            # mach build state cache; in-tree so it ties to this checkout.
            export MOZBUILD_STATE_PATH="$PWD/engine/.mozbuild"
            export MOZ_OBJDIR="$PWD/engine/obj-x86_64-pc-linux-gnu"

            if [[ $- == *i* ]]; then
              cat <<'EOF'

gjoa mach shell — full Firefox build toolchain wired in.

  DAILY DEV LOOP (sub-30-sec for JS/CSS, few min for C++):
    bun run import               # re-apply overlays
    cd engine && ./mach build faster

  TROUBLESHOOTING:
    cd engine && ./mach clobber  # wipe obj-* if state gets confused

  NIX BUILD WHEN:
    - First time on this machine (or after `git clean`)
    - Bumping Firefox version
    - Toolchain change in flake.nix
EOF
            fi
          '';
        };
      });
}
