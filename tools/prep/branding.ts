import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { $ } from "bun";
import { loadConfig, type SkiffConfig } from "./config";
import {
  BRANDING_SRC,
  ENGINE_BRANDING_DIR,
  ENGINE_UNOFFICIAL_BRANDING,
} from "./paths";
import { log } from "./log";

// Files we string-substitute. Anything else (binary icons, archive formats,
// platform-specific blobs) is copied as-is from the unofficial template.
const TEXT_EXTS = new Set([
  ".js", ".dtd", ".ftl", ".properties", ".sh", ".nsi",
  ".xml", ".css", ".json", ".mn", ".svg", ".html",
]);
const TEXT_FILENAMES = new Set([
  "moz.build", "configure.sh", "branding.nsi", "jar.mn", "jar.inc.mn",
]);

function isTextFile(path: string): boolean {
  const base = path.split("/").pop() ?? "";
  if (TEXT_FILENAMES.has(base)) return true;
  return TEXT_EXTS.has(extname(path).toLowerCase());
}

// Substitution map. Order matters where overlapping strings exist —
// longer/more-specific replacements must run before shorter/generic ones.
function substitutions(cfg: SkiffConfig): Array<[RegExp, string]> {
  const b = cfg.branding;
  const u = cfg.urls;

  return [
    // Brand strings — long forms first so we don't accidentally substring-match
    // "Firefox Nightly" -> "Skiff Nightly".
    [/Firefox Nightly/g, b.fullName],
    [/Mozilla Firefox/g, b.fullName],
    [/Nightly/g, b.shortName],
    [/Firefox/g, b.productName],
    [/Mozilla/g, b.vendorName],

    // Welcome/whatsnew URLs (the ones that opened "Welcome to Zen!" pre-fix).
    [
      /pref\("startup\.homepage_override_url",\s*".*?"\);/,
      `pref("startup.homepage_override_url", "${u.homepageOverride}");`,
    ],
    [
      /pref\("startup\.homepage_welcome_url",\s*".*?"\);/,
      `pref("startup.homepage_welcome_url", "${u.welcome}");`,
    ],
    [
      /pref\("startup\.homepage_welcome_url\.additional",\s*".*?"\);/,
      `pref("startup.homepage_welcome_url.additional", "${u.welcomeAdditional}");`,
    ],

    // Update + release-notes URLs. Catches both nightly.mozilla.org and
    // www.mozilla.org/firefox/* templates.
    [
      /pref\("app\.update\.url\.manual",\s*".*?"\);/,
      `pref("app.update.url.manual", "${u.updateManual}");`,
    ],
    [
      /pref\("app\.update\.url\.details",\s*".*?"\);/,
      `pref("app.update.url.details", "${u.updateDetails}");`,
    ],
    [
      /pref\("app\.releaseNotesURL",\s*".*?"\);/,
      `pref("app.releaseNotesURL", "${u.releaseNotes}");`,
    ],
    [
      /pref\("app\.releaseNotesURL\.aboutDialog",\s*".*?"\);/,
      `pref("app.releaseNotesURL.aboutDialog", "${u.releaseNotesAboutDialog}");`,
    ],
    [
      /pref\("app\.releaseNotesURL\.prompt",\s*".*?"\);/,
      `pref("app.releaseNotesURL.prompt", "${u.releaseNotesPrompt}");`,
    ],

    // configure.sh: MOZ_APP_DISPLAYNAME=<whatever> -> our display name.
    [
      /MOZ_APP_DISPLAYNAME=.*/,
      `MOZ_APP_DISPLAYNAME=${b.displayName}`,
    ],
  ];
}

function applySubstitutions(text: string, cfg: SkiffConfig): string {
  let out = text;
  for (const [re, replacement] of substitutions(cfg)) {
    out = out.replace(re, replacement);
  }
  return out;
}

async function walkFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function recurse(dir: string): Promise<void> {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) await recurse(path);
      else out.push(path);
    }
  }
  await recurse(root);
  return out;
}

// Copy mozilla's unofficial branding tree to engine/browser/branding/<binaryName>/,
// applying string substitutions to text files and overwriting our PNG icons.
export async function branding(): Promise<void> {
  const cfg = loadConfig();
  const target = join(ENGINE_BRANDING_DIR, cfg.binaryName);

  if (!existsSync(ENGINE_UNOFFICIAL_BRANDING)) {
    throw new Error(
      `unofficial branding not found at ${ENGINE_UNOFFICIAL_BRANDING} — ` +
      `did you run \`bun run download\` first?`,
    );
  }

  log.step(`generating branding tree at engine/browser/branding/${cfg.binaryName}/`);
  if (existsSync(target)) await rm(target, { recursive: true });
  await mkdir(target, { recursive: true });

  // 1. Walk mozilla's unofficial tree and copy each file, with substitution
  //    on text files.
  const allFiles = await walkFiles(ENGINE_UNOFFICIAL_BRANDING);
  let textCount = 0;
  let binaryCount = 0;
  for (const src of allFiles) {
    const rel = relative(ENGINE_UNOFFICIAL_BRANDING, src);
    const dst = join(target, rel);
    await mkdir(dirname(dst), { recursive: true });
    if (isTextFile(src)) {
      const text = await readFile(src, "utf8");
      await writeFile(dst, applySubstitutions(text, cfg));
      textCount += 1;
    } else {
      // Binary copy — preserves icon bytes etc.
      await $`cp ${src} ${dst}`.quiet();
      binaryCount += 1;
    }
  }
  log.info(`copied ${textCount} text + ${binaryCount} binary files from unofficial template`);

  // 2. Overlay our own logo PNGs from configs/branding/skiff/. Mozilla's
  //    convention: defaultNN.png at the branding root for sizes the desktop
  //    integration needs (16/22/24/32/48/64/128/256/512). We expect logoNN.png
  //    in our source dir at matching sizes.
  const sizes = [16, 22, 24, 32, 48, 64, 128, 256, 512];
  let iconCount = 0;
  for (const size of sizes) {
    const src = join(BRANDING_SRC, `logo${size}.png`);
    const dst = join(target, `default${size}.png`);
    if (existsSync(src)) {
      await $`cp ${src} ${dst}`.quiet();
      iconCount += 1;
    } else {
      log.warn(`missing source icon: configs/branding/${cfg.binaryName}/logo${size}.png`);
    }
  }
  log.info(`installed ${iconCount} desktop icons`);

  // 3. Sanity check: assert no zen-browser.app substring leaked through. If
  //    mozilla ships a future template that references zen, our regex won't
  //    catch it — fail loud rather than silently shipping it.
  const written = await walkFiles(target);
  for (const f of written) {
    if (!isTextFile(f)) continue;
    const text = await readFile(f, "utf8");
    if (text.includes("zen-browser.app")) {
      throw new Error(`zen-browser.app leaked into ${f} — extend substitutions in branding.ts`);
    }
  }

  log.ok(`branding ready`);
}
