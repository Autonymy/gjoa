// Bake the production chrome bundles into engine/ so they end up inside
// omni.ja and become reachable via chrome://gjoa/content/scripts/*.uc.js
// (and styles/) at runtime.
//
// Inputs:  dist/chrome/{JS,CSS}/*.uc.{js,css} from `bun run chrome:dist`
// Outputs: engine/browser/components/gjoa/content/{scripts,styles}/*
//
// Kept in sync with:
//   - src/gjoa/browser/components/gjoa/jar.mn         (which files get
//                                                      packaged into
//                                                      omni.ja)
//   - src/gjoa/browser/components/gjoa/GjoaLoader.sys.mjs
//                                                     (which files the
//                                                      loader will pull
//                                                      from chrome://)

import { existsSync } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { ENGINE_DIR, REPO_ROOT } from "./paths";
import { log } from "./log";

const DIST_CHROME = join(REPO_ROOT, "dist", "chrome");
const BAKE_ROOT = join(
  ENGINE_DIR,
  "browser",
  "components",
  "gjoa",
  "content",
);

// Hardcoded list — match jar.mn + GjoaLoader.sys.mjs PROD_SCRIPTS / PROD_STYLES.
const SCRIPTS = [
  "gjoa-security.uc.js",
  "gjoa-drawer.uc.js",
  "gjoa-tabs.uc.js",
];
const STYLES = [
  "gjoa.uc.css",
  "gjoa-tabs.uc.css",
  "gjoa-which-key.uc.css",
];

async function ensureChromeDist(): Promise<void> {
  if (existsSync(DIST_CHROME)) return;
  log.step("dist/chrome/ missing — running chrome:dist");
  const proc = Bun.spawn({
    cmd: ["bun", "run", "chrome:dist"],
    cwd: REPO_ROOT,
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await proc.exited;
  if (code !== 0) {
    throw new Error(`chrome:dist failed (exit ${code})`);
  }
}

async function bakeOne(srcSubdir: string, dstSubdir: string, names: string[]) {
  const dstDir = join(BAKE_ROOT, dstSubdir);
  await mkdir(dstDir, { recursive: true });
  for (const name of names) {
    const src = join(DIST_CHROME, srcSubdir, name);
    if (!existsSync(src)) {
      throw new Error(
        `chrome-bake: expected ${src} from chrome:dist (declared in jar.mn) — did the bundle list drift?`,
      );
    }
    await copyFile(src, join(dstDir, name));
  }
}

export async function chromeBake(): Promise<void> {
  await ensureChromeDist();
  log.step(`baking ${SCRIPTS.length} scripts + ${STYLES.length} stylesheets into engine`);
  await bakeOne("JS", "scripts", SCRIPTS);
  await bakeOne("CSS", "styles", STYLES);
  log.ok(`chrome bundles baked at ${BAKE_ROOT}`);
}
