#!/usr/bin/env bun
// Render assets/skiff.svg → all the PNG sizes Firefox/skiff needs.
// Outputs go into configs/branding/skiff/ and configs/branding/skiff/content/.
// Run after editing assets/skiff.svg, then `bun run import` to push to engine/.

import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { copyFile } from "node:fs/promises";
import { $ } from "bun";
import { BRANDING_SRC, REPO_ROOT } from "../prep/paths";
import { log } from "../prep/log";

const SOURCE_SVG = join(REPO_ROOT, "assets", "skiff.svg");
const CONTENT_DIR = join(BRANDING_SRC, "content");

// Desktop integration sizes (default<N>.png in the install tree). Mozilla
// expects these exact sizes — see how unofficial branding ships them.
const DESKTOP_SIZES = [16, 22, 24, 32, 48, 64, 128, 256, 512];

// Larger logo sizes Skiff carries beyond what unofficial branding does.
// Used by macOS bundles + as upscale source for hi-DPI surfaces.
const EXTRA_LOGO_SIZES = [1024];

// about:* page logos (in-omni.ja, used for new-tab favicon, about:home, etc).
// Need 1x and 2x for retina.
const ABOUT_LOGO_SIZE = 192;
const ABOUT_LOGO_2X_SIZE = 384;

async function ensureRsvg(): Promise<void> {
  try {
    await $`rsvg-convert --version`.quiet();
  } catch {
    throw new Error(
      "rsvg-convert not found. Enter the dev shell first: `nix develop` " +
      "(or `direnv allow` if you have direnv set up).",
    );
  }
}

async function renderPng(size: number, dest: string): Promise<void> {
  await $`rsvg-convert -w ${size} -h ${size} ${SOURCE_SVG} -o ${dest}`.quiet();
}

async function main(): Promise<void> {
  if (!existsSync(SOURCE_SVG)) {
    throw new Error(`source SVG not found at ${SOURCE_SVG}`);
  }
  await ensureRsvg();
  mkdirSync(BRANDING_SRC, { recursive: true });
  mkdirSync(CONTENT_DIR, { recursive: true });

  log.step(`rendering desktop integration icons (logo<N>.png)`);
  for (const size of [...DESKTOP_SIZES, ...EXTRA_LOGO_SIZES]) {
    const dest = join(BRANDING_SRC, `logo${size}.png`);
    await renderPng(size, dest);
  }
  // logo.png + logo-mac.png are aliases for the largest sizes.
  await copyFile(join(BRANDING_SRC, "logo512.png"), join(BRANDING_SRC, "logo.png"));
  await copyFile(join(BRANDING_SRC, "logo1024.png"), join(BRANDING_SRC, "logo-mac.png"));
  log.ok(`wrote ${DESKTOP_SIZES.length + EXTRA_LOGO_SIZES.length + 2} desktop icons`);

  log.step(`rendering about-page logos (in-omni.ja)`);
  await renderPng(ABOUT_LOGO_SIZE, join(CONTENT_DIR, "about-logo.png"));
  await renderPng(ABOUT_LOGO_2X_SIZE, join(CONTENT_DIR, "about-logo@2x.png"));
  // Private-browsing variant — same icon for now (could add a tinted version later).
  await renderPng(ABOUT_LOGO_SIZE, join(CONTENT_DIR, "about-logo-private.png"));
  await renderPng(ABOUT_LOGO_2X_SIZE, join(CONTENT_DIR, "about-logo-private@2x.png"));
  log.ok(`wrote 4 about-page icons`);

  log.step(`copying source SVG to about-logo + wordmark slots`);
  // about-logo SVGs render directly in about: pages for theme-aware tinting.
  await copyFile(SOURCE_SVG, join(CONTENT_DIR, "about-logo.svg"));
  await copyFile(SOURCE_SVG, join(CONTENT_DIR, "about-logo-private.svg"));
  // wordmark slots — for now ship the icon SVG; we can replace with a real
  // text-wordmark when the brand identity is set.
  await copyFile(SOURCE_SVG, join(CONTENT_DIR, "about-wordmark.svg"));
  await copyFile(SOURCE_SVG, join(CONTENT_DIR, "firefox-wordmark.svg"));
  log.ok(`wrote 4 SVGs`);

  log.ok(`done — run \`bun run import\` to push these into engine/`);
}

main().catch((err) => {
  log.error(err.message ?? String(err));
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});
