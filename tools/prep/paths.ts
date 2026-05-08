import { homedir } from "node:os";
import { join, resolve } from "node:path";

// Repo root (assume cli.ts is invoked from anywhere; we resolve via tools/prep/.)
export const REPO_ROOT = resolve(import.meta.dir, "..", "..");

// Source overlays (committed). Layered onto engine/ during import.
export const SRC_DIR = join(REPO_ROOT, "src", "skiff");

// Branding source (icons live here; text files are derived from mozilla
// `unofficial` template at import time — see branding.ts).
export const BRANDING_SRC = join(REPO_ROOT, "configs", "branding", "skiff");

// Patches applied on top of mozilla-central. Empty for now.
export const PATCHES_DIR = join(REPO_ROOT, "patches");

// Working tree where mozilla-central is downloaded + overlaid. Gitignored.
export const ENGINE_DIR = join(REPO_ROOT, "engine");

// Inside engine/, where Firefox expects branding subtrees to live.
export const ENGINE_BRANDING_DIR = join(ENGINE_DIR, "browser", "branding");

// Mozilla's vanilla "unofficial" branding — used as a known-good template
// base for our skiff branding tree.
export const ENGINE_UNOFFICIAL_BRANDING = join(ENGINE_BRANDING_DIR, "unofficial");

// Per-skiff source-tarball cache, lives outside the repo (XDG-style).
// Survives `git clean -fdx`. Keyed by Firefox version.
export const CACHE_DIR = join(homedir(), ".cache", "skiff");
export const SOURCES_CACHE = join(CACHE_DIR, "sources");
