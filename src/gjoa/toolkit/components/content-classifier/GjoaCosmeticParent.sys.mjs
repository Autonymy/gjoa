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
// gjoa policy is curated-only scriptlets. The engine's general/list-driven
// `+js()` expansion is opt-in and DEFAULTS OFF; only the curated baseline
// (e.g. YOUTUBE_PRUNE) runs unless the user explicitly flips this pref.
const LIST_SCRIPTLETS_PREF = "gjoa.contentblock.scriptlets.listDriven.enabled";

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
      // path fires on DOMContentLoaded, too late for a player pre-roll). By
      // default this serves ONLY the curated set (gjoa policy: curated-only
      // scriptlets). The engine's list-driven `injected` scriptlet IS wired, but
      // gated behind LIST_SCRIPTLETS_PREF (default OFF): an arbitrary list-driven
      // `+js()` rule injecting unaudited JS into the page's main world is exactly
      // what the curated-only policy excludes, so it stays opt-in.
      case "Cosmetic:GetScriptlets": {
        const url = this.trustedUrl();
        if (!blockingActive(url)) {
          return null;
        }
        const out = scriptletsForHost(hostOf(url));
        // Engine-produced scriptlets: adblock-rust expands this URL's `+js()`
        // rules (from the uBO lists) against the loaded scriptlet resource
        // library into one injectable string. This is the general/list-driven
        // path; the curated set above is a guaranteed baseline. Per gjoa's
        // curated-only policy this list-driven injection is DISABLED by default
        // and only folded in when LIST_SCRIPTLETS_PREF is explicitly enabled.
        if (Services.prefs.getBoolPref(LIST_SCRIPTLETS_PREF, false)) {
          const svc = classifierService();
          if (svc) {
            try {
              const hide = {};
              const proc = {};
              const exc = {};
              const injected = {};
              const generichide = {};
              svc.getUrlCosmeticResources(url, hide, proc, exc, injected, generichide);
              if (injected.value) {
                out.push(injected.value);
              }
            } catch (e) {}
          }
        }
        return out.length ? { scriptlets: out } : null;
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
        // Clamp the child-supplied arrays before handing them to the
        // synchronous, globally-locked native call. A compromised content
        // process could otherwise send huge arrays of huge strings to stall the
        // parent main thread and contend the cross-tab engine lock (DoS). Drop
        // non-strings, cap per-element length and total count.
        const clamp = a =>
          (Array.isArray(a) ? a : [])
            .filter(s => typeof s === "string" && s.length <= 256)
            .slice(0, 4096);
        const selectors = {};
        try {
          svc.getHiddenClassIdSelectors(
            clamp(msg.data?.classes),
            clamp(msg.data?.ids),
            clamp(msg.data?.exceptions),
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
