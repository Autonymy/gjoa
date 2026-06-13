// Verify the gjoa sidebar's top/bottom icon Y-deltas are symmetric.
//
// Goal (2026-05-27 user spec): the ICONS of the bottom sidebar buttons
// must sit the same visual distance from #sidebar-main's BOTTOM edge as
// the TOP nav-bar button icons sit from #sidebar-main's TOP edge.
//
// "Icons" means the actual rendered glyph (img/svg/.toolbarbutton-icon),
// NOT the toolbarbutton/moz-button container — containers have their
// own padding which used to silently throw the measurement off.
//
// The runtime adjuster lives in src/drawer/layout.ts::syncSymmetricFooter.
// It writes --gjoa-symmetric-footer; CSS consumes that as padding-bottom
// on `#sidebar-main > sidebar-main`.

import type { IntegrationTest } from "../../tools/test-driver/runner.ts";

// Walk light + shadow DOM looking for visible icon-like elements.
// Returns the topmost (top=true) or bottommost (top=false) icon found.
const probe = `
  function walk(node, hits) {
    if (!node) return;
    // Recurse into shadow roots.
    if (node.shadowRoot) walk(node.shadowRoot, hits);
    const kids = node.children || node.childNodes || [];
    for (const child of kids) {
      const tag = (child.tagName || "").toLowerCase();
      const cls = child.classList;
      const isIcon =
        tag === "img" || tag === "svg" || tag === "moz-icon" ||
        (cls && (cls.contains("toolbarbutton-icon") || cls.contains("button-icon")));
      if (isIcon) {
        const r = child.getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && r.top >= 0) {
          hits.push({
            tag,
            id: child.id || (child.parentElement && child.parentElement.id) || null,
            top: r.top, bottom: r.bottom, left: r.left, width: r.width, height: r.height,
          });
        }
      }
      walk(child, hits);
    }
  }
  const sidebarMain = document.getElementById("sidebar-main");
  if (!sidebarMain) return { error: "no #sidebar-main" };
  const sidebarRect = sidebarMain.getBoundingClientRect();
  const navBar = sidebarMain.querySelector("#nav-bar");
  const footerWebComponent = sidebarMain.querySelector(":scope > sidebar-main");
  const topHits = [];
  const bottomHits = [];
  if (navBar) walk(navBar, topHits);
  if (footerWebComponent) walk(footerWebComponent, bottomHits);
  topHits.sort((a, b) => a.top - b.top);
  bottomHits.sort((a, b) => a.bottom - b.bottom);
  return {
    sidebar: {
      top: sidebarRect.top, bottom: sidebarRect.bottom,
      height: sidebarRect.height, width: sidebarRect.width,
    },
    topIcon: topHits[0] || null,
    bottomIcon: bottomHits.length ? bottomHits[bottomHits.length - 1] : null,
    topCount: topHits.length,
    bottomCount: bottomHits.length,
    cssVar: getComputedStyle(document.documentElement).getPropertyValue("--gjoa-symmetric-footer"),
  };
`;

interface IconRect {
  tag: string;
  id: string | null;
  top: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
}

interface ProbeResult {
  error?: string;
  sidebar?: { top: number; bottom: number; height: number; width: number };
  topIcon?: IconRect | null;
  bottomIcon?: IconRect | null;
  topCount?: number;
  bottomCount?: number;
  cssVar?: string;
}

const TOLERANCE_PX = 1;

const tests: IntegrationTest[] = [
  {
    name: "sidebar — top/bottom icon Y-deltas symmetric within ±1px",
    async run(mn) {
      // layout.ts schedules 30 setTimeout passes over 1.5s for the
      // feedback loop. Wait at least that long. Poll for convergence
      // up to 3s in case shadow DOM hydration was slow.
      const deadline = Date.now() + 3000;
      let r: ProbeResult = {} as ProbeResult;
      while (Date.now() < deadline) {
        await new Promise((res) => setTimeout(res, 200));
        r = await mn.executeScript<ProbeResult>(probe);
        if (r.topIcon && r.bottomIcon && r.sidebar) {
          const tg = r.topIcon.top - r.sidebar.top;
          const bg = r.sidebar.bottom - r.bottomIcon.bottom;
          if (Math.abs(tg - bg) <= TOLERANCE_PX) break;
        }
      }
      if (r.error) throw new Error("probe error: " + r.error);
      if (!r.sidebar) throw new Error("probe returned no sidebar rect");
      if (!r.topIcon) {
        throw new Error(
          `No top icon found in #sidebar-main #nav-bar (searched ${r.topCount} candidates). ` +
          `Result: ${JSON.stringify(r, null, 2)}`,
        );
      }
      if (!r.bottomIcon) {
        throw new Error(
          `No bottom icon found in #sidebar-main > sidebar-main (searched ${r.bottomCount} candidates). ` +
          `Result: ${JSON.stringify(r, null, 2)}`,
        );
      }
      const topGap = r.topIcon.top - r.sidebar.top;
      const bottomGap = r.sidebar.bottom - r.bottomIcon.bottom;
      // src/drawer/layout.ts targets `bottomGap = topGap + BOTTOM_OFFSET`
      // (default 4px). Bottom icons sit further from edge than top icons —
      // user 2026-05-28 preference: keep top tight to the top edge, give
      // the bottom row a little extra breathing room.
      const BOTTOM_OFFSET = 4;
      const delta = Math.abs(bottomGap - (topGap + BOTTOM_OFFSET));
      if (delta > TOLERANCE_PX) {
        throw new Error(
          `Asymmetric icon Y-deltas off target: topGap=${topGap.toFixed(2)}px ` +
          `bottomGap=${bottomGap.toFixed(2)}px (expected bottom = top+${BOTTOM_OFFSET}, diff=${delta.toFixed(2)}px, tolerance ±${TOLERANCE_PX}).\n` +
          `--gjoa-symmetric-footer=${r.cssVar}\n` +
          `topIcon: ${JSON.stringify(r.topIcon)}\n` +
          `bottomIcon: ${JSON.stringify(r.bottomIcon)}\n` +
          `sidebar: ${JSON.stringify(r.sidebar)}`,
        );
      }
      // Guard against negative / zero-gap regression (icons jammed
      // outside the sidebar). The actual target gap is small (~6-12px)
      // per 2026-05-28 user spec: tight to the top edge, not "spacious".
      if (topGap < 2) {
        throw new Error(
          `Icons too close to top edge: topGap=${topGap.toFixed(1)}px (expected ≥2).`,
        );
      }
    },
  },
];

export default tests;
