// Custom sidebar button + context menu.
//
// Replaces Firefox's native #sidebar-button with our own #gjoa-sidebar-button:
//   - left-click: toggle compact mode for whichever layout (vertical /
//     horizontal) is currently active
//   - right-click: opens our own #gjoa-sidebar-button-menu (we own the
//     popup completely; previous overload-Firefox's-menu approach
//     fought UA popupshowing handlers and made items morph mid-paint)
//
// Items in the menu:
//   - Enable/Disable Compact (label flips per current state)
//   - Collapse/Expand Layout (vertical only — clicks the hidden native
//     button briefly to flip sidebar-launcher-expanded)
//   - Enable/Disable Sidebar (toggles the bookmarks/history sidebar widget
//     via SidebarController/SidebarUI/cmd_toggleSidebar fallback chain)
//   - Horizontal/Vertical Tabs (flips sidebar.verticalTabs pref)
//   - separator
//   - Customize Sidebar (passes through to Firefox's customize-sidebar
//     command so users keep access to the upstream UI)

import { createLogger } from "../tabs/log.ts";
import type { CompactAPI } from "./compact.ts";

declare const Services: {
  prefs: {
    getBoolPref(name: string, def: boolean): boolean;
    setBoolPref(name: string, value: boolean): void;
  };
};

declare const window: Window & {
  SidebarController?: { toggle?: () => void; isOpen?: boolean };
  SidebarUI?: { toggle?: () => void };
};

// =============================================================================
// INTERFACE
// =============================================================================

export type SidebarButtonDeps = {
  readonly sidebarMain: HTMLElement;
  readonly compact: CompactAPI;
};

export type SidebarButtonAPI = {
  destroy(): void;
};

// =============================================================================
// IMPLEMENTATION
// =============================================================================

export function makeSidebarButton(deps: SidebarButtonDeps): SidebarButtonAPI {
  const log = createLogger("drawer/sidebar-button");
  const { sidebarMain, compact } = deps;
  const xul = (tag: string): HTMLElement =>
    (document as Document & { createXULElement(t: string): HTMLElement }).createXULElement(tag);

  // In Firefox 151 sidebar-revamp + vertical-tabs mode, the native
  // #sidebar-button widget is NOT registered in nav-bar. Verified by
  // tests/integration/nav-bar-layout.ts diagnostic: nav-bar in vertical
  // mode contains only back/forward/vertical-spacer/extensions, with
  // PanelUI-button (hamburger) as a sibling of customization-target.
  //
  // For horizontal-tabs (legacy) mode, native #sidebar-button DOES
  // exist. Keep the swap-the-native code path for that case; in
  // vertical mode we'd need a different approach (synthesize our own
  // toggle button from scratch) — TODO for next session.
  const native = document.getElementById("sidebar-button");
  if (native) {
    return install(native, sidebarMain, compact);
  }
  log("init:no native #sidebar-button (vertical-tabs+revamp mode) — skipping custom-button swap");
  return { destroy: () => {} };
}

function install(
  sidebarButton: HTMLElement,
  sidebarMain: HTMLElement,
  compact: CompactAPI,
): SidebarButtonAPI {
  const xul = (tag: string): HTMLElement =>
    (document as Document & { createXULElement(t: string): HTMLElement }).createXULElement(tag);

  // Snapshot the icon style before hiding the native button.
  const ogIcon = sidebarButton.querySelector(".toolbarbutton-icon");
  const ogIconStyle = ogIcon ? getComputedStyle(ogIcon).listStyleImage : null;

  sidebarButton.style.display = "none";

  const button = xul("toolbarbutton");
  button.id = "gjoa-sidebar-button";
  button.className = sidebarButton.className;
  button.setAttribute(
    "tooltiptext",
    "Toggle compact mode (right-click for more)",
  );
  // Copy CUI attributes so Firefox's popupshowing logic recognizes our
  // button as a real toolbar widget.
  for (const attr of [
    "cui-areatype",
    "widget-id",
    "widget-type",
    "removable",
    "overflows",
  ]) {
    if (sidebarButton.hasAttribute(attr)) {
      button.setAttribute(attr, sidebarButton.getAttribute(attr) ?? "");
    }
  }
  if (ogIconStyle) button.style.listStyleImage = ogIconStyle;
  // Native #sidebar-button may live inside #nav-bar-customization-target
  // (depending on profile customization). Reparent our replacement to be
  // a direct child of #nav-bar, immediately after #PanelUI-button — that
  // way the `order: -9` rule on `#nav-bar > #gjoa-sidebar-button` (see
  // gjoa.uc.css nav-bar layout region) places it visually adjacent to
  // the hamburger, NOT inside the right-anchored customization-target.
  //
  // Fallback: if for any reason nav-bar / PanelUI-button isn't there,
  // keep the original `sidebarButton.after(button)` placement.
  const navBar = document.getElementById("nav-bar");
  const panelUI = document.getElementById("PanelUI-button");
  if (navBar && panelUI && panelUI.parentNode === navBar) {
    panelUI.after(button);
  } else {
    sidebarButton.after(button);
  }

  // Nav-bar reflow uses CSS `order` (CustomizableUI fights DOM moves but
  // doesn't observe CSS order). In expanded-sidebar mode the flex spring
  // between left icon-group and CT is a `::before` pseudo on CT (see
  // gjoa.uc.css). No DOM spring needed in any mode.

  function onClick(e: Event): void {
    if ((e as MouseEvent).button !== 0) return;
    compact.toggle();
  }
  button.addEventListener("click", onClick);

  // --- Custom context menu ---
  const menu = xul("menupopup");
  menu.id = "gjoa-sidebar-button-menu";

  function mi(id: string, label: string, onCommand: () => void): HTMLElement {
    const item = xul("menuitem");
    item.id = id;
    item.setAttribute("label", label);
    item.addEventListener("command", onCommand);
    return item;
  }

  const compactItem = mi("gjoa-toggle-compact", "Enable Compact",
    () => compact.toggle());

  const collapseItem = mi("gjoa-collapse-layout", "Collapse Layout", () => {
    try {
      const prevDisplay = sidebarButton!.style.display;
      sidebarButton!.style.display = "";
      (sidebarButton as HTMLElement).click();
      sidebarButton!.style.display = prevDisplay;
    } catch (e) {
      console.error("[GJOA:drawer] collapse layout failed", e);
    }
  });

  const sidebarItem = mi("gjoa-toggle-sidebar", "Enable Sidebar", () => {
    try {
      if (window.SidebarController?.toggle) { window.SidebarController.toggle(); return; }
      if (window.SidebarUI?.toggle) { window.SidebarUI.toggle(); return; }
      const cmd = document.getElementById("cmd_toggleSidebar") as (HTMLElement & { doCommand?: () => void }) | null;
      if (cmd?.doCommand) { cmd.doCommand(); return; }
      console.error("[GJOA:drawer] no sidebar-toggle API available");
    } catch (e) { console.error("[GJOA:drawer] sidebar toggle failed", e); }
  });

  const layoutItem = mi("gjoa-toggle-tab-layout", "Horizontal Tabs", () => {
    const vertical = Services.prefs.getBoolPref("sidebar.verticalTabs", true);
    Services.prefs.setBoolPref("sidebar.verticalTabs", !vertical);
  });

  const customizeItem = mi("gjoa-customize-sidebar", "Customize Sidebar", () => {
    try {
      const native = document.getElementById("toolbar-context-customize-sidebar") as (HTMLElement & { doCommand?: () => void }) | null;
      native?.doCommand?.();
      if (!native?.doCommand) native?.click?.();
    } catch (e) { console.error("gjoa: customize sidebar failed", e); }
  });

  menu.append(
    compactItem,
    collapseItem,
    sidebarItem,
    layoutItem,
    xul("menuseparator"),
    customizeItem,
  );

  // Append to mainPopupSet so it's at the document root (rendered in the
  // top layer like all chrome popups).
  const popupSet = document.getElementById("mainPopupSet");
  popupSet?.appendChild(menu);

  // Wire the button to our menu. Firefox's context-menu plumbing reads
  // the `context` attribute and opens the named popup on right-click.
  button.setAttribute("context", "gjoa-sidebar-button-menu");

  // Update labels / hidden state on every open. With our own menu
  // there's no fight with Firefox's UA handler.
  function onPopupShowing(): void {
    const vertical = Services.prefs.getBoolPref("sidebar.verticalTabs", true);
    const isCompact = vertical ? compact.isCompactVertical() : compact.isCompactHorizontal();
    compactItem.setAttribute("label",
      isCompact ? "Disable Compact" : "Enable Compact");

    (collapseItem as HTMLElement & { hidden: boolean }).hidden = !vertical;
    if (vertical) {
      const expanded = sidebarMain.hasAttribute("sidebar-launcher-expanded");
      collapseItem.setAttribute("label",
        expanded ? "Collapse Layout" : "Expand Layout");
    }

    const sidebarOpen = window.SidebarController?.isOpen
      ?? (!(sidebarMain as HTMLElement & { hidden: boolean }).hidden
          && sidebarMain.getBoundingClientRect().width > 0);
    sidebarItem.setAttribute("label",
      sidebarOpen ? "Disable Sidebar" : "Enable Sidebar");

    layoutItem.setAttribute("label",
      vertical ? "Horizontal Tabs" : "Vertical Tabs");

    // Pin the active surface visible while our menu is open. The popup
    // counter inside compact does this implicitly, but mouseleave +
    // flash callbacks can race with popupshown — explicit pin makes
    // "menu open ⇒ visible" a deterministic invariant.
    if (compact.isCompactVertical()) compact.pinSidebar();
    if (compact.isCompactHorizontal()) compact.pinToolbox();
  }
  menu.addEventListener("popupshowing", onPopupShowing);

  function onPopupHidden(): void {
    compact.reconcile("menu:popuphidden");
    compact.reconcileHorizontal("menu:popuphidden");
  }
  menu.addEventListener("popuphidden", onPopupHidden);

  function destroy(): void {
    button.removeEventListener("click", onClick);
    menu.removeEventListener("popupshowing", onPopupShowing);
    menu.removeEventListener("popuphidden", onPopupHidden);
    menu.remove();
    button.remove();
    sidebarButton!.style.display = "";
  }

  return { destroy };
}
