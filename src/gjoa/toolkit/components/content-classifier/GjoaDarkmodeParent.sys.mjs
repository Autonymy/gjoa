/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Parent half of the gjoa per-site dark-mode HYBRID actor. Decides the
// per-document colorInversionOverride from trusted parent-process state: the
// dark-mode mode, the per-site override prefs, and the child's measurement of
// whether the page rendered dark on its own.

const ENABLED_PREF = "gjoa.darkmode.enabled";
const MODE_PREF = "gjoa.darkmode.mode";
const FORCE_NATIVE_PREF = "gjoa.darkmode.user.force-native";
const FORCE_INVERT_PREF = "gjoa.darkmode.user.force-invert";
const OFF_PREF = "gjoa.darkmode.user.off";

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

  // Returns the BrowsingContext.colorInversionOverride to set:
  //   "active"   — invert this document (themeless / forced)
  //   "inactive" — never invert (native dark theme / off / forced-native)
  //   "none"     — defer to the global gjoa.darkmode.invert.enabled pref
  #decide(hasNativeDark) {
    // Per-document overrides are a HYBRID-mode concern. In every other mode the
    // global pref drives inversion uniformly, so defer ("none").
    if (
      !Services.prefs.getBoolPref(ENABLED_PREF, false) ||
      Services.prefs.getStringPref(MODE_PREF, "auto") !== "hybrid"
    ) {
      return "none";
    }
    const host = hostOf(this.trustedUrl());
    if (host) {
      if (hostInPref(host, OFF_PREF)) {
        return "inactive";
      }
      if (hostInPref(host, FORCE_INVERT_PREF)) {
        return "active";
      }
      if (hostInPref(host, FORCE_NATIVE_PREF)) {
        return "inactive";
      }
    }
    // Auto: invert only sites that did NOT render dark on their own.
    return hasNativeDark ? "inactive" : "active";
  }

  async receiveMessage(msg) {
    if (msg.name === "Darkmode:Decide") {
      return { override: this.#decide(!!msg.data?.hasNativeDark) };
    }
    return null;
  }
}
