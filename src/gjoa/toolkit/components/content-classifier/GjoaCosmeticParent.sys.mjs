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

// --- Curated scriptlets ------------------------------------------------------
// gjoa's "curated-only scriptlets" policy: a small, hand-maintained set of JS
// snippets injected into the page's main world at document-start — for ads that
// CANNOT be blocked at the network layer. YouTube video ads are the canonical
// case: pre/mid-roll are served first-party from googlevideo.com (same host as
// the real video), so the only lever is to prune the ad descriptors out of the
// player response before YouTube's player reads them. This mirrors uBlock
// Origin's `json-prune` of `adPlacements`/`adSlots`/`playerAds`.
// NOTE: globals are accessed as `window.JSON` / `window.Response` (not bare),
// because the injection sandbox has its OWN intrinsics — patching bare `JSON`
// would patch the sandbox's, not the page's. `window` resolves through the
// sandbox prototype to the real page window, so `window.JSON.parse = ...` lands
// on the page.
const YOUTUBE_PRUNE = `
(function () {
  "use strict";
  var w = window;
  var AD_KEYS = ["adPlacements", "adSlots", "playerAds", "adBreakHeartbeatParams"];
  function prune(o) {
    if (!o || typeof o !== "object") { return; }
    for (var i = 0; i < AD_KEYS.length; i++) {
      if (AD_KEYS[i] in o) { try { delete o[AD_KEYS[i]]; } catch (e) {} }
    }
    if (o.playerResponse) { prune(o.playerResponse); }
  }
  try {
    var op = w.JSON.parse;
    w.JSON.parse = function (t, r) {
      var v = op.call(this, t, r);
      try { prune(v); } catch (e) {}
      return v;
    };
  } catch (e) {}
  try {
    var oj = w.Response.prototype.json;
    w.Response.prototype.json = function () {
      return oj.apply(this, arguments).then(function (v) {
        try { prune(v); } catch (e) {}
        return v;
      });
    };
  } catch (e) {}
  try {
    var stored;
    w.Object.defineProperty(w, "ytInitialPlayerResponse", {
      configurable: true,
      get: function () { return stored; },
      set: function (v) { try { prune(v); } catch (e) {} stored = v; },
    });
  } catch (e) {}
})();
`;

// Each entry: registrable domains -> scriptlet bodies. Matched against the host
// and any parent domain (so www./m./music. youtube.com all match).
const HOST_SCRIPTLETS = [
  { domains: ["youtube.com", "youtube-nocookie.com"], scriptlets: [YOUTUBE_PRUNE] },
];

function scriptletsForHost(host) {
  if (!host) {
    return [];
  }
  host = host.toLowerCase();
  const out = [];
  for (const entry of HOST_SCRIPTLETS) {
    if (entry.domains.some(d => host === d || host.endsWith("." + d))) {
      out.push(...entry.scriptlets);
    }
  }
  return out;
}

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

      // Document-start scriptlets for this URL's host. Returned separately from
      // the cosmetic CSS because they must run BEFORE page scripts (the cosmetic
      // path fires on DOMContentLoaded, too late for a player pre-roll). Today
      // this serves the curated set; once the engine's scriptlet resources are
      // wired it will also fold in `injected` from getUrlCosmeticResources.
      case "Cosmetic:GetScriptlets": {
        const url = this.trustedUrl();
        if (!blockingActive(url)) {
          return null;
        }
        const scriptlets = scriptletsForHost(hostOf(url));
        return scriptlets.length ? { scriptlets } : null;
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
