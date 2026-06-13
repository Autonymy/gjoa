// Content-focus bridge — JSWindowActor-style frame script that reports the
// editable-status of content's active element back to chrome.
//
// Why: gjoa keys live in chrome scope, but we need Tridactyl/Vimium-style
// "is the user typing into something" detection that's only knowable from
// content scope. e10s isolation means chrome can't read content DOM. So we
// inject a tiny frame script that owns the same logic Vimium uses
// (lib/dom_utils.js::isFocusable + walking shadow roots) and forwards a
// boolean to chrome via the message manager.
//
// Logic mirrors:
//   - Vimium:   content_scripts/mode_insert.js (permanent InsertMode)
//                + lib/dom_utils.js (isFocusable / isEditable / isSelectable)
//   - Tridactyl: src/lib/dom.ts::isTextEditable
//
// Both run in content scope. We can't, so this is the closest we get:
// content-scope helper + chrome-scope cache + chrome-scope read in the
// keymap bail. State is cached per-browser-element, so tab switches pick
// up the right tab's cached state automatically.

import { createLogger, type Logger } from "./log.ts";


// =============================================================================
// INTERFACE
// =============================================================================

export type ContentFocusAPI = {
  /** True iff the currently selected tab's content has focus on an editable
   *  element (input, textarea, contentEditable, role=textbox/application).
   *  False otherwise — including when content has focus on body / a button /
   *  a link / nothing at all. */
  contentInputFocused(): boolean;
  /** Test/debug introspection — exposed via gjoaTest.contentFocusDiag(). */
  diag(): { messageCount: number; lastMessageEditable: boolean | null; cachedForCurrent: boolean | undefined };
  /** Tear down message listeners + frame script. Called from window.unload. */
  destroy(): void;
};

// =============================================================================
// FRAME SCRIPT (runs in every content frame)
// =============================================================================

// IIFE serialized into a data: URL.
//
// Frame-script global DOES inherit from EventTarget — verified against
// dom/chrome-webidl/MessageManager.webidl:434 (`ContentFrameMessageManager :
// EventTarget`). Listeners attached via the global `addEventListener` capture
// content events from EVERY content window loaded into this frame loader, so
// the listener survives navigation (which `content.addEventListener` does
// NOT — `content` is a moving reference).
//
// `Element` and `document` are NOT global. Don't use `instanceof Element`;
// duck-type via `.nodeName` instead. Always go through `content.document`.
//
// isSelectable/isEditable port directly from Vimium's lib/dom_utils.js
// (isFocusable + isSelectable + isEditable). Shadow-root traversal mirrors
// content_scripts/mode_insert.js::getActiveElement. ARIA roles textbox /
// searchbox / application cover Tridactyl's Google Docs / Sheets case
// (src/lib/dom.ts::isTextEditable).
const FRAME_SCRIPT_SRC = `
"use strict";
(function() {
  const UNSELECTABLE_INPUT_TYPES = new Set([
    "button","checkbox","color","file","hidden","image","radio","reset","submit"
  ]);

  function isSelectable(el) {
    if (!el || typeof el.nodeName !== "string") return false;
    const tag = el.nodeName.toLowerCase();
    if (tag === "input") return !UNSELECTABLE_INPUT_TYPES.has((el.type || "").toLowerCase());
    if (tag === "textarea") return true;
    if (el.isContentEditable) return true;
    return false;
  }

  function isEditable(el) {
    if (isSelectable(el)) return true;
    if (!el || typeof el.nodeName !== "string") return false;
    if (el.nodeName.toLowerCase() === "select") return true;
    const role = (typeof el.getAttribute === "function") ? el.getAttribute("role") : null;
    if (role === "textbox" || role === "searchbox" || role === "application") return true;
    return false;
  }

  function deepActiveElement() {
    if (!content || !content.document) return null;
    let a = content.document.activeElement;
    while (a && a.shadowRoot && a.shadowRoot.activeElement) {
      a = a.shadowRoot.activeElement;
    }
    return a;
  }

  let lastReported = null;
  function report() {
    try {
      const editable = isEditable(deepActiveElement());
      if (editable === lastReported) return;
      lastReported = editable;
      sendAsyncMessage("Gjoa:FocusState", { editable: editable });
    } catch (_) {}
  }

  // Capture phase + global addEventListener (which targets the message
  // manager's EventTarget, downstream of all content windows in this frame
  // loader — see WebIDL above). Survives navigation between pages.
  addEventListener("focusin",  report, true);
  addEventListener("focusout", report, true);
  addEventListener("click",    report, true);
  addEventListener("DOMContentLoaded", function () {
    lastReported = null;
    report();
  }, true);
  addEventListener("pagehide", function () {
    if (lastReported === false) return;
    lastReported = false;
    try { sendAsyncMessage("Gjoa:FocusState", { editable: false }); } catch (_) {}
  }, true);

  addMessageListener("Gjoa:FocusProbe", function () {
    lastReported = null;
    report();
  });

  // Cross-process smooth scroll. Chrome can't reach content.scrollBy
  // directly across e10s, so the frame script (in content scope) owns
  // the scroll loop. j/k in src/tabs/vim.ts send Gjoa:ScrollStart on
  // keydown and Gjoa:ScrollStop on keyup.
  //
  // Physics model (vs. the original linear 12px/frame step):
  //   - press → accelerate from rest toward TARGET_VELOCITY
  //   - hold  → stay at TARGET_VELOCITY (no oscillation, no over/undershoot)
  //   - release → decelerate to 0 (a brief momentum tail, not an instant stop)
  // Sub-pixel position is accumulated in 'pos' so dt-irregular frames
  // (typical when other rendering work delays rAF) don't show as a
  // jittery scroll position.
  //
  // Tuning:
  //   TARGET_VELOCITY  ~1200 px/sec  (≈ +60% over the prior 720 px/sec)
  //   ACCEL  4500 px/sec²  reaches terminal in ~0.27s — perceived as "instant
  //                        but not jarring" per Vimium/Tridactyl ranges
  //   DECEL  6000 px/sec²  release feels crisp without an abrupt cut
  let scrollDir = 0;          // +1 down, -1 up, 0 idle
  let velocity = 0;           // signed px/sec
  let pos = 0;                // sub-pixel accumulator
  let lastTs = 0;             // last rAF timestamp; 0 means "first frame"
  const TARGET_VELOCITY = 1200;
  const ACCEL = 4500;
  const DECEL = 6000;

  function scrollFrame(ts) {
    const now = typeof ts === "number" ? ts : (content && content.performance ? content.performance.now() : Date.now());
    const dt = lastTs > 0 ? Math.min((now - lastTs) / 1000, 0.05) : 0;
    lastTs = now;

    if (scrollDir !== 0) {
      // Approach signed target. Sign(target - velocity) gives direction
      // of acceleration; magnitude limited by ACCEL * dt per frame.
      const target = scrollDir * TARGET_VELOCITY;
      const diff = target - velocity;
      const maxStep = ACCEL * dt;
      velocity += Math.abs(diff) <= maxStep ? diff : Math.sign(diff) * maxStep;
    } else {
      // Decelerate toward 0.
      const decel = DECEL * dt;
      velocity = Math.abs(velocity) <= decel ? 0 : velocity - Math.sign(velocity) * decel;
    }

    pos += velocity * dt;
    const whole = pos >= 0 ? Math.floor(pos) : Math.ceil(pos);
    if (whole !== 0) {
      try { if (content) content.scrollBy(0, whole); } catch (_) {}
      pos -= whole;
    }

    if (scrollDir !== 0 || velocity !== 0) {
      if (content && content.requestAnimationFrame) content.requestAnimationFrame(scrollFrame);
    } else {
      lastTs = 0;
      pos = 0;
    }
  }

  addMessageListener("Gjoa:ScrollStart", function (msg) {
    const data = (msg && msg.data) || {};
    const dy = typeof data.dy === "number" ? data.dy : 0;
    const dir = dy > 0 ? 1 : dy < 0 ? -1 : 0;
    if (dir === 0) return;
    const wasIdle = scrollDir === 0 && velocity === 0;
    scrollDir = dir;
    if (wasIdle && content && content.requestAnimationFrame) {
      lastTs = 0; // first frame's dt is 0; velocity ramps from next frame
      content.requestAnimationFrame(scrollFrame);
    }
  });
  addMessageListener("Gjoa:ScrollStop", function () {
    scrollDir = 0;
    // Loop keeps running until velocity decays to 0 — gives the momentum tail.
  });

  report();
})();
`;

// =============================================================================
// IMPLEMENTATION
// =============================================================================

export function makeContentFocus(): ContentFocusAPI {
  const log: Logger = createLogger("contentFocus");
  // Per-browser cache. WeakMap so closing a tab GCs the entry naturally.
  const editablePerBrowser = new WeakMap<Element, boolean>();

  const dataUrl = "data:application/javascript;charset=utf-8," + encodeURIComponent(FRAME_SCRIPT_SRC);

  // window.messageManager is the chrome window's group manager — broadcasts
  // to every <browser> frame loader in this window AND queues for new ones
  // when allowDelayedLoad=true. (gBrowser.messageManager is technically the
  // same object on tabbrowser, but window.messageManager is the documented
  // entry point.)
  const mm = (window as unknown as { messageManager?: any }).messageManager
    ?? (gBrowser as { messageManager?: any }).messageManager;
  if (!mm) {
    log("init:no-message-manager");
    return {
      contentInputFocused: () => false,
      diag: () => ({ messageCount: 0, lastMessageEditable: null, cachedForCurrent: undefined }),
      destroy: () => {},
    };
  }

  let messageCount = 0;
  let lastMessageEditable: boolean | null = null;
  function onFocusState(msg: { target: Element; data: { editable: boolean } }): void {
    messageCount++;
    lastMessageEditable = !!msg.data.editable;
    editablePerBrowser.set(msg.target, !!msg.data.editable);
    log("focusState:received", { editable: msg.data.editable, count: messageCount });
  }

  mm.addMessageListener("Gjoa:FocusState", onFocusState);
  mm.loadFrameScript(dataUrl, /* allowDelayedLoad */ true);
  log("init", { dataUrlSize: dataUrl.length });

  // On tab switch, ask the newly-selected tab's frame script to re-report.
  // Without this, a tab that hasn't yet emitted a focus event keeps the
  // cache empty (treated as "not editable"). The frame script handles
  // "Gjoa:FocusProbe" by busting its dedupe and re-running report().
  function onTabSelect(): void {
    try {
      const browser = (gBrowser as { selectedBrowser?: { messageManager?: any } }).selectedBrowser;
      browser?.messageManager?.sendAsyncMessage("Gjoa:FocusProbe");
    } catch (e) {
      log("probe:error", { msg: String(e) });
    }
  }
  gBrowser.tabContainer?.addEventListener("TabSelect", onTabSelect);

  function contentInputFocused(): boolean {
    try {
      const browser = (gBrowser as { selectedBrowser?: Element }).selectedBrowser;
      if (!browser) return false;
      return editablePerBrowser.get(browser) === true;
    } catch {
      return false;
    }
  }

  function destroy(): void {
    try {
      mm.removeMessageListener("Gjoa:FocusState", onFocusState);
      mm.removeDelayedFrameScript?.(dataUrl);
    } catch (e) {
      log("destroy:error", { msg: String(e) });
    }
    gBrowser.tabContainer?.removeEventListener("TabSelect", onTabSelect);
  }

  function diag() {
    let cachedForCurrent: boolean | undefined;
    try {
      const browser = (gBrowser as { selectedBrowser?: Element }).selectedBrowser;
      if (browser) cachedForCurrent = editablePerBrowser.get(browser);
    } catch {}
    return { messageCount, lastMessageEditable, cachedForCurrent };
  }

  return { contentInputFocused, diag, destroy };
}
