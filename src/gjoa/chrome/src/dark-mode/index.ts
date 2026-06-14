// Chrome-level dark mode — a Lane 1 userscript (no rebuild; hot-reloads via
// `gjoa sync`). It does NOT touch the compositor or inject any script into web
// content. It works through two Gecko-native chrome mechanisms:
//   - an nsIStyleSheetService AGENT_SHEET that forces `color-scheme: dark` on
//     content :root, so sites with `@media (prefers-color-scheme: dark)` rules
//     activate them — no per-page script injection;
//   - a CSS `filter: invert()` applied to the <browser> frame via a chrome
//     <style> element, for sites without native dark support.
//
// Three modes (controlled by `gjoa.darkmode.mode` pref):
//   - "auto"   — color-scheme forcing only; rely on sites' native dark CSS.
//   - "filter" — also apply the inversion filter (counter-inverts img/video).
//   - "off"    — dark mode disabled regardless of `gjoa.darkmode.enabled`.

import * as prefs from "../firefox/prefs.ts";

// =============================================================================
// CONSTANTS
// =============================================================================

const PREF_ENABLED = "gjoa.darkmode.enabled";
const PREF_MODE = "gjoa.darkmode.mode";

// The agent-level stylesheet forces `prefers-color-scheme: dark` evaluation
// on all web content by setting color-scheme on :root. This makes sites
// with `@media (prefers-color-scheme: dark)` rules activate them.
const CONTENT_DARK_CSS = `
:root {
  color-scheme: dark !important;
}
`;

// SVG filter stylesheet — applied to the <browser> element (the frame that
// contains web content). Counter-inverts media elements so photos/videos
// aren't negated.
const FILTER_CSS_ID = "gjoa-darkmode-filter-style";
const FILTER_CSS = `
#tabbrowser-tabpanels browser {
  filter: invert(0.9) hue-rotate(180deg) !important;
}
#tabbrowser-tabpanels browser img,
#tabbrowser-tabpanels browser video,
#tabbrowser-tabpanels browser canvas,
#tabbrowser-tabpanels browser svg {
  filter: invert(1) hue-rotate(180deg) !important;
}
`;

// =============================================================================
// STATE
// =============================================================================

let contentSheetRegistered = false;
let filterStyleElement: HTMLElement | null = null;
let unsubEnabled: (() => void) | null = null;
let unsubMode: (() => void) | null = null;

// Cached reference to nsIStyleSheetService
const STYLE_SHEET_SERVICE = Cc["@mozilla.org/content/style-sheet-service;1"]
  .getService(Ci.nsIStyleSheetService) as {
  loadAndRegisterSheet(uri: unknown, type: number): void;
  unregisterSheet(uri: unknown, type: number): void;
  sheetRegistered(uri: unknown, type: number): boolean;
  readonly AGENT_SHEET: number;
};

// =============================================================================
// CONTENT STYLESHEET (prefers-color-scheme: dark forcing)
// =============================================================================

function makeDataURI(css: string): unknown {
  const encoded = encodeURIComponent(css.trim());
  return Services.io.newURI(`data:text/css,${encoded}`);
}

function registerContentDarkSheet(): void {
  if (contentSheetRegistered) return;
  const uri = makeDataURI(CONTENT_DARK_CSS);
  try {
    if (!STYLE_SHEET_SERVICE.sheetRegistered(uri, STYLE_SHEET_SERVICE.AGENT_SHEET)) {
      STYLE_SHEET_SERVICE.loadAndRegisterSheet(uri, STYLE_SHEET_SERVICE.AGENT_SHEET);
    }
    contentSheetRegistered = true;
    console.log("gjoa-darkmode: content dark stylesheet registered");
  } catch (e) {
    console.error("gjoa-darkmode: failed to register content stylesheet", e);
  }
}

function unregisterContentDarkSheet(): void {
  if (!contentSheetRegistered) return;
  const uri = makeDataURI(CONTENT_DARK_CSS);
  try {
    if (STYLE_SHEET_SERVICE.sheetRegistered(uri, STYLE_SHEET_SERVICE.AGENT_SHEET)) {
      STYLE_SHEET_SERVICE.unregisterSheet(uri, STYLE_SHEET_SERVICE.AGENT_SHEET);
    }
    contentSheetRegistered = false;
    console.log("gjoa-darkmode: content dark stylesheet unregistered");
  } catch (e) {
    console.error("gjoa-darkmode: failed to unregister content stylesheet", e);
  }
}

// =============================================================================
// FILTER STYLE (SVG inversion on <browser> element)
// =============================================================================

function applyFilter(): void {
  if (filterStyleElement) return;
  const style = document.createElement("style");
  style.id = FILTER_CSS_ID;
  style.textContent = FILTER_CSS;
  document.documentElement.appendChild(style);
  filterStyleElement = style;
  console.log("gjoa-darkmode: inversion filter applied");
}

function removeFilter(): void {
  if (!filterStyleElement) return;
  filterStyleElement.remove();
  filterStyleElement = null;
  console.log("gjoa-darkmode: inversion filter removed");
}

// =============================================================================
// CHROME COLOR SCHEME
// =============================================================================

function setChromeColorScheme(dark: boolean): void {
  if (dark) {
    document.documentElement.style.colorScheme = "dark";
    document.documentElement.setAttribute("gjoa-darkmode", "true");
  } else {
    document.documentElement.style.removeProperty("color-scheme");
    document.documentElement.removeAttribute("gjoa-darkmode");
  }
}

// =============================================================================
// ORCHESTRATION
// =============================================================================

function getMode(): string {
  return prefs.getString(PREF_MODE, "auto");
}

function isEnabled(): boolean {
  return prefs.getBool(PREF_ENABLED, false);
}

function apply(): void {
  const enabled = isEnabled();
  const mode = getMode();

  if (!enabled || mode === "off") {
    // Disable everything
    setChromeColorScheme(false);
    unregisterContentDarkSheet();
    removeFilter();
    return;
  }

  // Always force dark color-scheme on chrome and content
  setChromeColorScheme(true);
  registerContentDarkSheet();

  // Filter mode adds the SVG inversion for sites without native dark support
  if (mode === "filter") {
    applyFilter();
  } else {
    // "auto" mode — rely on sites' native @media (prefers-color-scheme: dark)
    removeFilter();
  }
}

// =============================================================================
// PUBLIC API — toggle for toolbar button integration
// =============================================================================

/**
 * Toggle dark mode on/off. If `force` is provided, sets to that state
 * rather than toggling. Returns the new enabled state.
 */
function toggle(force?: boolean): boolean {
  const newState = force !== undefined ? force : !isEnabled();
  prefs.setBool(PREF_ENABLED, newState);
  // apply() will be called by the pref observer
  return newState;
}

/**
 * Cycle through modes: auto -> filter -> off -> auto.
 * Returns the new mode string.
 */
function cycleMode(): string {
  const current = getMode();
  let next: string;
  if (current === "auto") next = "filter";
  else if (current === "filter") next = "off";
  else next = "auto";
  prefs.setString(PREF_MODE, next);
  // apply() will be called by the pref observer
  return next;
}

// =============================================================================
// INIT / TEARDOWN
// =============================================================================

function init(): void {
  // Apply initial state
  apply();

  // Listen for pref changes — toggle on/off without restart
  unsubEnabled = prefs.observe(PREF_ENABLED, () => apply());
  unsubMode = prefs.observe(PREF_MODE, () => apply());

  // Expose toggle API on window for toolbar button integration
  (window as unknown as Record<string, unknown>).gjoaDarkMode = {
    toggle,
    cycleMode,
    isEnabled,
    getMode,
  };

  window.addEventListener("unload", destroy, { once: true });

  console.log(
    `gjoa-darkmode: initialized (enabled=${isEnabled()}, mode=${getMode()})`,
  );
}

function destroy(): void {
  unsubEnabled?.();
  unsubMode?.();
  unsubEnabled = null;
  unsubMode = null;

  setChromeColorScheme(false);
  unregisterContentDarkSheet();
  removeFilter();

  delete (window as unknown as Record<string, unknown>).gjoaDarkMode;
}

init();
