/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Content half of the gjoa per-site dark-mode HYBRID actor (top documents only).
//
// In hybrid mode the engine (gjoa.darkmode.hybrid.default-invert) classifies the
// document pre-paint: a themeless page is flipped to inverted (dark) before first
// paint, a page that authored its own dark theme is left native — so there is no
// flash-of-light. This actor does two things on top of that:
//
//   document-start (DOMWindowCreated): ask the parent for an EXPLICIT curated
//     decision (fix registry / user per-site pref) and apply its override + css
//     + inject immediately, so curated sites (e.g. YouTube html[dark]) are
//     correct from frame 1.
//   post-paint (DOMContentLoaded): for sites with no explicit decision, a
//     best-effort refiner — it samples the body/root background (probing the live
//     inversion state to read it the right way round) and retracts the engine's
//     invert for a site that turned out dark via LATE JS/CSS theming, which the
//     engine's pre-paint root check ran too early to see.

export class GjoaDarkmodeChild extends JSWindowActorChild {
  constructor() {
    super();
    this._sheetUri = null;
    this._explicitApplied = false;
    this._explicitPromise = null;
  }

  async handleEvent(event) {
    if (this.browsingContext !== this.browsingContext.top) {
      return; // subframes inherit the top document's decision (bc->Top())
    }
    if (event.type === "DOMWindowCreated") {
      // Reset any override INHERITED from the previous same-tab page so this
      // fresh document starts from the engine's pre-paint default, then apply
      // the curated/user decision (if any) at document-start. Store the promise
      // SYNCHRONOUSLY so a DOMContentLoaded that fires before the IPC round-trip
      // resolves can await it (else the refiner races the curated decision).
      try {
        this.browsingContext.colorInversionOverride = "none";
      } catch (e) {}
      // Sync, pre-layout: apply the explicit override (curated registry mirror +
      // user per-site prefs) BEFORE PresShell::Initialize reads it, so an
      // attribute-gated curated site (YouTube) never transiently flips. The
      // css/inject still come via the async #applyExplicit.
      this.#syncExplicitOverride();
      this._explicitPromise = this.#applyExplicit();
      await this._explicitPromise;
      return;
    }
    if (event.type !== "DOMContentLoaded") {
      return;
    }
    // Serialize against the document-start curated decision before deciding the
    // refiner runs at all — otherwise both could write colorInversionOverride.
    if (this._explicitPromise) {
      try {
        await this._explicitPromise;
      } catch (e) {}
    }
    if (this._explicitApplied) {
      return; // a curated fix / user pref already decided at document-start
    }
    const win = this.contentWindow;
    if (!win) {
      return;
    }
    // Refine one cascade behind: read the resolved background after two frames
    // so any late page theming has applied, then ask the parent to decide.
    win.requestAnimationFrame(() =>
      win.requestAnimationFrame(() => this.#measureAndRefine())
    );
  }

  async #applyExplicit() {
    const win = this.contentWindow;
    const doc = this.document;
    if (!win || !doc) {
      return;
    }
    const url = doc.documentURI || "";
    if (!/^https?:/.test(url)) {
      return;
    }
    let resp;
    try {
      resp = await this.sendQuery("Darkmode:GetInject", {});
    } catch (e) {
      return;
    }
    if (!resp || !resp.explicit) {
      return; // no curated fix / user pref — engine default-invert + auto decide
    }
    this._explicitApplied = true;
    // Apply the curated decision at document-start, before first paint: the
    // inject scriptlet (page main world), the curated USER_SHEET css, and the
    // inversion override — together, so the site is correct from frame 1.
    if (resp.inject) {
      this.#runInject(win, resp.inject);
    }
    if (resp.css) {
      this.#injectSheet(win, resp.css);
    }
    if (resp.override && resp.override !== "none") {
      try {
        this.browsingContext.colorInversionOverride = resp.override;
      } catch (e) {}
    }
  }

  // Synchronous, pre-layout explicit-override decision (no IPC). Mirrors the
  // parent's #explicit precedence (curated registry > user per-site prefs) but
  // reads everything from prefs the parent keeps in sync, so the override lands
  // BEFORE PresShell::Initialize. Gated on the engine's default-invert being on
  // (otherwise no pre-paint flip exists to pre-empt).
  #syncExplicitOverride() {
    try {
      if (
        !Services.prefs.getBoolPref("gjoa.darkmode.hybrid.default-invert", false)
      ) {
        return;
      }
      const url = this.document?.documentURI || "";
      if (!/^https?:/.test(url)) {
        return;
      }
      let host = "";
      try {
        host = Services.io.newURI(url).host.toLowerCase();
      } catch (e) {}
      if (!host) {
        return;
      }
      const override = this.#explicitOverrideForHost(host);
      if (override && override !== "none") {
        this.browsingContext.colorInversionOverride = override;
      }
    } catch (e) {}
  }

  #explicitOverrideForHost(host) {
    // (1) curated fix registry mirror (host -> override JSON).
    try {
      const raw = Services.prefs.getStringPref("gjoa.darkmode.fix-overrides", "");
      if (raw) {
        const map = JSON.parse(raw);
        let h = host;
        let v = map[h];
        let i;
        while (v === undefined && (i = h.indexOf(".")) !== -1) {
          h = h.slice(i + 1);
          v = map[h];
        }
        if (v) {
          return v;
        }
      }
    } catch (e) {}
    // (2) user per-site prefs (same precedence/behavior as the parent).
    if (this.#hostInPref(host, "gjoa.darkmode.user.off")) {
      return "inactive";
    }
    if (this.#hostInPref(host, "gjoa.darkmode.user.force-invert")) {
      return "active";
    }
    if (this.#hostInPref(host, "gjoa.darkmode.user.force-native")) {
      return "inactive";
    }
    return null;
  }

  #hostInPref(host, pref) {
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

  // Run a per-site scriptlet in the page's MAIN world at document-start via a
  // privileged Cu.Sandbox over the content window — NOT a <script> element,
  // which the page CSP blocks (YouTube blocks inline scripts). sandboxPrototype
  // = win + wantXrays = false so the scriptlet's writes (html[dark]) land on the
  // page (same channel discipline as GjoaCosmeticChild.injectScriptlets).
  //
  // SECURITY INVARIANT (F7): with sandboxPrototype=win + wantXrays=false the
  // scriptlet reads the page's RAW globals (w.JSON, w.Object, w.Element), so a
  // hostile page can pre-plant getters/Proxies to observe or defeat it. This is
  // the inherent uBO-style residual and is NOT an escalation — everything here
  // runs with the CONTENT principal. The HARD rule: injected scriptlet code must
  // NEVER be handed any privileged value (chrome object, Services, Cu/Cc/Ci, the
  // actor's IPC handle) — the page can intercept every property access in this
  // sandbox, so a leaked privileged ref would cross the content/chrome boundary.
  // Only opaque code strings are evaluated here; never add chrome-side bindings
  // onto the sandbox.
  #runInject(win, code) {
    try {
      const sandbox = Cu.Sandbox(win, {
        sandboxName: "gjoa-darkmode-inject",
        sandboxPrototype: win,
        wantXrays: false,
      });
      // Defensive intrinsic capture (F7): snapshot the page's native intrinsics
      // ONCE at injection time so a scriptlet that closes over `__gjoaNative.*`
      // reads the reference captured here rather than re-deref'ing the bare
      // global, which a later page turn could swap. These are the page's own
      // content-principal globals handed straight through (the sandbox already
      // shares win's prototype) — NOT cloned, and never a chrome value. This
      // narrows, does not close, the residual (a trap planted before
      // document-start is still observed).
      try {
        sandbox.__gjoaNative = {
          JSON: win.JSON,
          Object: win.Object,
          Element: win.Element,
        };
      } catch (e) {}
      Cu.evalInSandbox(code, sandbox);
    } catch (e) {}
  }

  async #measureAndRefine() {
    const doc = this.document;
    const win = this.contentWindow;
    if (!doc || !win || !doc.documentElement) {
      return;
    }
    const url = doc.documentURI || "";
    if (!/^https?:/.test(url)) {
      return;
    }
    const hasNativeDark = this.#pageIsDark(win, doc);
    let resp;
    try {
      resp = await this.sendQuery("Darkmode:Decide", { hasNativeDark });
    } catch (e) {
      return;
    }
    if (!resp) {
      return;
    }
    if (resp.css) {
      this.#injectSheet(win, resp.css);
    }
    if (resp.override) {
      try {
        this.browsingContext.colorInversionOverride = resp.override;
      } catch (e) {}
    }
  }

  #injectSheet(win, css) {
    if (!win.windowUtils || !css) {
      return;
    }
    const utils = win.windowUtils;
    const uri = "data:text/css;charset=utf-8," + encodeURIComponent(css);
    try {
      if (this._sheetUri) {
        try {
          utils.removeSheetUsingURIString(this._sheetUri, utils.USER_SHEET);
        } catch (e) {}
      }
      utils.loadSheetUsingURIString(uri, utils.USER_SHEET);
      this._sheetUri = uri;
    } catch (e) {}
  }

  didDestroy() {
    if (this._sheetUri) {
      try {
        const utils = this.contentWindow?.windowUtils;
        utils?.removeSheetUsingURIString(this._sheetUri, utils.USER_SHEET);
      } catch (e) {}
      this._sheetUri = null;
    }
  }

  // Coarse "is this page's AUTHORED background dark?" check for the refiner. The
  // effective bg is body, then documentElement; first OPAQUE color wins (all
  // transparent ⇒ the UA canvas shows ⇒ not dark). When the engine is currently
  // inverting this document, the measured bg is the inverted authored color, so we
  // flip the luminance (the inversion is a luminance map ~Y -> 1 - Y) to read it
  // the right way round — without this, an inverted themeless page would read dark
  // and be misclassified native-dark. This is a THRESHOLD test, not an exact
  // recovery (channel clamping makes the flip approximate near the boundary); the
  // engine's pre-paint check is the precise classifier, this only catches the
  // late-theme tail.
  #pageIsDark(win, doc) {
    const read = el => {
      try {
        return win.getComputedStyle(el).backgroundColor || "";
      } catch (e) {
        return "";
      }
    };
    let bg = "";
    for (const el of [doc.body, doc.documentElement]) {
      if (!el) {
        continue;
      }
      const c = read(el);
      // Skip only FULLY-transparent backgrounds. Gecko serializes opaque colors
      // as 3-arg `rgb(r, g, b)` and transparent as 4-arg `rgba(r, g, b, 0)`, so
      // the alpha test must require a real 4th channel — anchoring on the last
      // comma alone would match the blue channel of `rgb(0, 0, 0)` (opaque black,
      // the most common dark bg) and wrongly treat it as transparent.
      if (
        c &&
        c !== "transparent" &&
        !/^rgba?\([^,)]*,[^,)]*,[^,)]*,\s*0(?:\.0+)?\s*\)$/.test(c)
      ) {
        bg = c;
        break;
      }
    }
    if (!bg) {
      return false;
    }
    let lum = this.#luminance(bg);
    if (this.#inversionActive(win, doc)) {
      lum = 1 - lum;
    }
    return lum < 0.22;
  }

  // Detect whether the engine is luminance-inverting this document by probing
  // known swatches: under inversion white computes to black AND black to white.
  // Requiring BOTH flips avoids a false positive from a stray user-!important /
  // leftover USER_SHEET background spoofing a single swatch.
  #inversionActive(win, doc) {
    const read = bg => {
      try {
        const probe = doc.createElement("div");
        probe.style.cssText =
          "position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;" +
          "background-color:" + bg;
        (doc.body || doc.documentElement).appendChild(probe);
        const c = win.getComputedStyle(probe).backgroundColor;
        probe.remove();
        return c;
      } catch (e) {
        return "";
      }
    };
    return (
      read("rgb(255,255,255)") === "rgb(0, 0, 0)" &&
      read("rgb(0,0,0)") === "rgb(255, 255, 255)"
    );
  }

  #luminance(rgbStr) {
    const m = rgbStr.match(/[\d.]+/g);
    if (!m || m.length < 3) {
      return 1;
    }
    const lin = c => {
      c = c / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * lin(+m[0]) + 0.7152 * lin(+m[1]) + 0.0722 * lin(+m[2]);
  }
}
