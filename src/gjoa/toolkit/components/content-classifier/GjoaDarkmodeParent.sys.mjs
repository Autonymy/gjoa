/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Parent half of the gjoa per-site dark-mode HYBRID actor. Decides the
// per-document colorInversionOverride from trusted parent-process state: the
// dark-mode mode, the per-site override prefs, and (for the auto refiner) the
// child's measurement of whether the page authored itself dark.
//
// Two decision surfaces:
//   #explicit() — the curated fix registry + user per-site prefs. Returned at
//     document-start (Darkmode:GetInject) so curated sites apply their override
//     + css + inject BEFORE first paint (no flash).
//   #auto()     — the post-paint refiner (Darkmode:Decide). Only runs for sites
//     with no explicit decision. With the engine's pre-paint default-invert
//     (gjoa.darkmode.hybrid.default-invert) on, it defers to the engine for
//     themeless pages and only retracts ("inactive") sites whose AUTHORED
//     background is dark but the engine's root-only pre-paint check missed.

const ENABLED_PREF = "gjoa.darkmode.enabled";
const MODE_PREF = "gjoa.darkmode.mode";
const FORCE_NATIVE_PREF = "gjoa.darkmode.user.force-native";
const FORCE_INVERT_PREF = "gjoa.darkmode.user.force-invert";
const OFF_PREF = "gjoa.darkmode.user.off";
// Engine default-invert (read by nsPresContext::UpdateColorInversion); when on,
// the engine darkens themeless pages pre-paint and the actor only refines.
const DEFAULT_INVERT_PREF = "gjoa.darkmode.hybrid.default-invert";

// Curated per-site dark-mode fix registry (Dark-Reader-derived, MIT). Packaged
// to resource://gre/modules/darkmode-fixes.json (FINAL_TARGET_FILES.modules).
// Inert-but-safe until the build packages it: loadFixes() catches the fetch
// failure and returns {} so the actor falls back to the user.*-pref + auto path.
const FIXES_URL = "resource://gre/modules/darkmode-fixes.json";

let gFixes = null; // host -> fix record
let gFixesLoading = null; // de-dupe concurrent first-load

async function loadFixes() {
  if (gFixes) {
    return gFixes;
  }
  if (gFixesLoading) {
    return gFixesLoading;
  }
  gFixesLoading = (async () => {
    try {
      const resp = await fetch(FIXES_URL);
      gFixes = await resp.json();
    } catch (e) {
      gFixes = {}; // never retry-loop; missing data = no fixes
    }
    mirrorOverridesPref(gFixes);
    return gFixes;
  })();
  return gFixesLoading;
}

// Mirror the registry's host -> override into a pref the CONTENT-process actor
// reads SYNCHRONOUSLY at document-start (before PresShell::Initialize), so a
// curated site's override lands pre-paint with no IPC round-trip — eliminating
// the brief double-dark on attribute-gated sites (e.g. YouTube's html[dark]).
function mirrorOverridesPref(fixes) {
  try {
    const overrides = {};
    for (const host of Object.keys(fixes || {})) {
      overrides[host] = fixes[host].override || "inactive";
    }
    Services.prefs.setStringPref(
      "gjoa.darkmode.fix-overrides",
      JSON.stringify(overrides)
    );
  } catch (e) {}
}

// Most-specific host match: exact host, then walk parent domains.
function fixForHost(fixes, host) {
  if (!fixes || !host) {
    return null;
  }
  if (fixes[host]) {
    return fixes[host];
  }
  let h = host;
  let i;
  while ((i = h.indexOf(".")) !== -1) {
    h = h.slice(i + 1);
    if (fixes[h]) {
      return fixes[h];
    }
  }
  return null;
}

function hostOf(url) {
  try {
    return Services.io.newURI(url).host.toLowerCase();
  } catch (e) {
    return "";
  }
}

// host matches the pref's CSV exactly or as a parent domain.
function hostInPref(host, pref) {
  let raw = "";
  try {
    raw = Services.prefs.getStringPref(pref, "");
  } catch (e) {}
  return raw
    .split(",")
    .map(h => h.trim().toLowerCase())
    .filter(Boolean)
    .some(h => host === h || host.endsWith("." + h));
}

// ── APCA contrast + backdrop-aware corrective retone ───────────────────────────
// Keep in sync with tools/darkmode-regress/snap.js (the deterministic suite uses
// the exact same math to MEASURE; here we apply it to FIX). Pure functions.
const NORMALIZE_PREF = "gjoa.darkmode.normalize.enabled";
const NORMALIZE_FLOOR_PREF = "gjoa.darkmode.normalize.floor";

function _lin(c) { return Math.pow(c / 255, 2.4); }
function _Ys(p) { return 0.2126729 * _lin(p[0]) + 0.7151522 * _lin(p[1]) + 0.0721750 * _lin(p[2]); }
function _apca(t, b) {
  let Yt = _Ys(t), Yb = _Ys(b); const bt = 0.022, bc = 1.414;
  if (Yt <= bt) Yt += Math.pow(bt - Yt, bc);
  if (Yb <= bt) Yb += Math.pow(bt - Yb, bc);
  if (Math.abs(Yb - Yt) < 0.0005) return 0;
  let C;
  if (Yb > Yt) { const s = (Math.pow(Yb, 0.56) - Math.pow(Yt, 0.57)) * 1.14; C = s < 0.1 ? 0 : s - 0.027; }
  else { const s = (Math.pow(Yb, 0.65) - Math.pow(Yt, 0.62)) * 1.14; C = s > -0.1 ? 0 : s + 0.027; }
  return C * 100;
}
// Re-tone fg over bg to clear |Lc| >= T: pick the polarity (toward white/black) with
// the most contrast against bg, binary-search the minimal hue-preserving shift.
function _correct(fg, bg, T) {
  const cw = Math.abs(_apca([255, 255, 255], bg)), cb = Math.abs(_apca([0, 0, 0], bg));
  const toward = cw >= cb ? [255, 255, 255] : [0, 0, 0];
  let lo = 0, hi = 1, best = toward.slice();
  for (let i = 0; i < 18; i++) {
    const k = (lo + hi) / 2;
    const c = [Math.round(fg[0] + k * (toward[0] - fg[0])), Math.round(fg[1] + k * (toward[1] - fg[1])), Math.round(fg[2] + k * (toward[2] - fg[2]))];
    if (Math.abs(_apca(c, bg)) >= T + 3) { best = c; hi = k; } else { lo = k; }
  }
  return best;
}
// The engine luminance-inverts every computed color (patch 0009, an involution). To
// make the painted result equal `target` when inversion is ON, author invertLum(target).
function _invertLum(rgb) {
  const compute = (u) => { const f = u / 255; return f <= 0.03928 ? f / 12.92 : Math.pow((f + 0.055) / 1.055, 2.4); };
  const decompute = (x) => { const s = x <= 0.03928 / 12.92 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055; return Math.min(255, Math.max(0, Math.round(s * 255))); };
  const lr = compute(rgb[0]), lg = compute(rgb[1]), lb = compute(rgb[2]);
  const lum = 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
  const factor = ((1 - lum) + 0.05) / (lum + 0.05);
  const adj = (l) => decompute(Math.max(0, (l + 0.05) * factor - 0.05));
  return [adj(lr), adj(lg), adj(lb)];
}

export class GjoaDarkmodeParent extends JSWindowActorParent {
  trustedUrl() {
    try {
      return this.manager?.documentURI?.spec || "";
    } catch (e) {
      return "";
    }
  }

  #hybridActive() {
    // Active for the explicit "hybrid" mode AND whenever the engine's pre-paint
    // default-invert is on (e.g. "system" mode while the OS is dark) — that pref
    // is the single signal that hybrid behavior is live, so the actor's curated
    // fixes + refiner track it without knowing the mode string.
    if (!Services.prefs.getBoolPref(ENABLED_PREF, false)) {
      return false;
    }
    return (
      Services.prefs.getStringPref(MODE_PREF, "auto") === "hybrid" ||
      Services.prefs.getBoolPref(DEFAULT_INVERT_PREF, false)
    );
  }

  // The explicit (non-measured) decision: curated fix registry, then user
  // per-site prefs. Returns { override, css, inject } or null when nothing
  // explicit applies (the engine default-invert + auto refiner then decide).
  async #explicit() {
    if (!this.#hybridActive()) {
      return null;
    }
    const host = hostOf(this.trustedUrl());
    if (!host) {
      return null;
    }
    // (1) Fix registry — highest precedence; owns override + css + inject.
    const fix = fixForHost(await loadFixes(), host);
    if (fix) {
      let css = fix.css || "";
      if (fix.invertSelectors && fix.invertSelectors.length) {
        css +=
          "\n" +
          fix.invertSelectors.join(",") +
          "{filter:invert(1) hue-rotate(180deg)!important}\n";
      }
      return {
        override: fix.override || "inactive",
        css,
        inject: fix.inject || "",
      };
    }
    // (2) User per-site prefs.
    if (hostInPref(host, OFF_PREF)) {
      return { override: "inactive", css: "", inject: "" };
    }
    if (hostInPref(host, FORCE_INVERT_PREF)) {
      return { override: "active", css: "", inject: "" };
    }
    if (hostInPref(host, FORCE_NATIVE_PREF)) {
      return { override: "inactive", css: "", inject: "" };
    }
    return null;
  }

  // The auto refiner, post-paint. hasNativeDark is the child's AUTHORED-darkness
  // measurement (already un-inverted by the child when inversion is active).
  #auto(hasNativeDark) {
    if (!this.#hybridActive()) {
      return { override: "none", css: "", inject: "" };
    }
    // With the engine's pre-paint default-invert active, a themeless page is
    // already dark; defer to the engine ("none") instead of re-asserting. Only a
    // site whose AUTHORED background is dark (one the engine's pre-paint check
    // ran too early to see — late CSS/JS theming) needs retracting.
    if (Services.prefs.getBoolPref(DEFAULT_INVERT_PREF, false)) {
      return {
        override: hasNativeDark ? "inactive" : "none",
        css: "",
        inject: "",
      };
    }
    // default-invert off: the actor is the sole decider (legacy hybrid path).
    return {
      override: hasNativeDark ? "inactive" : "active",
      css: "",
      inject: "",
    };
  }

  // Backdrop-aware APCA retone. The child sends viewport + tagged text els (cn, rect,
  // fg) plus whether the engine is inverting THIS doc. We drawSnapshot the real
  // composited content (catches image/gradient backdrops), and for each element whose
  // text fails the floor against its sampled backdrop, return a corrective color —
  // pre-inverted iff inversion is active so the engine renders the intended tone.
  async #normalize(data) {
    // Independent of mode: the retone applies in ANY dark mode (engine, hybrid, …)
    // where dark mode is enabled — the per-doc `inverted` flag the child measured
    // decides whether to pre-invert, so we don't need #hybridActive here.
    if (
      !Services.prefs.getBoolPref(ENABLED_PREF, false) ||
      !Services.prefs.getBoolPref(NORMALIZE_PREF, false)
    ) {
      return { correctives: [] };
    }
    const W = data?.w | 0, H = data?.h | 0, els = data?.els || [];
    if (!W || !H || !els.length) {
      return { correctives: [] };
    }
    const T = Services.prefs.getIntPref(NORMALIZE_FLOOR_PREF, 45);
    const win =
      this.browsingContext?.topChromeWindow ||
      Services.wm.getMostRecentWindow("navigator:browser");
    if (!win) {
      return { correctives: [] };
    }
    let pix;
    try {
      const bitmap = await this.manager.drawSnapshot(
        new win.DOMRect(0, 0, W, H),
        1,
        "rgb(0,0,0)"
      );
      const canvas = new win.OffscreenCanvas(W, H);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(bitmap, 0, 0);
      pix = ctx.getImageData(0, 0, W, H).data;
    } catch (e) {
      return { correctives: [] };
    }
    const px = (x, y) => {
      const i = (y * W + x) * 4;
      return [pix[i], pix[i + 1], pix[i + 2]];
    };
    const correctives = [];
    for (const el of els) {
      const x0 = Math.max(0, el.x),
        y0 = Math.max(0, el.y);
      const x1 = Math.min(W - 1, el.x + el.w),
        y1 = Math.min(H - 1, el.y + el.h);
      if (x1 <= x0 || y1 <= y0) {
        continue;
      }
      const samples = [];
      const sx = Math.max(1, Math.floor((x1 - x0) / 14)),
        sy = Math.max(1, Math.floor((y1 - y0) / 6));
      for (let y = y0; y <= y1; y += sy) {
        for (let x = x0; x <= x1; x += sx) {
          samples.push(px(x, y));
        }
      }
      if (samples.length < 4) {
        continue;
      }
      samples.sort((a, c) => _Ys(a) - _Ys(c));
      const bg = samples[Math.floor(samples.length / 2)];
      if (Math.abs(_apca(el.fg, bg)) >= T) {
        continue;
      }
      // Return the TARGET rendered color. The child decides per-element whether to
      // pre-invert it (probe: set target, read computed — if the engine inverted it,
      // re-author invertLum so it renders the target). Page-level inversion flags are
      // wrong on mixed pages (a non-inverted light card inside an inverted dark page).
      const c = _correct(el.fg, bg, T);
      correctives.push({ cn: el.cn, color: `rgb(${c[0]},${c[1]},${c[2]})` });
    }
    return { correctives };
  }

  async receiveMessage(msg) {
    if (msg.name === "Darkmode:Normalize") {
      return this.#normalize(msg.data);
    }
    if (msg.name === "Darkmode:GetInject") {
      // document-start: return the explicit curated/user decision so the child
      // applies override + css + inject BEFORE first paint. `explicit:false`
      // tells the child to fall through to the post-paint auto refiner.
      const explicit = await this.#explicit();
      if (explicit) {
        return { explicit: true, ...explicit };
      }
      return { explicit: false, override: "none", css: "", inject: "" };
    }
    if (msg.name === "Darkmode:Decide") {
      return this.#auto(!!msg.data?.hasNativeDark);
    }
    return null;
  }
}
