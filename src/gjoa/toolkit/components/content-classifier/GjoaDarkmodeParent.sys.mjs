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

  async receiveMessage(msg) {
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
