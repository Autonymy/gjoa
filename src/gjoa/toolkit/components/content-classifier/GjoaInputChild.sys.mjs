/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Content half of gjoa's INPUT-STATE actor — the "am I typing into a form right
// now?" detector that lets vim keys yield to editing, PLUS the smooth-scroll
// driver. It replaces a legacy `loadFrameScript(data:...)` that FF152's script-
// filename validation rejects ("unsafe filename: data:...") — which had silently
// broken editable-focus detection AND j/k smooth-scroll on all web content.
//
// Why an actor (not a frame script): gjoa's other content features (cosmetic,
// dark-mode) are JSWindowActors; frame scripts are the decaying path (the data:
// rejection is the canary). The actor also runs on privileged about: pages a
// content-process frame script never reaches.
//
// The editable predicate distills what Vimium + Tridactyl learned across millions
// of users — input-type BLACKLIST (unknown type => editable, per HTML5), textarea,
// select, contentEditable, ARIA textbox/searchbox/combobox/application (Google
// Docs) — plus their hard-won guards: readOnly excludes, and contentEditable is
// read defensively so SVG/MathML (where it's undefined) never throws. gjoa adds
// two things an extension CANNOT: document.designMode, and traversal through
// CLOSED shadow roots via the [ChromeOnly] openOrClosedShadowRoot (Lit/Polymer).
//
// Attribution — heuristics referenced (independent reimplementation, NOT their
// code; included here in the spirit of their licenses):
//   - Vimium    — MIT          — github.com/philc/vimium (lib/dom_utils.js
//                                 isSelectable/isEditable, simulateClick full
//                                 event sequence, getVisibleClientRect occlusion;
//                                 content_scripts/link_hints.js; mode_insert.js)
//   - Tridactyl — Apache-2.0    — github.com/tridactyl/tridactyl (src/lib/dom.ts
//                                 isTextEditable + isVisible occlusion + rounded-
//                                 border offset; src/lib/visual.ts selection dir)
// gjoa's fork edge over both (content-script tools): link hints pierce CLOSED
// shadow roots and find/visual use Firefox's own findbar + Selection engine.

const UNSELECTABLE_INPUT_TYPES = new Set([
  "button", "checkbox", "color", "file", "hidden", "image", "radio", "reset", "submit",
]);

// Is THIS element one the user types into (so vim must yield)?
function isEditableElement(el) {
  if (!el || typeof el.nodeName !== "string") {
    return false;
  }
  // readOnly text controls aren't "editing" (Tridactyl). Undefined on non-inputs.
  if (el.readOnly === true) {
    return false;
  }
  const tag = el.nodeName.toLowerCase();
  if (tag === "input") {
    return !UNSELECTABLE_INPUT_TYPES.has((el.type || "").toLowerCase());
  }
  if (tag === "textarea" || tag === "select") {
    return true;
  }
  // contentEditable is boolean only on HTMLElement; undefined on SVG/MathML —
  // the typeof guard is the SVG-safety Tridactyl added the hard way.
  if (typeof el.isContentEditable === "boolean" && el.isContentEditable) {
    return true;
  }
  const role =
    typeof el.getAttribute === "function" ? (el.getAttribute("role") || "").toLowerCase() : "";
  return role === "textbox" || role === "searchbox" || role === "combobox" || role === "application";
}

// Deepest focused element, descending through AUTHOR shadow roots — OPEN *and
// CLOSED* (the fork advantage: openOrClosedShadowRoot is [ChromeOnly], so a closed
// shadow root can't hide its focused input the way it hides from an extension).
// CRITICAL: stop once the element is itself editable — openOrClosedShadowRoot ALSO
// exposes form controls' UA-internal shadow roots, and descending into a focused
// <input>'s internals would land on a non-editable anonymous node. The control IS
// the target.
function deepActiveElement(doc) {
  if (!doc) {
    return null;
  }
  let a = doc.activeElement;
  while (a && !isEditableElement(a)) {
    let root = null;
    try {
      root = a.openOrClosedShadowRoot || a.shadowRoot;
    } catch (_) {
      root = null;
    }
    if (root && root.activeElement) {
      a = root.activeElement;
    } else {
      break;
    }
  }
  return a;
}

// Is the document in a typing context right now? designMode makes the WHOLE doc
// editable (WYSIWYG) — a check both reference tools miss.
function isEditingContext(doc) {
  if (!doc) {
    return false;
  }
  try {
    if (doc.designMode === "on") {
      return true;
    }
  } catch (_) {}
  return isEditableElement(deepActiveElement(doc));
}

// --- link hints (#130 P4) -----------------------------------------------------
// A keyboard interface to every clickable on the page: press 'f', type the short
// label that appears over the target, it activates. Same fork advantage as the
// editable detector — gjoa labels what an extension's content script also could,
// but lives in the privileged actor (so it reaches about: pages and is driven by
// the same chrome vim keymap, no separate WebExtension).

// Home-row-weighted, visually unambiguous label alphabet (no l/i/o/0-like glyphs).
const HINT_CHARS = "fjdkslarueiwogh";

// Fixed-length labels over HINT_CHARS, breadth-first — uniform length keeps them
// PREFIX-FREE (typing label A never ambiguously prefixes label AB), so a unique
// prefix can auto-activate. length = smallest L with chars^L >= count.
function generateHintLabels(count) {
  if (count <= 0) {
    return [];
  }
  const cs = HINT_CHARS;
  let len = 1;
  while (Math.pow(cs.length, len) < count) {
    len++;
  }
  const out = [];
  const rec = prefix => {
    if (out.length >= count) {
      return;
    }
    if (prefix.length === len) {
      out.push(prefix);
      return;
    }
    for (let i = 0; i < cs.length && out.length < count; i++) {
      rec(prefix + cs[i]);
    }
  };
  rec("");
  return out;
}

// Static hintable selector. Web Components' internal controls are reached via the
// shadow-root recursion below (which pierces CLOSED roots — the fork advantage).
const HINT_SELECTOR =
  "a[href], button, input:not([type=hidden]):not([disabled]), select:not([disabled])," +
  " textarea:not([disabled]), summary, [role=button], [role=link], [role=tab]," +
  " [role=checkbox], [role=menuitem], [onclick], [tabindex]:not([tabindex='-1']), label[for]";

// Gather candidate elements from a root (document or shadow root), descending
// through OPEN *and CLOSED* shadow roots — the privileged-actor advantage an
// extension can't have (openOrClosedShadowRoot is [ChromeOnly], same lever the
// editable detector uses). This is what surfaces hints inside Lit/Polymer/closed
// Web Components. Budget-bounded so a pathological DOM can't hang hint mode.
// (cursor:pointer-styled clickables + largest-child remapping are deferred v2
// polish — they need a per-element getComputedStyle scan we skip for now.)
function collectCandidates(root, out, budget) {
  let matches;
  try {
    matches = root.querySelectorAll(HINT_SELECTOR);
  } catch (_) {
    matches = [];
  }
  for (const el of matches) {
    out.add(el);
  }
  let all;
  try {
    all = root.querySelectorAll("*");
  } catch (_) {
    all = [];
  }
  for (const el of all) {
    if (--budget.n <= 0) {
      return;
    }
    let sr = null;
    try {
      sr = el.openOrClosedShadowRoot || el.shadowRoot;
    } catch (_) {}
    if (sr) {
      collectCandidates(sr, out, budget);
    }
  }
}

// Is the element really hittable: non-trivial size, in the viewport, painted, and
// NOT occluded by an overlay (modal / cookie-banner / popover). The occlusion test
// samples the rect via elementFromPoint at points nudged inside any border-radius
// curve — ceil(r·(1−sin45°)), Tridactyl's hard-won offset — and queries the
// element's OWN root, so a shadow child compares against its shadow tree, not the
// host. Returns the rect when hittable, else null. (Vimium/Tridactyl lesson.)
function isHintVisible(el, win) {
  let rect;
  try {
    rect = el.getBoundingClientRect();
  } catch (_) {
    return null;
  }
  if (!rect || rect.width < 2 || rect.height < 2) {
    return null;
  }
  const W = win.innerWidth,
    H = win.innerHeight;
  if (rect.bottom < 2 || rect.top > H - 2 || rect.right < 2 || rect.left > W - 2) {
    return null;
  }
  let st;
  try {
    st = win.getComputedStyle(el);
  } catch (_) {
    return null;
  }
  if (!st || st.visibility === "hidden" || st.display === "none" || st.opacity === "0") {
    return null;
  }
  let r = 0;
  try {
    r = parseFloat(st.borderTopLeftRadius) || 0;
  } catch (_) {}
  const off = Math.max(2, Math.ceil(r * (1 - Math.sin(Math.PI / 4))));
  const root = el.getRootNode();
  const pick = root && root.elementFromPoint ? root : el.ownerDocument;
  const pts = [
    [rect.left + rect.width / 2, rect.top + rect.height / 2],
    [rect.left + off, rect.top + off],
    [rect.right - off, rect.top + off],
    [rect.left + off, rect.bottom - off],
    [rect.right - off, rect.bottom - off],
  ];
  for (const [x, y] of pts) {
    let hit;
    try {
      hit = pick.elementFromPoint(x, y);
    } catch (_) {
      hit = null;
    }
    if (hit && (hit === el || el.contains(hit) || hit.contains(el))) {
      return rect; // a sample reaches the element => not occluded
    }
  }
  return null;
}

// Visible, hittable hint targets across the document AND its shadow trees, with
// wrapper false-positives culled (a generic span/div/li whose hint just duplicates
// a clickable child — Vimium's possibleFalsePositive lesson).
function collectHintTargets(win, doc) {
  const set = new Set();
  collectCandidates(doc, set, { n: 8000 });
  const targets = [];
  for (const el of set) {
    const tag = el.nodeName ? el.nodeName.toLowerCase() : "";
    if ((tag === "span" || tag === "div" || tag === "li") && !el.hasAttribute("onclick")) {
      let child;
      try {
        child = el.querySelector(HINT_SELECTOR);
      } catch (_) {
        child = null;
      }
      if (child && set.has(child)) {
        continue; // the real control is already hinted
      }
    }
    const rect = isHintVisible(el, win);
    if (rect) {
      targets.push({ el, rect });
    }
  }
  return targets;
}

export class GjoaInputChild extends JSWindowActorChild {
  constructor() {
    super();
    this._editable = null; // last reported, for dedupe
    // Smooth-scroll state (ported verbatim from the old frame script).
    this._scrollDir = 0;
    this._velocity = 0;
    this._pos = 0;
    this._lastTs = 0;
    this._scrollFrame = this._scrollFrame.bind(this);
    // Link-hint session: {map: Map<label,{el,tag}>, container, typed, newTab} | null.
    // Vim ('f'/'F') drives it from chrome via sendQuery; this content half owns the
    // DOM work (collect targets, render labels, filter on keystroke, activate). #130.
    this._hints = null;
  }

  // --- editable-focus reporting -------------------------------------------------
  #report() {
    let editable = false;
    try {
      editable = isEditingContext(this.document);
    } catch (_) {}
    if (editable === this._editable) {
      return;
    }
    this._editable = editable;
    try {
      this.sendAsyncMessage("GjoaInput:Focus", { editable });
    } catch (_) {}
  }

  handleEvent(event) {
    switch (event.type) {
      case "focusin":
      case "focusout":
      case "DOMContentLoaded":
      case "pageshow":
        this.#report();
        break;
      case "pagehide":
        // Leaving the page: drop any open hint overlay; nothing is focused here.
        this.#clearHints();
        if (this._editable !== false) {
          this._editable = false;
          try {
            this.sendAsyncMessage("GjoaInput:Focus", { editable: false });
          } catch (_) {}
        }
        break;
    }
  }

  // --- smooth scroll (chrome asks via getActor("GjoaInput").sendAsyncMessage) ----
  _scrollFrame(ts) {
    const win = this.contentWindow;
    if (!win) {
      this._scrollDir = 0;
      this._velocity = 0;
      return;
    }
    const TARGET_VELOCITY = 1200,
      ACCEL = 4500,
      DECEL = 6000;
    const now = typeof ts === "number" ? ts : win.performance.now();
    const dt = this._lastTs > 0 ? Math.min((now - this._lastTs) / 1000, 0.05) : 0;
    this._lastTs = now;
    if (this._scrollDir !== 0) {
      const target = this._scrollDir * TARGET_VELOCITY;
      const diff = target - this._velocity;
      const maxStep = ACCEL * dt;
      this._velocity += Math.abs(diff) <= maxStep ? diff : Math.sign(diff) * maxStep;
    } else {
      const decel = DECEL * dt;
      this._velocity =
        Math.abs(this._velocity) <= decel ? 0 : this._velocity - Math.sign(this._velocity) * decel;
    }
    this._pos += this._velocity * dt;
    const whole = this._pos >= 0 ? Math.floor(this._pos) : Math.ceil(this._pos);
    if (whole !== 0) {
      try {
        win.scrollBy(0, whole);
      } catch (_) {}
      this._pos -= whole;
    }
    if (this._scrollDir !== 0 || this._velocity !== 0) {
      win.requestAnimationFrame(this._scrollFrame);
    } else {
      this._lastTs = 0;
      this._pos = 0;
    }
  }

  // --- link hints (#130 P4) -----------------------------------------------------
  #clearHints() {
    if (this._hints && this._hints.container) {
      try {
        this._hints.container.remove();
      } catch (_) {}
    }
    this._hints = null;
  }

  // Collect targets, render a label over each, store the session. Returns {count}.
  #showHints(newTab) {
    this.#clearHints();
    const win = this.contentWindow,
      doc = this.document;
    if (!win || !doc || !doc.body) {
      return { count: 0 };
    }
    const targets = collectHintTargets(win, doc);
    if (!targets.length) {
      return { count: 0 };
    }
    const labels = generateHintLabels(targets.length);
    const container = doc.createElement("div");
    container.setAttribute("data-gjoa-hints", "1");
    // pointer-events:none so the overlay never intercepts the activation click.
    container.style.cssText =
      "position:fixed;left:0;top:0;width:0;height:0;z-index:2147483646;pointer-events:none;";
    const map = new Map();
    for (let i = 0; i < targets.length; i++) {
      const label = labels[i],
        { el, rect } = targets[i];
      const tag = doc.createElement("span");
      tag.textContent = label.toUpperCase();
      tag.style.cssText =
        "position:fixed;left:" +
        Math.max(0, Math.round(rect.left)) +
        "px;top:" +
        Math.max(0, Math.round(rect.top)) +
        "px;background:#fde047;color:#1a1500;border:1px solid #a16207;border-radius:3px;" +
        "padding:0 3px;font:bold 11px/1.45 ui-monospace,monospace;letter-spacing:1px;" +
        "z-index:2147483647;box-shadow:0 1px 2px rgba(0,0,0,.45);pointer-events:none;";
      container.appendChild(tag);
      map.set(label, { el, tag });
    }
    (doc.body || doc.documentElement).appendChild(container);
    this._hints = { map, container, typed: "", newTab: !!newTab };
    return { count: targets.length };
  }

  #activate(el) {
    try {
      const tag = (el.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") {
        el.focus(); // a dropdown / edit field needs focus FIRST (Vimium)
        return;
      }
      try {
        el.focus({ preventScroll: true });
      } catch (_) {}
      // Full pointer/mouse sequence, not a bare el.click(): many sites bind to
      // mousedown/mouseup (React, drag UIs, payment flows) and never see a lone
      // click() — they break silently. (Vimium/Tridactyl lesson.)
      const win = el.ownerGlobal || this.contentWindow;
      for (const type of [
        "pointerover", "mouseover", "pointerdown", "mousedown", "pointerup", "mouseup", "click",
      ]) {
        try {
          el.dispatchEvent(new win.MouseEvent(type, { view: win, bubbles: true, cancelable: true }));
        } catch (_) {}
      }
    } catch (_) {}
  }

  // One keystroke against the open hint session. Returns
  // {state:"active"|"done"|"cancelled", url?, newTab?} — chrome clears its hint flag
  // when state != "active", and opens url in a new tab when newTab is set (a link
  // target the content process shouldn't navigate to itself).
  #hintKey(key) {
    const h = this._hints;
    if (!h) {
      return { state: "cancelled" };
    }
    if (key === "Backspace") {
      h.typed = h.typed.slice(0, -1);
    } else if (typeof key === "string" && key.length === 1) {
      h.typed += key.toLowerCase();
    } else {
      return { state: "active" }; // modifiers / arrows: ignore, stay open
    }
    const typed = h.typed;
    let remaining = 0,
      only = null;
    for (const [label, rec] of h.map) {
      const match = label.startsWith(typed);
      rec.tag.style.display = match ? "" : "none";
      if (match) {
        remaining++;
        only = rec;
      }
    }
    if (typed && remaining === 0) {
      this.#clearHints();
      return { state: "cancelled" };
    }
    // Unique prefix → activate (prefix-free labels make this unambiguous).
    if (typed && remaining === 1 && only) {
      const el = only.el,
        newTab = h.newTab;
      const href =
        el.tagName && el.tagName.toLowerCase() === "a" && el.href ? el.href : null;
      this.#clearHints();
      if (newTab && href) {
        return { state: "done", url: href, newTab: true };
      }
      this.#activate(el);
      return { state: "done" };
    }
    return { state: "active" };
  }

  // --- visual / caret mode (#130 P6) --------------------------------------------
  // 'v' seeds a caret at the first visible text and enters visual mode; hjkl/w/b
  // EXTEND the selection (a visible highlight — a pure invisible caret is useless
  // headless and without caret-browsing), 'y' yanks it, ESC clears. The Selection
  // IS the state — no field to track beyond what the DOM holds.
  #visualSeed() {
    const win = this.contentWindow,
      doc = this.document;
    if (!win || !doc || !doc.body) {
      return null;
    }
    const sel = win.getSelection();
    if (!sel) {
      return null;
    }
    if (sel.rangeCount && !sel.isCollapsed) {
      return sel; // keep an existing selection as the anchor
    }
    // first non-empty, laid-out text node
    try {
      const walker = doc.createTreeWalker(doc.body, win.NodeFilter.SHOW_TEXT, {
        acceptNode(n) {
          return n.nodeValue &&
            n.nodeValue.trim() &&
            n.parentElement &&
            n.parentElement.getClientRects().length
            ? win.NodeFilter.FILTER_ACCEPT
            : win.NodeFilter.FILTER_SKIP;
        },
      });
      const first = walker.nextNode();
      sel.removeAllRanges();
      sel.collapse(first || doc.body, 0);
    } catch (_) {
      try {
        sel.collapse(doc.body, 0);
      } catch (_) {}
    }
    return sel;
  }

  #visualStart() {
    const sel = this.#visualSeed();
    return { ok: !!sel };
  }

  // dir: left|right|forward|backward, unit: character|word|line|lineboundary.
  #visualMove(dir, unit) {
    const win = this.contentWindow;
    if (!win) {
      return { ok: false };
    }
    const sel = win.getSelection();
    if (!sel) {
      return { ok: false };
    }
    try {
      sel.modify("extend", dir, unit);
      // keep the moving edge on screen
      if (sel.focusNode && sel.focusNode.parentElement) {
        sel.focusNode.parentElement.scrollIntoView({ block: "nearest", inline: "nearest" });
      }
    } catch (_) {
      return { ok: false };
    }
    return { ok: true, len: sel.toString().length };
  }

  #visualYank() {
    const win = this.contentWindow,
      doc = this.document;
    const sel = win && win.getSelection();
    const text = sel ? sel.toString() : "";
    let copied = false;
    try {
      copied = doc.execCommand("copy"); // copies the live selection
    } catch (_) {}
    return { ok: true, len: text.length, copied };
  }

  #visualCancel() {
    try {
      const sel = this.contentWindow && this.contentWindow.getSelection();
      if (sel) {
        sel.removeAllRanges();
      }
    } catch (_) {}
    return { ok: true };
  }

  receiveMessage(msg) {
    if (msg.name === "GjoaInput:ScrollStart") {
      const dy = typeof msg.data?.dy === "number" ? msg.data.dy : 0;
      const dir = dy > 0 ? 1 : dy < 0 ? -1 : 0;
      if (dir === 0) {
        return;
      }
      const wasIdle = this._scrollDir === 0 && this._velocity === 0;
      this._scrollDir = dir;
      const win = this.contentWindow;
      if (wasIdle && win) {
        this._lastTs = 0;
        win.requestAnimationFrame(this._scrollFrame);
      }
    } else if (msg.name === "GjoaInput:ScrollStop") {
      this._scrollDir = 0;
    } else if (msg.name === "LinkHints:Show") {
      return this.#showHints(msg.data && msg.data.newTab);
    } else if (msg.name === "LinkHints:Key") {
      return this.#hintKey(msg.data && msg.data.key);
    } else if (msg.name === "LinkHints:Cancel") {
      this.#clearHints();
      return { state: "cancelled" };
    } else if (msg.name === "Visual:Start") {
      return this.#visualStart();
    } else if (msg.name === "Visual:Move") {
      return this.#visualMove(msg.data && msg.data.dir, msg.data && msg.data.unit);
    } else if (msg.name === "Visual:Yank") {
      return this.#visualYank();
    } else if (msg.name === "Visual:Cancel") {
      return this.#visualCancel();
    }
    return undefined;
  }
}
