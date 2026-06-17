/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Parent half of the gjoa cosmetic-filtering actor. Runs in the parent
// process, where the content-classifier service (MAIN_PROCESS_ONLY) lives.
// The content-side child asks for element-hiding selectors per document;
// this side queries the native adblock-rust engines via the service and
// honors gjoa's global + per-site blocking gates.

const ENABLED_PREF = "gjoa.contentblock.enabled";
const ALLOW_HOSTS_PREF = "gjoa.contentblock.user.allow-hosts";

function allowHostSet() {
  let raw = "";
  try {
    raw = Services.prefs.getStringPref(ALLOW_HOSTS_PREF, "");
  } catch (e) {}
  return new Set(
    raw
      .split(",")
      .map(h => h.trim().toLowerCase())
      .filter(Boolean)
  );
}

function hostOf(url) {
  try {
    return Services.io.newURI(url).host.toLowerCase();
  } catch (e) {
    return "";
  }
}

function classifierService() {
  try {
    return Cc["@mozilla.org/content-classifier-service;1"].getService(
      Ci.nsIContentClassifierService
    );
  } catch (e) {
    return null;
  }
}

// True when cosmetic blocking should run for this URL: the global toggle is
// on and the host is not on the user's allow list (exact host or any parent
// domain the user added).
function blockingActive(url) {
  if (!Services.prefs.getBoolPref(ENABLED_PREF, false)) {
    return false;
  }
  const host = hostOf(url);
  if (!host) {
    return false;
  }
  for (const h of allowHostSet()) {
    if (host === h || host.endsWith("." + h)) {
      return false;
    }
  }
  return true;
}

export class GjoaCosmeticParent extends JSWindowActorParent {
  // The document URL from trusted parent-process state, NOT from the content
  // process. A compromised/hostile content process could otherwise claim an
  // allow-listed host to bypass blocking, or query cosmetics for another site.
  trustedUrl() {
    try {
      return this.manager?.documentURI?.spec || "";
    } catch (e) {
      return "";
    }
  }

  async receiveMessage(msg) {
    switch (msg.name) {
      case "Cosmetic:GetForUrl": {
        const url = this.trustedUrl();
        if (!blockingActive(url)) {
          return null;
        }
        const svc = classifierService();
        if (!svc) {
          return null;
        }
        const hide = {};
        const proc = {};
        const exc = {};
        const injected = {};
        const generichide = {};
        try {
          svc.getUrlCosmeticResources(
            url,
            hide,
            proc,
            exc,
            injected,
            generichide
          );
        } catch (e) {
          return null;
        }
        return {
          hide: hide.value || [],
          exceptions: exc.value || [],
          generichide: !!generichide.value,
        };
      }

      case "Cosmetic:GetLazy": {
        const url = this.trustedUrl();
        if (!blockingActive(url)) {
          return null;
        }
        const svc = classifierService();
        if (!svc) {
          return null;
        }
        const selectors = {};
        try {
          svc.getHiddenClassIdSelectors(
            msg.data?.classes || [],
            msg.data?.ids || [],
            msg.data?.exceptions || [],
            selectors
          );
        } catch (e) {
          return null;
        }
        return { selectors: selectors.value || [] };
      }
    }
    return null;
  }
}
