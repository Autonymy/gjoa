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
    // Async pass-2 image-analysis state (gjoa.darkmode.image-analysis.enabled,
    // default OFF). Per-src verdict cache so repeats are free, the injected
    // <style> id, and a debounce handle for the optional one re-run.
    this._imgVerdictCache = new Map();
    this._imgStyleEl = null;
    this._imgPassScheduled = false;
    this._imgRerunTimer = null;
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
      // A curated fix / user pref already decided the inversion at document-start —
      // the refiner is skipped, but the contrast normalization backstop still runs.
      this.#maybeNormalizeContrast(this.contentWindow, this.document);
      return;
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
    // Pass-2 polish (pref-gated, default off): a curated site may force-invert,
    // in which case the image pass should refine its backdrops too. #maybeRun is
    // a no-op unless the pref is on AND the engine is inverting this document.
    this.#maybeRunImagePass(win, doc);
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
    // Pass-2 polish (pref-gated, default off): the refiner has settled the
    // inversion state, so the image pass can now read it the right way round.
    this.#maybeRunImagePass(win, doc);
    // Pass-3 (pref-gated): backdrop-aware APCA contrast normalization. Runs after
    // the inversion state is settled so we measure + correct the FINAL colors.
    this.#maybeNormalizeContrast(win, doc);
  }

  // Schedule the contrast-normalization pass after the override's re-cascade paints.
  #maybeNormalizeContrast(win, doc) {
    if (!Services.prefs.getBoolPref("gjoa.darkmode.normalize.enabled", false)) {
      return;
    }
    win.requestAnimationFrame(() =>
      win.requestAnimationFrame(() => this.#normalizeContrast(win, doc))
    );
  }

  // Walk visible text, tag each node (data-gjoa-cn), and ask the parent — which can
  // drawSnapshot the REAL composited content — for corrective colors against each
  // element's true backdrop. Apply the returned correctives. Single pass (no re-tag).
  async #normalizeContrast(win, doc) {
    if (!doc || !doc.body) {
      return;
    }
    const parse = s => {
      const m = s && s.match(/[\d.]+/g);
      return m && m.length >= 3 ? [+m[0], +m[1], +m[2]] : null;
    };
    const W = win.innerWidth,
      H = win.innerHeight;
    // Is the engine inverting THIS doc? A black probe renders light if so — which
    // tells the parent whether to pre-invert the correctives.
    let inverted = false;
    try {
      const pr = doc.createElement("span");
      pr.style.cssText = "color:#000;position:fixed;left:-9999px;top:0;";
      doc.body.appendChild(pr);
      const pc = parse(win.getComputedStyle(pr).color);
      inverted = !!(pc && 0.2126 * pc[0] + 0.7152 * pc[1] + 0.0722 * pc[2] > 40);
      pr.remove();
    } catch (e) {}
    const els = [];
    let cn = 0;
    const sel =
      "h1,h2,h3,h4,h5,h6,p,a,span,li,td,th,div,button,label,strong,em,blockquote,figcaption,dt,dd";
    for (const el of doc.body.querySelectorAll(sel)) {
      let hasText = false;
      for (const n of el.childNodes) {
        if (n.nodeType === 3 && n.textContent.trim().length > 1) {
          hasText = true;
          break;
        }
      }
      if (!hasText) {
        continue;
      }
      const r = el.getBoundingClientRect();
      if (r.width < 10 || r.height < 8 || r.top >= H || r.left >= W || r.bottom <= 0 || r.right <= 0) {
        continue;
      }
      const cs = win.getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none" || +cs.opacity === 0) {
        continue;
      }
      const fg = parse(cs.color);
      if (!fg) {
        continue;
      }
      el.setAttribute("data-gjoa-cn", cn);
      els.push({
        cn,
        x: Math.round(r.left),
        y: Math.round(r.top),
        w: Math.round(r.width),
        h: Math.round(r.height),
        fg,
      });
      cn++;
    }
    if (!els.length) {
      return;
    }
    let resp;
    try {
      resp = await this.sendQuery("Darkmode:Normalize", { w: W, h: H, inverted, els });
    } catch (e) {
      return;
    }
    const correctives = (resp && resp.correctives) || [];
    // Replicate the engine's luminance inversion (patch 0009 — an involution) so we
    // can pre-invert per element.
    const invertLum = rgb => {
      const comp = u => {
        const f = u / 255;
        return f <= 0.03928 ? f / 12.92 : Math.pow((f + 0.055) / 1.055, 2.4);
      };
      const dec = x => {
        const s = x <= 0.03928 / 12.92 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
        return Math.min(255, Math.max(0, Math.round(s * 255)));
      };
      const lr = comp(rgb[0]), lg = comp(rgb[1]), lb = comp(rgb[2]);
      const lum = 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
      const factor = (1 - lum + 0.05) / (lum + 0.05);
      const adj = l => dec(Math.max(0, (l + 0.05) * factor - 0.05));
      return [adj(lr), adj(lg), adj(lb)];
    };
    const close = (a, b) =>
      a && b && Math.abs(a[0] - b[0]) <= 8 && Math.abs(a[1] - b[1]) <= 8 && Math.abs(a[2] - b[2]) <= 8;
    for (const c of correctives) {
      const el = doc.querySelector(`[data-gjoa-cn="${c.cn}"]`);
      if (!el) {
        continue;
      }
      const target = parse(c.color);
      // Author the target; read what the engine actually renders. If it inverted the
      // value (rendered far from target), re-author invertLum(target) so the engine's
      // inversion lands ON the target. This is per-element, so a non-inverted light
      // card inside an inverted dark page is handled correctly.
      el.style.setProperty("color", c.color, "important");
      const rendered = parse(win.getComputedStyle(el).color);
      if (target && rendered && !close(rendered, target)) {
        const inv = invertLum(target);
        el.style.setProperty("color", `rgb(${inv[0]},${inv[1]},${inv[2]})`, "important");
      }
    }
    // Completion signal — lets a harness wait event-driven (not a fixed timer) for
    // the async normalize round-trip to finish before measuring contrast.
    try {
      doc.documentElement.setAttribute(
        "data-gjoa-normalized",
        String(correctives.length)
      );
    } catch (e) {}
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
    if (this._imgRerunTimer !== null) {
      try {
        this.contentWindow?.clearTimeout(this._imgRerunTimer);
      } catch (e) {}
      this._imgRerunTimer = null;
    }
    try {
      this._imgStyleEl?.remove();
    } catch (e) {}
    this._imgStyleEl = null;
  }

  // ── Pass 2: async image-luminance analysis (pref-gated, DEFAULT OFF) ────────
  //
  // This is unverified POLISH on top of the engine-level dark scrim, which is the
  // correctness floor. When gjoa.darkmode.image-analysis.enabled is false this
  // whole subsystem is a NO-OP — the engine scrim must never be disturbed by it.
  // When on (and the engine is actually inverting this document) it ports Dark
  // Reader's image track: rasterize each visible background-image url() to a 32x32
  // canvas, classify its brightness, and refine per-image via a single injected
  // <style> (hide large light backdrops, invert small dark transparent ones,
  // replace near-solid light ones with a darkened solid). Everything is wrapped so
  // a failure never throws out of the actor or breaks the page.

  #imagePassEnabled() {
    try {
      return Services.prefs.getBoolPref(
        "gjoa.darkmode.image-analysis.enabled",
        false
      );
    } catch (e) {
      return false;
    }
  }

  // Gate + schedule. No-op unless the pref is on AND the engine is inverting this
  // document (otherwise there's nothing to refine — the page reads light-on-light
  // natively). Runs at most once per document on the idle queue; the optional
  // debounced re-run is scheduled from there, never a hot MutationObserver.
  #maybeRunImagePass(win, doc) {
    try {
      if (this._imgPassScheduled) {
        return;
      }
      if (!win || !doc || !doc.documentElement) {
        return;
      }
      if (!this.#imagePassEnabled()) {
        return; // unverified polish — off by default, engine scrim is the floor
      }
      if (!this.#inversionActive(win, doc)) {
        return; // engine isn't inverting this doc; nothing for pass-2 to refine
      }
      this._imgPassScheduled = true;
      const idle =
        typeof win.requestIdleCallback === "function"
          ? cb => win.requestIdleCallback(cb, { timeout: 2000 })
          : cb => win.setTimeout(cb, 200);
      idle(() => this.#runImagePass(win, doc));
    } catch (e) {}
  }

  #runImagePass(win, doc) {
    try {
      const targets = this.#collectImageTargets(win, doc);
      const rules = [];
      for (const t of targets) {
        let verdict = this._imgVerdictCache.get(t.src);
        if (verdict === undefined) {
          verdict = this.#analyzeImage(win, doc, t.src);
          this._imgVerdictCache.set(t.src, verdict); // null = tainted/failed/skip
        }
        if (!verdict) {
          continue;
        }
        const rule = this.#decideImageRule(win, t, verdict);
        if (rule) {
          rules.push(rule);
        }
      }
      if (rules.length) {
        this.#applyImageRules(win, doc, rules);
      }
      // OPTIONAL one debounced re-run to catch images that streamed in after the
      // initial pass (lazy-loaded heroes). NOT a per-mutation observer.
      if (this._imgRerunTimer === null) {
        this._imgRerunTimer = win.setTimeout(() => {
          this._imgRerunTimer = null;
          try {
            const more = this.#collectImageTargets(win, doc);
            const extra = [];
            for (const t of more) {
              let v = this._imgVerdictCache.get(t.src);
              if (v === undefined) {
                v = this.#analyzeImage(win, doc, t.src);
                this._imgVerdictCache.set(t.src, v);
              }
              if (!v) {
                continue;
              }
              const r = this.#decideImageRule(win, t, v);
              if (r) {
                extra.push(r);
              }
            }
            if (extra.length) {
              this.#applyImageRules(win, doc, extra);
            }
          } catch (e) {}
        }, 1500);
      }
    } catch (e) {}
  }

  // Enumerate elements whose computed background-image resolves to a url() (skip
  // gradients), that are currently visible, capped at the first ~32. Each target
  // carries the element, its resolved src, and the element's natural-ish box so
  // the decision tree can read isLarge from the rendered footprint.
  #collectImageTargets(win, doc) {
    const CAP = 32;
    const out = [];
    let all;
    try {
      all = doc.querySelectorAll("*");
    } catch (e) {
      return out;
    }
    let scanned = 0;
    let capped = false;
    for (const el of all) {
      let bg = "";
      try {
        bg = win.getComputedStyle(el).backgroundImage || "";
      } catch (e) {
        continue;
      }
      if (!bg || bg === "none") {
        continue;
      }
      // url("...") only — gradients (linear-/radial-/conic-) are not rasterizable
      // here and the engine already inverts their color stops.
      const src = this.#firstUrl(bg);
      if (!src) {
        continue;
      }
      if (!this.#isVisible(win, el)) {
        continue;
      }
      out.push({ el, src });
      if (++scanned >= CAP) {
        capped = true;
        break;
      }
    }
    if (capped) {
      try {
        Services.console.logStringMessage(
          "[gjoa darkmode] image-analysis pass capped at " +
            CAP +
            " visible background images"
        );
      } catch (e) {}
    }
    return out;
  }

  // Extract the first url() target from a computed background-image, ignoring
  // gradient layers. Returns null for gradient-only / data-less values.
  #firstUrl(bgImage) {
    const m = bgImage.match(/url\(\s*(["']?)([^"')]+)\1\s*\)/);
    if (!m) {
      return null;
    }
    const u = m[2].trim();
    if (!u || u === "none") {
      return null;
    }
    return u;
  }

  #isVisible(win, el) {
    try {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) {
        return false;
      }
      const vw = win.innerWidth || 0;
      const vh = win.innerHeight || 0;
      // Intersects the viewport (loose — heroes can extend beyond it).
      if (r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) {
        return false;
      }
      const cs = win.getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none") {
        return false;
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  // Rasterize an image src to a 32x32 offscreen canvas and classify it with Dark
  // Reader's exact thresholds. Returns a verdict object, or null on any failure
  // (cross-origin / tainted canvas / load error) so the caller skips that image.
  // Cross-origin images taint the canvas; getImageData then throws — caught here.
  #analyzeImage(win, doc, src) {
    try {
      const img = new win.Image();
      // crossOrigin="anonymous" lets CORS-enabled hosts produce a clean canvas;
      // for non-CORS images the canvas taints and getImageData throws (caught).
      try {
        img.crossOrigin = "anonymous";
      } catch (e) {}
      img.src = src;
      // The image must already be decoded for a synchronous draw. Background
      // images visible on screen are loaded by the time the idle pass runs; if
      // not complete we skip (cached as null) rather than block on async decode.
      if (!img.complete || !img.naturalWidth || !img.naturalHeight) {
        return null;
      }
      const sw = img.naturalWidth;
      const sh = img.naturalHeight;

      const MAX = 32 * 32; // MAX_ANALYSIS_PIXELS_COUNT
      const LARGE = 512 * 512; // LARGE_IMAGE_PIXELS_COUNT
      const isLarge = sw * sh > LARGE;

      const k = Math.min(1, Math.sqrt(MAX / (sw * sh)));
      const width = Math.max(1, Math.ceil(sw * k));
      const height = Math.max(1, Math.ceil(sh * k));

      const canvas = doc.createElement("canvas");
      canvas.width = 32;
      canvas.height = 32;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) {
        return null;
      }
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, sw, sh, 0, 0, width, height);

      let data;
      try {
        data = ctx.getImageData(0, 0, width, height).data; // throws if tainted
      } catch (e) {
        return null; // cross-origin / tainted — skip gracefully
      }

      // Dark Reader thresholds (image.ts), verbatim.
      const TRANSPARENT_ALPHA_THRESHOLD = 0.05;
      const DARK_LIGHTNESS_THRESHOLD = 0.4;
      const LIGHT_LIGHTNESS_THRESHOLD = 0.7;
      const DARK_IMAGE_THRESHOLD = 0.7;
      const LIGHT_IMAGE_THRESHOLD = 0.7;
      const TRANSPARENT_IMAGE_THRESHOLD = 0.1;
      const SOLID_LIGHTNESS_DIFF_THRESHOLD = 0.1;

      let transparentPixelsCount = 0;
      let darkPixelsCount = 0;
      let lightPixelsCount = 0;
      let minLightness = 1;
      let maxLightness = 0;
      let sumR = 0;
      let sumG = 0;
      let sumB = 0;
      let sumA = 0;

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = 4 * (y * width + x);
          const r = data[i + 0];
          const g = data[i + 1];
          const b = data[i + 2];
          const a = data[i + 3];
          sumR += r;
          sumG += g;
          sumB += b;
          sumA += a;
          if (a / 255 < TRANSPARENT_ALPHA_THRESHOLD) {
            transparentPixelsCount++;
          } else {
            // getSRGBLightness: luma-weighted average normalized to [0,1].
            const l = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
            if (l < DARK_LIGHTNESS_THRESHOLD) {
              darkPixelsCount++;
            }
            if (l > LIGHT_LIGHTNESS_THRESHOLD) {
              lightPixelsCount++;
            }
            if (l < minLightness) {
              minLightness = l;
            }
            if (l > maxLightness) {
              maxLightness = l;
            }
          }
        }
      }

      const totalPixelsCount = width * height;
      const opaquePixelsCount = totalPixelsCount - transparentPixelsCount || 1;

      const isSolid =
        sumA === totalPixelsCount * 255 &&
        maxLightness - minLightness < SOLID_LIGHTNESS_DIFF_THRESHOLD;
      const solidColor = isSolid
        ? {
            r: Math.round(sumR / opaquePixelsCount),
            g: Math.round(sumG / opaquePixelsCount),
            b: Math.round(sumB / opaquePixelsCount),
          }
        : null;

      return {
        isDark: darkPixelsCount / opaquePixelsCount >= DARK_IMAGE_THRESHOLD,
        isLight: lightPixelsCount / opaquePixelsCount >= LIGHT_IMAGE_THRESHOLD,
        isTransparent:
          transparentPixelsCount / totalPixelsCount >=
          TRANSPARENT_IMAGE_THRESHOLD,
        isLarge,
        width: sw,
        solidColor,
      };
    } catch (e) {
      return null;
    }
  }

  // Dark Reader's getBgImageValue tree (modify-css.ts), ORDER MATTERS. We're only
  // ever called when the engine is inverting (theme.mode === 1 equivalent), so the
  // light-mode branch is omitted. Returns { sel, decl } for the injected sheet, or
  // null to LEAVE the image (the engine scrim handles dark heroes).
  #decideImageRule(win, target, v) {
    const sel = this.#selectorFor(win, target.el);
    if (!sel) {
      return null;
    }
    // 1) large + light + opaque → HIDE the image; give the container a dark bg so
    //    the engine inversion/scrim owns the backdrop.
    if (v.isLarge && v.isLight && !v.isTransparent) {
      return {
        sel,
        decl: "background-image: none !important; background-color: #1a1a1a !important;",
      };
    }
    // 2) dark + transparent + small (width > 2) → INVERT this element's bg image.
    if (v.isDark && v.isTransparent && v.width > 2) {
      return {
        sel,
        decl: "filter: invert(1) hue-rotate(180deg) !important;",
      };
    }
    // 3) light + opaque (small) → near-solid? replace with a darkened solid color.
    //    Without a solid read, LEAVE it (we don't ship an SVG-invert filter URL in
    //    this pass; the engine scrim still covers the hero).
    if (v.isLight && !v.isTransparent) {
      if (v.solidColor) {
        const dark = this.#darkenSolid(v.solidColor);
        return {
          sel,
          decl:
            "background-image: none !important; background-color: " +
            dark +
            " !important;",
        };
      }
      return null;
    }
    // 4) otherwise (incl. dark opaque heroes) → LEAVE; engine scrim handles it.
    return null;
  }

  // Approximate Dark Reader's modifyBackgroundColor: pull a light solid toward a
  // dark equivalent by inverting lightness while keeping hue. Cheap HSL flip — the
  // exact result isn't load-bearing (the engine scrim is the floor); this just
  // avoids a bright solid block under inversion.
  #darkenSolid({ r, g, b }) {
    const rn = r / 255;
    const gn = g / 255;
    const bn = b / 255;
    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);
    const lOld = (max + min) / 2;
    // Map lightness L -> ~0.85*(1-L) so a near-white solid becomes near-black,
    // clamped to a comfortable dark band.
    const lNew = Math.max(0.08, Math.min(0.22, 0.85 * (1 - lOld)));
    const scale = lOld > 0 ? lNew / lOld : 0;
    const dr = Math.round(Math.min(255, rn * scale * 255));
    const dg = Math.round(Math.min(255, gn * scale * 255));
    const db = Math.round(Math.min(255, bn * scale * 255));
    return "rgb(" + dr + ", " + dg + ", " + db + ")";
  }

  // A stable, idempotent selector for the element. Prefer #id; else stamp a
  // data-attribute we own so re-runs target the SAME element without growing the
  // class list or colliding with page selectors.
  #selectorFor(win, el) {
    try {
      if (el.id && win.CSS && typeof win.CSS.escape === "function") {
        return "#" + win.CSS.escape(el.id);
      }
      let stamp = el.getAttribute("data-gjoa-dm-img");
      if (!stamp) {
        stamp =
          "i" + (this._imgVerdictCache.size + 1) + "-" + (Date.now() % 100000);
        el.setAttribute("data-gjoa-dm-img", stamp);
      }
      return '[data-gjoa-dm-img="' + stamp + '"]';
    } catch (e) {
      return null;
    }
  }

  // Apply the decided rules via ONE id'd <style> appended once (idempotent,
  // removable in didDestroy). Append-only across re-runs so prior verdicts stick.
  #applyImageRules(win, doc, rules) {
    try {
      if (!this._imgStyleEl || !this._imgStyleEl.isConnected) {
        const style = doc.createElement("style");
        style.id = "gjoa-darkmode-image-pass";
        style.setAttribute("type", "text/css");
        (doc.head || doc.documentElement).appendChild(style);
        this._imgStyleEl = style;
      }
      let css = this._imgStyleEl.textContent || "";
      for (const r of rules) {
        css += r.sel + " { " + r.decl + " }\n";
      }
      this._imgStyleEl.textContent = css;
    } catch (e) {}
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
