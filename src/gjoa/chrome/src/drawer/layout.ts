// Drawer layout — toolbox/urlbar reparenting + width sync + width pref.
//
// Three coupled concerns:
//
// 1. **Expand/collapse**: in vertical-expanded mode, gjoa moves
//    #navigator-toolbox into #sidebar-main and wraps #urlbar-container in
//    a fresh `<toolbar id="gjoa-urlbar-toolbar">` so Firefox's urlbar
//    breakout-extend logic (which calls `closest("toolbar")`) still works.
//    Collapse undoes both moves.
//
// 2. **Width sync**: while expanded, Firefox's UrlbarInput periodically
//    sets `--urlbar-width` on #urlbar to its own measurement of the
//    surrounding toolbar. We override it with a sidebar-aware value so
//    the urlbar fits the sidebar's actual interior width minus inset.
//    Suspended during breakout-extend (UrlbarInput owns sizing then).
//
// 3. **Width pref**: `gjoa.sidebar.width` persists the user's chosen
//    sidebar width. Applied on startup if currently expanded; written
//    via ResizeObserver on every settle.
//
// These are interleaved because the width-sync observers need to be set
// up inside expand() (when the toolbar wrapper exists) and torn down
// inside collapse(). Splitting them would mean threading observer state
// across files — not worth it.

import { createLogger } from "../tabs/log.ts";

declare const Services: {
  prefs: {
    getIntPref(name: string, def: number): number;
    setIntPref(name: string, value: number): void;
  };
};

// =============================================================================
// INTERFACE
// =============================================================================

export type LayoutDeps = {
  readonly sidebarMain: HTMLElement;
  readonly navigatorToolbox: HTMLElement;
  readonly urlbarContainer: HTMLElement;
  readonly navBar: HTMLElement;
  readonly urlbar: HTMLElement | null;
};

export type LayoutAPI = {
  /** True iff gjoa has the toolbox parented inside the sidebar. */
  isExpanded(): boolean;
  /** Tear down all observers + listeners (collapse stays in place — the
   *  user's session wants whatever layout was active). */
  destroy(): void;
};

// =============================================================================
// IMPLEMENTATION
// =============================================================================

const WIDTH_PREF = "gjoa.sidebar.width";

export function makeLayout(deps: LayoutDeps): LayoutAPI {
  const log = createLogger("drawer/layout");
  const { sidebarMain, navigatorToolbox, urlbarContainer, navBar, urlbar } = deps;
  const sidebarMainElement = sidebarMain.querySelector("sidebar-main");

  // Save original DOM positions before any moves, for collapse restoration.
  const toolboxParent = navigatorToolbox.parentNode;
  const toolboxNext = navigatorToolbox.nextSibling;
  const urlbarParent = urlbarContainer.parentNode;
  const urlbarNext = urlbarContainer.nextSibling;

  let urlbarToolbar: HTMLElement | null = null;
  let resizeObs: ResizeObserver | null = null;
  let mutationObs: MutationObserver | null = null;
  let updating = false;

  // Inject our overrides into sidebar-main's shadow DOM. Shadow root may
  // not exist yet — poll briefly until it does.
  //   1. Hide the tools-and-extensions splitter (was visible as a thin
  //      line dividing tabs/tools — we don't want it).
  //   2. Zero the extra `padding-block-end` Firefox 151 applies to the
  //      LAST `.bottom-actions` button (the cog/customize-sidebar).
  //      The extra space looks like an unintentional gap between the
  //      star and cog in icons-only mode — and a stray gap below the
  //      cog in horizontal mode. Uniform spacing is what we want.
  function injectSidebarShadowOverrides(): void {
    const sr = (sidebarMainElement as { shadowRoot?: ShadowRoot } | null)?.shadowRoot;
    if (!sr) {
      setTimeout(injectSidebarShadowOverrides, 100);
      return;
    }
    const s = new CSSStyleSheet();
    s.replaceSync(`
      #sidebar-tools-and-extensions-splitter { display: none !important; }
      /* Firefox 151 gives the FIRST and LAST buttons extra block-padding
       * (var(--space-small) = 0.5rem ≈ 8px) so they sit farther from the
       * sidebar edge than they do from each other (inter-icon gap is just
       * 2 × var(--space-xxsmall) = 0.25rem ≈ 4px). That breaks visual
       * rhythm — user-observed.
       *
       * Override: set the first/last edge padding to MATCH the inter-icon
       * gap exactly (2 × xxsmall), so the gap from sidebar-top to first
       * icon, gap between adjacent icons, and gap from last icon to
       * sidebar-bottom are all the same. Applies to BOTH list containers:
       * .tools-and-extensions (vertical-tabs mode) AND .bottom-actions
       * (horizontal-tabs mode). */
      .tools-and-extensions > moz-button:not(.tools-overflow):first-of-type {
        --button-outer-padding-block-start: calc(var(--space-xxsmall) * 2) !important;
      }
      .tools-and-extensions > moz-button:not(.tools-overflow):last-of-type {
        --button-outer-padding-block-end: calc(var(--space-xxsmall) * 2) !important;
      }
      .bottom-actions > moz-button:last-of-type {
        --button-outer-padding-block-end: calc(var(--space-xxsmall) * 2) !important;
      }
      /* Expanded mode: icons switch from vertical column to horizontal row.
       * Firefox keeps justify-content:space-between from the column layout,
       * which only spreads the two GROUP containers (.tools-and-extensions
       * and .bottom-actions) — individual icons stay bunched. Override to
       * space-evenly so icons distribute across the full footer width,
       * matching the equidistant rhythm of collapsed mode. */
      :host([expanded]) .buttons-wrapper {
        justify-content: flex-start !important;
        align-items: center !important;
        gap: calc(var(--space-xxsmall) * 2) !important;
      }
      :host([expanded]) .bottom-actions {
        align-self: center !important;
      }
    `);
    (sr as ShadowRoot & { adoptedStyleSheets: CSSStyleSheet[] }).adoptedStyleSheets.push(s);
  }

  function syncUrlbarWidth(): void {
    if (!urlbar || updating) return;
    if (urlbar.hasAttribute("breakout-extend")) return;
    updating = true;
    const inset = parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue("--gjoa-sidebar-inset"),
    ) || 10;
    const w = Math.max(0, sidebarMain.getBoundingClientRect().width - inset * 2);
    urlbar.style.setProperty("--urlbar-width", w + "px");
    updating = false;
  }

  // === Symmetric-footer padding (runtime, derived from #nav-bar margin) ===
  //
  // Why this isn't a CSS constant.
  //
  // The visual goal: the inner `#sidebar-main > sidebar-main` footer
  // (the 60px bottom-pinned area) should reserve enough internal padding
  // that its content sits a symmetric distance from the bottom edge to
  // mirror the gap between the TOP edge of the chrome surface and the
  // FIRST nav-bar button. That gap is created by Firefox's #nav-bar
  // top margin — currently 6px on this build, so the symmetric footer
  // padding is `2 * 6 - 1 = 11px` (the -1 is XUL toolbarbutton internal
  // padding fudge, same -1 already used in #nav-bar's horizontal inset
  // rule).
  //
  // Why we can't write `padding-bottom: 11px`. The 6px top margin on
  // #nav-bar is owned by Firefox / its UA + theme cascade — gjoa
  // tries to set `margin: 6px 0 !important` but in practice the live
  // computed value is what Firefox decides, not what we declare, and a
  // future Firefox version (or a different theme) could ship 4px or
  // 8px. Hardcoding 11px would silently desynchronize the moment that
  // happens; the chrome would render slightly off-balance and we'd
  // never notice unless we were specifically inspecting it.
  //
  // The fix: measure `#nav-bar`'s actual rendered marginTop at runtime
  // via `getComputedStyle()`, write `2 * marginTop - 1` into the
  // `--gjoa-symmetric-footer` CSS variable on `:root`, and let the CSS
  // rule on `#sidebar-main > sidebar-main` consume it. Re-run on init
  // and window resize. Self-correcting against whatever Firefox decides
  // — including future upgrades — without us noticing.
  // Walk light DOM + shadow roots collecting visible icon-like elements
  // (img / svg / moz-icon / .toolbarbutton-icon / .button-icon).
  function collectIcons(scope: Node, hits: DOMRect[]): void {
    const sr = (scope as HTMLElement & { shadowRoot?: ShadowRoot | null }).shadowRoot;
    if (sr) collectIcons(sr, hits);
    const kids = (scope as Element).children;
    if (!kids) return;
    for (const child of kids) {
      const tag = child.tagName.toLowerCase();
      const cls = child.classList;
      const isIcon =
        tag === "img" || tag === "svg" || tag === "moz-icon" ||
        cls.contains("toolbarbutton-icon") || cls.contains("button-icon");
      if (isIcon) {
        const r = child.getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && r.top >= 0) hits.push(r);
      }
      collectIcons(child, hits);
    }
  }

  // One pass of the feedback loop. Measure icon-edge gaps (NOT container
  // edges — containers have internal padding that throws this off), then
  // correct the CSS var by the delta. If pad maps 1:1 to bottomGap (it
  // does, since --gjoa-symmetric-footer drives padding-bottom on the
  // footer container), one pass converges; we loop a few RAFs for safety
  // against transient layout (web-component first paint, etc.).
  function syncSymmetricFooterOnce(): boolean {
    const sidebarMainEl = document.getElementById("sidebar-main");
    if (!sidebarMainEl) return true;
    const navBar = sidebarMainEl.querySelector<HTMLElement>("#nav-bar");
    const footer = sidebarMainEl.querySelector<HTMLElement>(":scope > sidebar-main");
    if (!navBar || !footer) return true;

    const topHits: DOMRect[] = [];
    const bottomHits: DOMRect[] = [];
    collectIcons(navBar, topHits);
    collectIcons(footer, bottomHits);
    if (!topHits.length || !bottomHits.length) return true;
    topHits.sort((a, b) => a.top - b.top);
    bottomHits.sort((a, b) => a.bottom - b.bottom);
    const topIcon = topHits[0]!;
    const bottomIcon = bottomHits[bottomHits.length - 1]!;

    const sidebarRect = sidebarMainEl.getBoundingClientRect();
    const topGap = topIcon.top - sidebarRect.top;
    const bottomGap = sidebarRect.bottom - bottomIcon.bottom;
    // Target: bottomGap = topGap + BOTTOM_OFFSET. Bottom icons sit
    // `BOTTOM_OFFSET` px further from the sidebar's bottom than the top
    // icons sit from the top. Keeps top icons tight to the top edge
    // (user-pref, 2026-05-28) without cramping the bottom row.
    const BOTTOM_OFFSET = 4;
    const delta = topGap + BOTTOM_OFFSET - bottomGap;
    if (Math.abs(delta) < 0.5) {
      log(`symfooter:converged topGap=${topGap.toFixed(1)} bottomGap=${bottomGap.toFixed(1)} target=${(topGap + BOTTOM_OFFSET).toFixed(1)}`);
      return true;
    }

    const currentVar = parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue("--gjoa-symmetric-footer"),
    ) || 0;
    // The CSS var drives padding-top on `#sidebar-main > sidebar-main`,
    // which pushes the inner content DOWN. Increasing var shrinks
    // bottomGap. So to make bottomGap == topGap, change var by -delta.
    //
    // Damping factor 0.6 because the inner Lit web component may be
    // center-aligned (response = 0.5x) or top-aligned (response = 1x).
    // 0.6 converges fast in either case without oscillating.
    //
    // No upper clamp now — wrapper is auto-height (flex: 0 0 auto), so
    // padding-top can grow as much as needed without clipping content.
    const next = Math.max(0, Math.round(currentVar - delta * 0.6));
    document.documentElement.style.setProperty("--gjoa-symmetric-footer", next + "px");
    log(`symfooter:pass topGap=${topGap.toFixed(1)} bottomGap=${bottomGap.toFixed(1)} var=${currentVar}→${next}`);
    return false;
  }

  function syncSymmetricFooter(): void {
    // Spread 30 passes over 1.5s via setTimeout. Damping 0.6 converges in
    // ~5 passes once icons are measurable; the rest are noops at <0.5px
    // delta. setTimeout (not RAF chain) is robust against late web-
    // component hydration — the Lit `<sidebar-main>` shadow DOM may not
    // render moz-button icons in the first few frames after browser
    // start, so an early RAF chain would find no icons and stop.
    for (let i = 0; i < 30; i++) {
      setTimeout(syncSymmetricFooterOnce, i * 50);
    }
  }

  function expand(): void {
    if (urlbarToolbar) return;
    log("expand");
    if (sidebarMainElement) sidebarMain.insertBefore(navigatorToolbox, sidebarMainElement);

    // The urlbar breakout requires this.closest("toolbar") to return a
    // <toolbar> (UrlbarInput.mjs:487). Wrap it in a new toolbar.
    const tb = (document as Document & { createXULElement(t: string): HTMLElement }).createXULElement("toolbar");
    tb.id = "gjoa-urlbar-toolbar";
    tb.classList.add("browser-toolbar");
    tb.appendChild(urlbarContainer);
    navBar.after(tb);
    urlbarToolbar = tb;

    if (urlbar) {
      resizeObs = new ResizeObserver(syncUrlbarWidth);
      resizeObs.observe(sidebarMain);
      mutationObs = new MutationObserver(syncUrlbarWidth);
      mutationObs.observe(urlbar, {
        attributes: true,
        attributeFilter: ["style"],
      });
    }
  }

  function collapse(): void {
    if (!urlbarToolbar) return;
    log("collapse");
    resizeObs?.disconnect();
    mutationObs?.disconnect();
    resizeObs = null;
    mutationObs = null;

    if (urlbarNext && urlbarNext.parentNode === urlbarParent) {
      urlbarParent!.insertBefore(urlbarContainer, urlbarNext);
    } else {
      urlbarParent!.appendChild(urlbarContainer);
    }

    urlbarToolbar.remove();
    urlbarToolbar = null;

    // Ensure correct order: urlbar-container → spring2 → unified-extensions-button
    const spring2 = document.getElementById("customizableui-special-spring2");
    const extBtn = document.getElementById("unified-extensions-button");
    if (spring2) urlbarContainer.after(spring2);
    if (spring2 && extBtn) spring2.after(extBtn);

    if (toolboxNext && toolboxNext.parentNode === toolboxParent) {
      toolboxParent!.insertBefore(navigatorToolbox, toolboxNext);
    } else {
      toolboxParent!.appendChild(navigatorToolbox);
    }
  }

  // Context-menu fix — sidebar-main's LitElement intercepts contextmenu
  // events. Only block propagation when the toolbox is actually inside
  // the sidebar.
  function onContextMenu(e: Event): void {
    if (navigatorToolbox.parentNode === sidebarMain) {
      e.stopPropagation();
    }
  }
  navigatorToolbox.addEventListener("contextmenu", onContextMenu);

  // Initial layout state.
  injectSidebarShadowOverrides();
  if (sidebarMain.hasAttribute("sidebar-launcher-expanded")) expand();

  // Symmetric footer — multi-pass feedback loop driven by:
  //   - initial layout settle (30 timeouts over 1.5s in syncSymmetricFooter)
  //   - window resize
  //   - sidebar size change (ResizeObserver)
  //   - expand/collapse attribute flip (handled below)
  syncSymmetricFooter();
  window.addEventListener("resize", syncSymmetricFooter);
  const sidebarMainEl = document.getElementById("sidebar-main");
  const symResizeObs = new ResizeObserver(syncSymmetricFooter);
  if (sidebarMainEl) symResizeObs.observe(sidebarMainEl);

  // Watch for expand/collapse attribute changes.
  const expandObserver = new MutationObserver(() => {
    const expanded = sidebarMain.hasAttribute("sidebar-launcher-expanded");
    if (expanded && !urlbarToolbar) expand();
    else if (!expanded && urlbarToolbar) collapse();
    // Footer layout changes (horizontal ↔ vertical-stack) when this flips.
    syncSymmetricFooter();
  });
  expandObserver.observe(sidebarMain, {
    attributes: true,
    attributeFilter: ["sidebar-launcher-expanded"],
  });

  // --- Width pref ---
  const defaultWidth = Services.prefs.getIntPref(WIDTH_PREF, 300);
  if (sidebarMain.hasAttribute("sidebar-launcher-expanded")) {
    sidebarMain.style.width = defaultWidth + "px";
  }

  const widthObs = new ResizeObserver(() => {
    if (!sidebarMain.hasAttribute("sidebar-launcher-expanded")) return;
    const w = Math.round(sidebarMain.getBoundingClientRect().width);
    if (w > 0) {
      try { Services.prefs.setIntPref(WIDTH_PREF, w); } catch {}
    }
  });
  widthObs.observe(sidebarMain);

  function destroy(): void {
    expandObserver.disconnect();
    widthObs.disconnect();
    symResizeObs.disconnect();
    resizeObs?.disconnect();
    mutationObs?.disconnect();
    navigatorToolbox.removeEventListener("contextmenu", onContextMenu);
    window.removeEventListener("resize", syncSymmetricFooter);
  }

  return {
    isExpanded: () => urlbarToolbar !== null,
    destroy,
  };
}
