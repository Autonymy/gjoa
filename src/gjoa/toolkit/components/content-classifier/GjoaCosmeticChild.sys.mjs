/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Content half of the gjoa cosmetic-filtering actor. On document load it asks
// the parent for the adblock-rust element-hiding selectors for this URL plus
// the generic class/id-triggered selectors for the elements currently present,
// then injects them as a single USER_SHEET ({display:none!important}) — the same
// page-CSS-proof mechanism uBlock Origin uses. A MutationObserver feeds
// newly-appearing classes/ids back to the parent for lazy selectors, which are
// merged into the same sheet.

const CHUNK = 1000; // selectors per rule, to bound the blast radius of a bad one
const COALESCE_MS = 250; // trailing-debounce window for the observer flush

function buildCss(selectors) {
  let css = "";
  for (let i = 0; i < selectors.length; i += CHUNK) {
    const group = selectors.slice(i, i + CHUNK).join(",");
    if (group) {
      css += group + "{display:none!important}\n";
    }
  }
  return css;
}

export class GjoaCosmeticChild extends JSWindowActorChild {
  constructor() {
    super();
    this._generichide = false;
    this._exceptions = [];
    this._seenClasses = new Set();
    this._seenIds = new Set();
    this._observer = null;
    // All hidden selectors accumulate into one Set backing a SINGLE USER_SHEET
    // that is replaced on change — rather than loading a new sheet per batch,
    // which would pile up unbounded on a long-lived SPA.
    this._selectors = new Set();
    this._sheetUri = null;
    // Coalescer state: pending new tokens + the trailing-window timer handle.
    this._pendingC = new Set();
    this._pendingI = new Set();
    this._cooldown = 0;
  }

  addSelectors(list) {
    if (!list || !list.length) {
      return;
    }
    let added = false;
    for (const s of list) {
      if (s && !this._selectors.has(s)) {
        this._selectors.add(s);
        added = true;
      }
    }
    if (added) {
      this.rebuildSheet();
    }
  }

  rebuildSheet() {
    const win = this.contentWindow;
    if (!win || !win.windowUtils) {
      return;
    }
    const css = buildCss([...this._selectors]);
    if (!css) {
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

  collectClassesIds(root, outClasses, outIds) {
    const consider = el => {
      const cl = el.classList;
      if (cl) {
        for (const c of cl) {
          if (!this._seenClasses.has(c)) {
            this._seenClasses.add(c);
            outClasses.add(c);
          }
        }
      }
      const id = el.id;
      if (id && !this._seenIds.has(id)) {
        this._seenIds.add(id);
        outIds.add(id);
      }
    };
    try {
      // The root itself (querySelectorAll only returns descendants, so a newly
      // inserted element's own class/id would otherwise be missed).
      if (root.nodeType === 1 && root.classList) {
        consider(root);
      }
      for (const el of root.querySelectorAll("[class],[id]")) {
        consider(el);
      }
    } catch (e) {}
  }

  async handleEvent(event) {
    // DOMWindowCreated = document-start: inject scriptlets BEFORE page scripts
    // run (a player pre-roll is decided the moment YouTube reads its config).
    if (event.type === "DOMWindowCreated") {
      await this.injectScriptlets();
      return;
    }
    if (event.type === "DOMContentLoaded") {
      await this.applyCosmetics();
    }
  }

  // Run curated/engine scriptlets in the PAGE's main world. A privileged
  // Cu.Sandbox over the content window is not subject to the page's CSP (so it
  // works on YouTube, which blocks inline <script>), and with
  // sandboxPrototype=win + wantXrays=false the scriptlet's writes to JSON.parse
  // / Response.json land on the page's real globals — exactly what a player
  // json-prune needs.
  async injectScriptlets() {
    const doc = this.document;
    const url = doc?.documentURI || "";
    if (!/^https?:/.test(url)) {
      return;
    }
    let resp;
    try {
      resp = await this.sendQuery("Cosmetic:GetScriptlets", {});
    } catch (e) {
      return;
    }
    if (!resp || !resp.scriptlets || !resp.scriptlets.length) {
      return;
    }
    const win = this.contentWindow;
    if (!win) {
      return;
    }
    let sandbox;
    try {
      sandbox = Cu.Sandbox(win, {
        sandboxName: "gjoa-scriptlets",
        sandboxPrototype: win,
        wantXrays: false,
      });
    } catch (e) {
      return;
    }
    for (const code of resp.scriptlets) {
      try {
        Cu.evalInSandbox(code, sandbox);
      } catch (e) {}
    }
  }

  async applyCosmetics() {
    const doc = this.document;
    if (!doc) {
      return;
    }
    const url = doc.documentURI || "";
    if (!url || !/^https?:/.test(url)) {
      return;
    }

    let base;
    try {
      // No url in the payload — the parent derives it from trusted state.
      base = await this.sendQuery("Cosmetic:GetForUrl", {});
    } catch (e) {
      return;
    }
    if (!base) {
      return; // blocking off, host allow-listed, or service unavailable
    }

    this._generichide = !!base.generichide;
    this._exceptions = base.exceptions || [];

    const selectors = (base.hide || []).slice();

    // Generic class/id-triggered hiding for what's already in the document.
    if (!this._generichide) {
      const classes = new Set();
      const ids = new Set();
      this.collectClassesIds(doc, classes, ids);
      if (classes.size || ids.size) {
        try {
          const lazy = await this.sendQuery("Cosmetic:GetLazy", {
            url,
            classes: [...classes],
            ids: [...ids],
            exceptions: this._exceptions,
          });
          if (lazy && lazy.selectors) {
            selectors.push(...lazy.selectors);
          }
        } catch (e) {}
      }
    }

    this.addSelectors(selectors);

    if (!this._generichide) {
      this.startObserver();
    }
  }

  startObserver() {
    if (this._observer) {
      return;
    }
    const win = this.contentWindow;
    if (!win || !win.MutationObserver) {
      return;
    }
    // collectClassesIds emits only classes/ids not seen before, accumulating
    // into the pending sets; the coalescer (scheduleFlush) decides when to query.
    this._observer = new win.MutationObserver(records => {
      for (const rec of records) {
        if (rec.type === "attributes" && rec.target) {
          this.collectClassesIds(
            rec.target.parentNode || rec.target,
            this._pendingC,
            this._pendingI
          );
        }
        for (const node of rec.addedNodes || []) {
          if (node.nodeType === 1 /* ELEMENT_NODE */) {
            this.collectClassesIds(node, this._pendingC, this._pendingI);
          }
        }
      }
      if (this._pendingC.size || this._pendingI.size) {
        this.scheduleFlush();
      }
    });
    try {
      this._observer.observe(this.document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class", "id"],
      });
    } catch (e) {}
  }

  // Leading-edge + trailing-debounce coalescer. The first batch flushes
  // immediately (no timer dependency, so it works in a frozen/background tab and
  // in the headless tests); during the trailing window further batches just
  // accumulate and flush once when it closes. On a randomized-classname SPA this
  // collapses a per-mutation sendQuery storm into ~one query per window; in a
  // frozen tab the trailing timer is paused but the tab isn't mutating, so
  // nothing is lost visually (and the seen-set already caps total distinct work).
  scheduleFlush() {
    if (this._cooldown) {
      return;
    }
    this.flushPending(); // leading edge
    const win = this.contentWindow;
    if (!win) {
      return;
    }
    this._cooldown = win.setTimeout(() => {
      this._cooldown = 0;
      if (this._pendingC.size || this._pendingI.size) {
        this.flushPending();
      }
    }, COALESCE_MS);
  }

  async flushPending() {
    if (!this._pendingC.size && !this._pendingI.size) {
      return;
    }
    const classes = [...this._pendingC];
    const ids = [...this._pendingI];
    this._pendingC.clear();
    this._pendingI.clear();
    try {
      const lazy = await this.sendQuery("Cosmetic:GetLazy", {
        classes,
        ids,
        exceptions: this._exceptions,
      });
      if (lazy && lazy.selectors && lazy.selectors.length) {
        this.addSelectors(lazy.selectors);
      }
    } catch (e) {}
  }

  didDestroy() {
    if (this._observer) {
      try {
        this._observer.disconnect();
      } catch (e) {}
      this._observer = null;
    }
    if (this._cooldown) {
      try {
        this.contentWindow?.clearTimeout(this._cooldown);
      } catch (e) {}
      this._cooldown = 0;
    }
    if (this._sheetUri) {
      try {
        const utils = this.contentWindow?.windowUtils;
        utils?.removeSheetUsingURIString(this._sheetUri, utils.USER_SHEET);
      } catch (e) {}
      this._sheetUri = null;
    }
    this._seenClasses.clear();
    this._seenIds.clear();
    this._selectors.clear();
    this._pendingC.clear();
    this._pendingI.clear();
  }
}
