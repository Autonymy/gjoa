// Window-scoped facade — the object you get from `Gjoa.windows.current()`.
//
// Each chrome window has exactly one GjoaWindow. It groups the
// window-local APIs: tabs, events (future), urlbar (future), sidebar
// (future). Multi-window aggregation lives at the top-level Gjoa
// namespace, NOT here.

import type { SchedulerAPI } from "./scheduler.ts";
import { makeWindowTabs, type WindowTabsAPI } from "./window-tabs.ts";

// =============================================================================
// INTERFACE
// =============================================================================

export type GjoaWindow = {
  /** Per-window stable id. Today: a generated UUID per chrome window;
   *  used by cross-window queries (M12) to attribute results. */
  readonly windowId: string;
  readonly tabs: WindowTabsAPI;
  // Future: events, urlbar, sidebar surfaces live here.
};

// =============================================================================
// IMPLEMENTATION
// =============================================================================

export function makeGjoaWindow(scheduler: SchedulerAPI): GjoaWindow {
  // crypto.randomUUID() guarantees uniqueness across chrome windows. A
  // module-local counter would collide because each chrome window loads
  // its own bundle (own module scope) and would restart at 1.
  const windowId = (crypto as { randomUUID(): string }).randomUUID();
  return {
    windowId,
    tabs: makeWindowTabs(scheduler),
  };
}
