// gjoa dark mode prefs — chrome-level dark mode defaults.
// Shipped as DEFAULTS by appending this file onto the branding pref file in
// tools/prep/branding.ts at import time (the only pref channel packaged into
// omni.ja without a Mozilla-source patch). The copy that overlays to
// engine/defaults/pref/ is NOT packaged and has no effect.

// Master toggle: enables/disables dark mode entirely.
pref("gjoa.darkmode.enabled", false);

// Mode selector:
//   "auto"   — forces prefers-color-scheme: dark; sites with native dark
//              support automatically use it. No visual filter.
//   "filter" — applies SVG inversion filter at the browser compositor level
//              for sites without native dark mode. Counter-inverts images/video.
//   "off"    — dark mode disabled (same as enabled=false; exists so the mode
//              pref can be cycled without touching the enabled toggle).
pref("gjoa.darkmode.mode", "auto");
