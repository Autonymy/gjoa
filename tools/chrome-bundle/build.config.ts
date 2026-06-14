export type Entry = {
  out: string;
  files: string[];
  banner: string;
};

const B = ".beagle-out";

export const entries: Entry[] = [
  {
    out: "gjoa-hello.uc.js",
    files: [`${B}/hello/index.js`],
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
    out: "gjoa-security.uc.js",
    files: [`${B}/security/index.js`],
    banner: [
      "// ==UserScript==",
      "// @name           Gjoa Security Gate",
      "// @description    Refuses to keep running if Firefox pin is stale",
      "// @include        main",
      "// ==/UserScript==",
    ].join("\n"),
  },
  {
    out: "gjoa-drawer.uc.js",
    files: [
      `${B}/tabs/log.js`,
      `${B}/drawer/timing.js`,
      `${B}/drawer/banner.js`,
      `${B}/drawer/compact.js`,
      `${B}/drawer/drag-overlay.js`,
      `${B}/drawer/layout.js`,
      `${B}/drawer/sidebar-button.js`,
      `${B}/drawer/urlbar.js`,
      `${B}/drawer/index.js`,
    ],
    banner: [
      "// ==UserScript==",
      "// @name           Gjoa Drawer",
      "// @description    Manages sidebar layout, compact mode, and toolbar positioning",
      "// @include        main",
      "// ==/UserScript==",
    ].join("\n"),
  },
  {
    out: "gjoa-tabs.uc.js",
    files: [
      `${B}/tabs/log.js`,
      `${B}/tabs/types.js`,
      `${B}/tabs/constants.js`,
      `${B}/tabs/state.js`,
      `${B}/firefox/dom.js`,
      `${B}/firefox/files.js`,
      `${B}/firefox/observers.js`,
      `${B}/firefox/prefs.js`,
      `${B}/firefox/tabs.js`,
      `${B}/firefox/window.js`,
      `${B}/tabs/helpers.js`,
      `${B}/tabs/snapshot.js`,
      `${B}/tabs/history.js`,
      `${B}/spaces/types.js`,
      `${B}/spaces/visibility.js`,
      `${B}/spaces/manager.js`,
      `${B}/platform/scheduler.js`,
      `${B}/platform/window-tabs.js`,
      `${B}/platform/window.js`,
      `${B}/platform/history.js`,
      `${B}/platform/tabs-reconciler.js`,
      `${B}/platform/cross-window-tabs.js`,
      `${B}/platform/index.js`,
      `${B}/tabs/layout.js`,
      `${B}/tabs/rows.js`,
      `${B}/tabs/drag.js`,
      `${B}/tabs/menu.js`,
      `${B}/tabs/events.js`,
      `${B}/tabs/picker.js`,
      `${B}/tabs/content-focus.js`,
      `${B}/tabs/vim.js`,
      `${B}/tabs/index.js`,
    ],
    banner: [
      "// ==UserScript==",
      "// @name           Gjoa Tabs",
      "// @description    Tree-style tab panel with vim keybindings",
      "// @include        main",
      "// ==/UserScript==",
    ].join("\n"),
  },
];
