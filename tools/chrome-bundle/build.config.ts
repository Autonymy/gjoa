// Entries that get bundled into dist/chrome/JS/<name>.uc.js for
// GjoaLoader (src/gjoa/browser/components/gjoa/GjoaLoader.sys.mjs).
// Each entry must produce a valid .uc.js with a UserScript header
// banner.
//
// Mechanically lifted from archive/build.config.ts (palefox v0.43.0).

export type Entry = {
  /** TypeScript source path, relative to repo root. */
  src: string;
  /** Output basename (no path); written into dist/chrome/JS/. */
  out: string;
  /** UserScript-format header injected at the top of the bundled output. */
  banner: string;
};

const SRC = "src/gjoa/chrome/src";

export const entries: Entry[] = [
  {
    src: `${SRC}/hello/index.ts`,
    out: "gjoa-hello.uc.js",
    banner: [
      "// ==UserScript==",
      "// @name           Gjoa Hello",
      "// @description    Confirms the chrome loader is working",
      "// @include        main",
      "// @onlyonce",
      "// ==/UserScript==",
    ].join("\n"),
  },
  {
    src: `${SRC}/security/index.ts`,
    out: "gjoa-security.uc.js",
    banner: [
      "// ==UserScript==",
      "// @name           Gjoa Security Gate",
      "// @description    Refuses to keep running if Firefox pin is stale",
      "// @include        main",
      "// ==/UserScript==",
    ].join("\n"),
  },
  {
    src: `${SRC}/drawer/index.ts`,
    out: "gjoa-drawer.uc.js",
    banner: [
      "// ==UserScript==",
      "// @name           Gjoa Drawer",
      "// @description    Manages sidebar layout, compact mode, and toolbar positioning",
      "// @include        main",
      "// ==/UserScript==",
    ].join("\n"),
  },
  {
    src: `${SRC}/tabs/index.ts`,
    out: "gjoa-tabs.uc.js",
    banner: [
      "// ==UserScript==",
      "// @name           Gjoa Tabs",
      "// @description    Tree-style tab panel with vim keybindings",
      "// @include        main",
      "// ==/UserScript==",
    ].join("\n"),
  },
  {
    src: `${SRC}/dark-mode/index.ts`,
    out: "gjoa-dark-mode.uc.js",
    banner: [
      "// ==UserScript==",
      "// @name           Gjoa Dark Mode",
      "// @description    Chrome-level dark mode: content agent stylesheet (color-scheme) + optional CSS inversion filter",
      "// @include        main",
      "// ==/UserScript==",
    ].join("\n"),
  },
];
