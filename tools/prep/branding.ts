import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { $ } from "bun";
import { loadConfig, type GjoaConfig } from "./config";
import {
  BRANDING_SRC,
  ENGINE_BRANDING_DIR,
  ENGINE_UNOFFICIAL_BRANDING,
  SRC_DIR,
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

// Substitution map. Each pattern is INTENTIONALLY narrow — never substitute
// bare "Mozilla" or "Firefox" as that breaks MPL headers ("Mozilla Public
// License"), URLs (mozilla.org/MPL/2.0), file paths (firefox-branding.js),
// and generic comments. Only swap brand strings inside specific structured
// patterns we recognize.
function substitutions(cfg: GjoaConfig): Array<[RegExp, string]> {
  const b = cfg.branding;
  const u = cfg.urls;

  return [
    // ---- brand.ftl entries (Fluent localization format) ----
    [/^-brand-shorter-name\s*=.*$/m, `-brand-shorter-name = ${b.shorterName}`],
    [/^-brand-short-name\s*=.*$/m, `-brand-short-name = ${b.shortName}`],
    [/^-brand-shortcut-name\s*=.*$/m, `-brand-shortcut-name = ${b.shortName}`],
    [/^-brand-full-name\s*=.*$/m, `-brand-full-name = ${b.fullName}`],
    [/^-brand-product-name\s*=.*$/m, `-brand-product-name = ${b.productName}`],
    [/^-vendor-short-name\s*=.*$/m, `-vendor-short-name = ${b.vendorName}`],

    // ---- brand.dtd entries (XML entity format) ----
    [/<!ENTITY brandShorterName ".*?">/g, `<!ENTITY brandShorterName "${b.shorterName}">`],
    [/<!ENTITY brandShortName ".*?">/g, `<!ENTITY brandShortName "${b.shortName}">`],
    [/<!ENTITY brandShortcutName ".*?">/g, `<!ENTITY brandShortcutName "${b.shortName}">`],
    [/<!ENTITY brandFullName ".*?">/g, `<!ENTITY brandFullName "${b.fullName}">`],
    [/<!ENTITY brandProductName ".*?">/g, `<!ENTITY brandProductName "${b.productName}">`],
    [/<!ENTITY vendorShortName ".*?">/g, `<!ENTITY vendorShortName "${b.vendorName}">`],

    // ---- brand.properties entries (key=value format) ----
    [/^brandShorterName\s*=.*$/m, `brandShorterName=${b.shorterName}`],
    [/^brandShortName\s*=.*$/m, `brandShortName=${b.shortName}`],
    [/^brandShortcutName\s*=.*$/m, `brandShortcutName=${b.shortName}`],
    [/^brandFullName\s*=.*$/m, `brandFullName=${b.fullName}`],
    [/^brandProductName\s*=.*$/m, `brandProductName=${b.productName}`],
    [/^vendorShortName\s*=.*$/m, `vendorShortName=${b.vendorName}`],

    // ---- firefox-branding.js prefs ----
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
    // www.mozilla.org/firefox/* upstream templates.
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

    // ---- configure.sh ----
    [
      /^MOZ_APP_DISPLAYNAME=.*$/m,
      `MOZ_APP_DISPLAYNAME=${b.displayName}`,
    ],

    // ---- branding.nsi (Windows NSIS installer defines) ----
    [
      /^!define BrandShortName ".*?"$/m,
      `!define BrandShortName "${b.shortName}"`,
    ],
    [
      /^!define BrandFullName ".*?"$/m,
      `!define BrandFullName "${b.fullName}"`,
    ],
    [
      /^!define BrandFullNameInternal ".*?"$/m,
      `!define BrandFullNameInternal "${b.fullName}"`,
    ],
    [
      /^!define CompanyName ".*?"$/m,
      `!define CompanyName "${b.vendorName}"`,
    ],
  ];
}

function applySubstitutions(text: string, cfg: GjoaConfig): string {
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

  // 1b. Append gjoa's default prefs onto the branding pref file. firefox-branding.js
  //     is the ONE default-pref file this repo can ship without patching Mozilla
  //     source: it's already declared in branding-common.mozbuild via
  //     JS_PREFERENCE_FILES and enumerated in package-manifest.in, so it lands in
  //     omni.ja under defaults/pref/ and is read onto the default branch at startup.
  //     (The same source files also overlay to engine/defaults/pref/ via the generic
  //     overlay, but THAT path has no moz.build and is never packaged — this append
  //     is what actually makes the prefs take effect. See BUILD-LEDGER: unreferenced
  //     files in the objdir are silently dropped by mozpack.)
  //     Appended AFTER substitutions so pref values pass through verbatim.
  const brandingPrefFile = join(target, "pref", "firefox-branding.js");
  if (!existsSync(brandingPrefFile)) {
    throw new Error(
      `branding pref file missing at ${brandingPrefFile} — Mozilla's unofficial ` +
      `template no longer ships pref/firefox-branding.js, so gjoa default prefs ` +
      `would not be packaged. Register a pref file explicitly before relying on this.`,
    );
  }
  const gjoaPrefFiles = ["perf-prefs.js", "dark-mode-prefs.js"];
  let prefBlocks =
    "\n\n// ===== gjoa default prefs (appended by tools/prep/branding.ts) =====\n";
  for (const name of gjoaPrefFiles) {
    const src = join(SRC_DIR, "defaults", "pref", name);
    if (!existsSync(src)) throw new Error(`gjoa pref source missing: ${src}`);
    prefBlocks += `\n// ---- ${name} ----\n` + (await readFile(src, "utf8")).trimEnd() + "\n";
  }
  await writeFile(brandingPrefFile, (await readFile(brandingPrefFile, "utf8")) + prefBlocks);
  log.info(
    `appended ${gjoaPrefFiles.length} gjoa pref files to branding/${cfg.binaryName}/pref/firefox-branding.js`,
  );

  // 2. Overlay our own logo PNGs from configs/branding/gjoa/. Mozilla's
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

  // 3. Overlay our content/ directory wholesale onto engine/.../gjoa/content/.
  //    Replaces the Firefox-logo PNGs/SVGs that copied through from the
  //    unofficial template (about-logo*, about-wordmark, etc.) with ours.
  const ourContent = join(BRANDING_SRC, "content");
  const targetContent = join(target, "content");
  if (existsSync(ourContent)) {
    let contentCount = 0;
    for (const name of readdirSync(ourContent)) {
      const src = join(ourContent, name);
      if (!statSync(src).isFile()) continue;
      const dst = join(targetContent, name);
      await $`cp ${src} ${dst}`.quiet();
      contentCount += 1;
    }
    log.info(`overlaid ${contentCount} content/ files (about-logo, wordmarks)`);
  }

  // 4. Sanity check: assert no zen-browser.app substring leaked through. If
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
