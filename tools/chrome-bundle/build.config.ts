// Entries that get bundled into dist/chrome/JS/<name>.uc.js for the
// fx-autoconfig loader. Each entry must produce a valid .uc.js with a
// UserScript header banner.
//
// Mechanically lifted from archive/build.config.ts (palefox v0.43.0).
// Names kept as `palefox-*` for now — the rename to `skiff-*` is a
// post-Batch-1 stretch goal (audit said: don't redesign first).

export type Entry = {
  /** TypeScript source path, relative to repo root. */
  src: string;
  /** Output basename (no path); written into dist/chrome/JS/. */
  out: string;
  /** UserScript-format header injected at the top of the bundled output. */
  banner: string;
};

const SRC = "src/skiff/chrome/src";

export const entries: Entry[] = [
  {
    src: `${SRC}/hello/index.ts`,
    out: "palefox-hello.uc.js",
    banner: [
      "// ==UserScript==",
      "// @name           Palefox Hello",
      "// @description    Confirms fx-autoconfig is working",
      "// @include        main",
      "// @onlyonce",
      "// ==/UserScript==",
    ].join("\n"),
  },
  {
    src: `${SRC}/drawer/index.ts`,
    out: "palefox-drawer.uc.js",
    banner: [
      "// ==UserScript==",
      "// @name           Palefox Drawer",
      "// @description    Manages sidebar layout, compact mode, and toolbar positioning",
      "// @include        main",
      "// ==/UserScript==",
    ].join("\n"),
  },
  {
    src: `${SRC}/tabs/index.ts`,
    out: "palefox-tabs.uc.js",
    banner: [
      "// ==UserScript==",
      "// @name           Palefox Tabs",
      "// @description    Tree-style tab panel with vim keybindings",
      "// @include        main",
      "// ==/UserScript==",
    ].join("\n"),
  },
];
