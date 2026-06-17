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
    if (event.type !== "DOMContentLoaded") {
      return;
    }
    await this.applyCosmetics();
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
    // Flush directly from the observer callback rather than via setTimeout:
    // MutationObserver already coalesces a batch of mutations into one callback
    // at the microtask checkpoint, the seen-set dedups repeats, and a timer
    // would never fire in a frozen/background tab. collectClassesIds only emits
    // classes/ids not seen before, so each query carries only what's new.
    this._observer = new win.MutationObserver(records => {
      const classes = new Set();
      const ids = new Set();
      for (const rec of records) {
        if (rec.type === "attributes" && rec.target) {
          this.collectClassesIds(rec.target.parentNode || rec.target, classes, ids);
        }
        for (const node of rec.addedNodes || []) {
          if (node.nodeType === 1 /* ELEMENT_NODE */) {
            this.collectClassesIds(node, classes, ids);
          }
        }
      }
      if (classes.size || ids.size) {
        this.queryAndInject([...classes], [...ids]);
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

  // One sendQuery per observer batch that carries genuinely-new classes/ids.
  // The seen-set caps total queries at one-per-distinct-token, so this is bounded
  // even on busy pages; a page that continuously mints randomized classnames
  // (hashed CSS modules) is the worst case. A leading-edge + trailing-debounce
  // coalescer would cut that further, but a macrotask timer is frozen in
  // background tabs — deferred until a frozen-tab-safe coalescer is in place.
  async queryAndInject(classes, ids) {
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
  }
}
