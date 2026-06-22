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
//                                 isSelectable/isEditable; mode_insert.js)
//   - Tridactyl — Apache-2.0    — github.com/tridactyl/tridactyl (src/lib/dom.ts
//                                 isTextEditable: readOnly, role=application,
//                                 SVG-safe contentEditable)

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
        // Leaving the page: nothing is focused here anymore.
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
    }
  }
}
