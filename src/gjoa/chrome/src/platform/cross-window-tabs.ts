// Cross-window tab aggregator — `Gjoa.tabs.all()`.
//
// Iterates every browser chrome window in this Firefox process via
// Services.wm and merges each window's `Gjoa.windows.current().tabs.list()`
// into a flat array tagged with `windowId`. That's the answer to "search
// across all windows" — same Firefox profile, same SQLite, no IPC.
//
// Distinct from:
//   - `Gjoa.windows.current().tabs.list()` — single window only
//   - hypothetical cross-PROFILE search — different Firefox profiles,
//     not built today (see firefox-stability-roadmap.md M11)

import type { GjoaTab } from "./window-tabs.ts";

// =============================================================================
// INTERFACE
// =============================================================================

/** A tab from any chrome window of this Firefox process, tagged with the
 *  window it came from. The `windowId` matches `GjoaWindow.windowId`
 *  on the source window's facade. */
export type CrossWindowTab = GjoaTab & { readonly windowId: string };

export type CrossWindowTabsAPI = {
  /** All tabs across every chrome window in this Firefox process,
   *  current window first, then others in enumeration order. Each tab
   *  carries its `windowId` so callers (e.g. picker) can show window
   *  context. */
  all(): readonly CrossWindowTab[];
  /** Activate a specific tab by gjoa id + the windowId it lives on.
   *  Raises the source chrome window AND selects the tab. Returns true
   *  on success, false if the window or tab can't be found (e.g. window
   *  closed between picker open and select). */
  activate(gjoaId: number, windowId: string): boolean;
};

// Shape we expect each chrome window's `window.Gjoa` to expose.
// Avoids a cyclic import on `GjoaAPI`.
type WindowGjoa = {
  windows: { current(): { windowId: string; tabs: { list(): readonly GjoaTab[]; activate(ref: number): boolean } } };
};

// =============================================================================
// IMPLEMENTATION
// =============================================================================

export function makeCrossWindowTabs(): CrossWindowTabsAPI {
  return {
    all(): readonly CrossWindowTab[] {
      const out: CrossWindowTab[] = [];
      try {
        const e = Services.wm.getEnumerator("navigator:browser");
        while (e.hasMoreElements()) {
          const w = e.getNext() as Window & { Gjoa?: WindowGjoa };
          const p = w.Gjoa;
          if (!p) continue;
          const win = p.windows.current();
          for (const t of win.tabs.list()) {
            out.push({ ...t, windowId: win.windowId });
          }
        }
      } catch (e) {
        console.error("[Gjoa.tabs.all] enumerate failed", e);
      }
      return out;
    },

    activate(gjoaId, windowId) {
      try {
        const e = Services.wm.getEnumerator("navigator:browser");
        while (e.hasMoreElements()) {
          const w = e.getNext() as Window & { Gjoa?: WindowGjoa };
          const p = w.Gjoa;
          if (!p) continue;
          const win = p.windows.current();
          if (win.windowId !== windowId) continue;
          // Source window found. Its activate() does the select + focus
          // dance — running the call THERE means `window.focus()` inside
          // it raises the right chrome window.
          return win.tabs.activate(gjoaId);
        }
      } catch (e) {
        console.error("[Gjoa.tabs.activate] failed", e);
      }
      return false;
    },
  };
}
