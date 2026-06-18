/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Content half of the gjoa per-site dark-mode HYBRID actor (top documents only).
// In "hybrid" mode the chrome module forces prefers-color-scheme:dark, so sites
// with a native dark theme render it. This actor, one cascade behind (after
// first paint), reads the EFFECTIVE page background; if the site stayed light
// (no native dark theme) it sets browsingContext.colorInversionOverride =
// "active", which nsPresContext reads to luminance-invert just this document.
// Native-dark sites get "inactive" — kept native, never double-darkened.

export class GjoaDarkmodeChild extends JSWindowActorChild {
  async handleEvent(event) {
    if (event.type !== "DOMContentLoaded") {
      return;
    }
    const win = this.contentWindow;
    if (!win || this.browsingContext !== this.browsingContext.top) {
      return; // subframes inherit the top document's decision (bc->Top())
    }
    // Decide one cascade behind: read the already-resolved background after the
    // first two frames so the page's own (possibly dark) theme has applied.
    win.requestAnimationFrame(() =>
      win.requestAnimationFrame(() => this.#measureAndApply())
    );
  }

  async #measureAndApply() {
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
    if (!resp || !resp.override) {
      return;
    }
    try {
      this.browsingContext.colorInversionOverride = resp.override;
    } catch (e) {}
  }

  // Effective page background: body, then documentElement; first OPAQUE color
  // wins. All transparent ⇒ the UA canvas (white) shows through ⇒ not dark.
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
      // comma alone would match the blue channel of `rgb(0, 0, 0)` (opaque
      // black, the most common dark bg) and wrongly treat it as transparent.
      if (c && c !== "transparent" && !/^rgba?\([^,)]*,[^,)]*,[^,)]*,\s*0(?:\.0+)?\s*\)$/.test(c)) {
        bg = c;
        break;
      }
    }
    if (!bg) {
      return false;
    }
    return this.#luminance(bg) < 0.22;
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
