{
  description = "Skiff — a Firefox fork built via nixpkgs's buildMozillaMach";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };

        # Delegate the actual Firefox compile to nixpkgs's `buildMozillaMach`
        # — ~750 lines of carefully-tuned Nix that handles every toolchain
        # quirk (libclang paths, AS=clang, sccache invocation order,
        # wasm-sandbox libs, RLBox, mold linker, etc.) for upstream
        # firefox-unwrapped.
        #
        # We feed it our customized source: tools/prep/ downloads
        # mozilla-central to ./engine/ then overlays src/skiff/, branding,
        # patches. Nix imports ./engine/ as the derivation source.
        #
        # TWO BUILD VARIANTS:
        #   skiff         = dev quality (no PGO, no LTO, no crashreporter)
        #                   what `nix build .#skiff` produces — fast iteration
        #   skiff-release = release quality (full PGO + LTO + everything)
        #                   what we ship — same correctness, longer build,
        #                   ~5-15% faster runtime. Use only for distribution.
        #
        # buildMozillaMach has TWO arg lists:
        #   1. user args (pname, version, src, branding, ...) → passed directly
        #   2. callPackage args (pgoSupport, ltoSupport, crashreporterSupport, ...)
        #      → set as defaults inside, override via .override
        # The dance: build with user args, then .override the feature flags.
        mkSkiff = { pgoSupport, ltoSupport, crashreporterSupport, suffix ? "" }:
          (pkgs.buildMozillaMach {
            pname = "skiff${suffix}";
            version = "150.0";
            applicationName = "Skiff";
            binaryName = "skiff";

            # Prepared source. Must run `bun run init` (downloads mozilla-central +
            # applies overlays) before `nix build .#skiff`.
            #
            # Reference engine/ as an absolute path because it's gitignored
            # (5GB of mozilla-central source — too big to git-track). Pure
            # flake evaluation can't read paths outside the flake source, so
            # invoke with `--impure`. For a release build reproducible
            # without --impure, we'd commit a tarball of the prepared source
            # OR build engine/ as its own Nix derivation. Out of scope today.
            src = builtins.path {
              name = "skiff-source";
              path = "/home/tom/code/skiff/engine";
            };

            # buildMozillaMach defaults to extracting a tarball. Our src is
            # already-extracted source, so override unpack to a copy.
            # chmod +w because Nix store paths are read-only by default and
            # mach writes into the source tree during build.
            unpackPhase = ''
              runHook preUnpack
              cp -r $src source
              chmod -R u+w source
              cd source
              runHook postUnpack
            '';

            # Branding lives at browser/branding/skiff/ inside the source
            # (placed there by the prep tool). buildMozillaMach picks up
            # `branding` and translates to --with-branding= and friends.
            branding = "browser/branding/skiff";

            extraConfigureFlags = [
              "--with-distribution-id=org.skiff"
              "--with-app-name=skiff"
              "--with-app-basename=Skiff"
            ];

            # Prep tool creates engine/.git/ for change tracking. mach
            # detects .git/ → tries to invoke `git` for VCS metadata →
            # fails because buildMozillaMach's deps don't include git.
            extraNativeBuildInputs = [ pkgs.git ];

            meta = with pkgs.lib; {
              description = "Skiff — a Firefox fork";
              homepage = "https://github.com/tompassarelli/skiff";
              license = licenses.mpl20;
              platforms = platforms.linux;
              mainProgram = "skiff";
            };
          }).override {
            inherit pgoSupport ltoSupport crashreporterSupport;
          };

        # Dev variant — what you build day-to-day. Skips PGO+LTO.
        skiff-dev = mkSkiff {
          pgoSupport = false;
          ltoSupport = false;
          crashreporterSupport = false;
        };

        # Release variant — full PGO + LTO. What we ship.
        skiff-release = mkSkiff {
          pgoSupport = true;
          ltoSupport = true;
          crashreporterSupport = false;  # would need dump_syms; not yet wired
          suffix = "-release";
        };
      in
      {
        # Defaults: `nix build .#skiff` is the FAST dev variant.
        # Use `.#skiff-release` when actually shipping.
        packages.default = skiff-dev;
        packages.skiff = skiff-dev;
        packages.skiff-release = skiff-release;

        # ===================================================================
        # Dev shell — provides EVERYTHING `mach build faster` needs to run
        # against engine/ directly, bypassing nix build for fast iteration.
        # The same toolchain buildMozillaMach uses, plus the env vars mach
        # expects (LIBCLANG_PATH, AS unset, etc).
        #
        # Use this for daily JS/CSS iteration. Use `nix build .#skiff`
        # only for cold-start bootstrap, Firefox version bumps, or release.
        # ===================================================================
        devShells.default = pkgs.mkShell {
          packages = with pkgs; [
            # Prep tool + scripting
            nodejs_20
            bun
            python3
            python3Packages.pip
            python3Packages.virtualenv

            # VCS / build orchestration
            git
            mercurial
            gnumake

            # Toolchain — match what buildMozillaMach uses (llvm 19+)
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

            # Build acceleration
            sccache
            ccache
            mold

            # SVG → PNG icon rendering (used by tools/icons/generate.ts)
            librsvg

            # Native deps Firefox links against (mach build needs at link time)
            gtk3
            glib
            dbus
            libGL
            libdrm
            mesa
            libxkbcommon
            wayland
            xorg.libX11
            xorg.libXcomposite
            xorg.libXdamage
            xorg.libXext
            xorg.libXfixes
            xorg.libXrandr
            xorg.libXtst
            xorg.libxcb
            xorg.libXi
            xorg.libXrender
            xorg.libXScrnSaver
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

            # ---- Persistent state (NOT in /tmp — survives reboots) ----
            # mach build state cache. Defaults to ~/.mozbuild but we keep
            # it in-tree under engine/ so it ties to this checkout.
            export MOZBUILD_STATE_PATH="$PWD/engine/.mozbuild"

            # Where mach puts compile output. Same as nix build's MOZ_OBJDIR
            # convention so artifacts match.
            export MOZ_OBJDIR="$PWD/engine/obj-x86_64-pc-linux-gnu"

            cat <<'EOF'

skiff dev shell — mach is on PATH, env wired for direct iteration.

  COLD START (one-time, or when bumping Firefox version):
    bun run init                 # downloads mozilla-central + applies overlays
    nix build .#skiff --impure   # produces ./result/bin/skiff

  DAILY DEV LOOP (sub-30-sec for JS/CSS, few min for C++):
    cd engine
    ./mach build faster          # only re-zips omni.ja
    $MOZ_OBJDIR/dist/bin/skiff   # run the built binary

  AFTER EDITING src/skiff/ OR configs/:
    bun run import               # re-applies overlays + branding
    cd engine && ./mach build faster

  TROUBLESHOOTING:
    cd engine && ./mach clobber  # wipe obj-* if state gets confused

  NIX BUILD WHEN:
    - First time on this machine (or after `git clean`)
    - Bumping Firefox version (skiff.json change)
    - Producing a release artifact for distribution
    - Toolchain change in flake.nix
EOF
          '';
        };
      });
}
