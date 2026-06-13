// Verify the gjoa nav-bar layout per 2026-05-27 user spec:
//   [☰ hamburger][□ taskbar-tabs-favicon]  ←GAP→  [← → ↻ 🧩]
//
// Hamburger + sidebar-toggle (taskbar-tabs-favicon in 151 vertical+revamp)
// pin LEFT via CSS `order`. nav-bar-customization-target (back / forward
// / refresh / extensions) pins RIGHT via `margin-inline-start: auto`.
//
// Asserts visual left-to-right ordering AND that there's a visible gap
// between the left group and the right group.

import type { IntegrationTest } from "../../tools/test-driver/runner.ts";

const layoutCheck = `
  const ids = [
    "PanelUI-button",
    "taskbar-tabs-favicon",
    "nav-bar-customization-target",
    "back-button",
    "forward-button",
    "stop-reload-button",
    "unified-extensions-button",
  ];
  const result = {};
  for (const id of ids) {
    const el = document.getElementById(id);
    if (!el) { result[id] = null; continue; }
    const r = el.getBoundingClientRect();
    result[id] = { left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width) };
  }
  const navBar = document.getElementById("nav-bar");
  result["__nav-bar__"] = navBar ? {
    left: Math.round(navBar.getBoundingClientRect().left),
    right: Math.round(navBar.getBoundingClientRect().right),
  } : null;
  return result;
`;

const allIconYCheck = `
  // Collect every visible icon in nav-bar (any depth — including inside
  // customization-target). Report each by id+ancestry+top-position so a
  // failure can pinpoint the misaligned widget.
  const navBar = document.getElementById("nav-bar");
  if (!navBar) return { error: "no #nav-bar" };
  const icons = navBar.querySelectorAll("toolbarbutton .toolbarbutton-icon, toolbarbutton image");
  const hits = [];
  for (const ic of icons) {
    const r = ic.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    // Walk up to first parent with an id.
    let p = ic.parentElement;
    let id = "";
    while (p && p !== navBar) {
      if (p.id) { id = p.id; break; }
      p = p.parentElement;
    }
    hits.push({ id, top: r.top, bottom: r.bottom, left: r.left });
  }
  return { hits };
`;

const tests: IntegrationTest[] = [
  {
    name: "nav-bar — gjoa-sidebar-button (if present) is direct child of nav-bar, adjacent to PanelUI-button",
    async run(mn) {
      const r = await mn.executeScript<{
        gjoaBtn: { parentId: string; left: number; right: number; top: number } | null;
        panelUI: { left: number; right: number; top: number };
      }>(`
        const navBar = document.getElementById("nav-bar");
        const pui = document.getElementById("PanelUI-button");
        if (!pui) throw new Error("no PanelUI-button");
        const gj = document.getElementById("gjoa-sidebar-button");
        const puiR = pui.getBoundingClientRect();
        const gjR = gj ? gj.getBoundingClientRect() : null;
        return {
          gjoaBtn: gj ? {
            parentId: gj.parentElement ? (gj.parentElement.id || gj.parentElement.tagName) : "",
            left: gjR.left, right: gjR.right, top: gjR.top,
          } : null,
          panelUI: { left: puiR.left, right: puiR.right, top: puiR.top },
        };
      `);
      // If gjoa-sidebar-button doesn't exist on this profile (no native
      // #sidebar-button to swap), this assertion is moot — skip.
      if (!r.gjoaBtn) return;
      if (r.gjoaBtn.parentId !== "nav-bar") {
        throw new Error(
          `#gjoa-sidebar-button must be a direct child of #nav-bar, ` +
          `found in: "${r.gjoaBtn.parentId}". ` +
          `(layout-reparent in src/drawer/sidebar-button.ts didn't run)`,
        );
      }
      // Adjacent to hamburger: gjoa-btn.left should be within ~50px of
      // PanelUI's right edge (allowing for normal toolbar gap).
      const gap = r.gjoaBtn.left - r.panelUI.right;
      if (gap < 0 || gap > 50) {
        throw new Error(
          `#gjoa-sidebar-button not adjacent to hamburger: ` +
          `PanelUI.right=${r.panelUI.right} gjoaBtn.left=${r.gjoaBtn.left} gap=${gap}px ` +
          `(expected 0-50px).`,
        );
      }
    },
  },
  {
    name: "nav-bar — all visible top-row icons share the same vertical CENTER (±2px)",
    async run(mn) {
      const r = await mn.executeScript<{ error?: string; hits?: Array<{ id: string; top: number; bottom: number; left: number }> }>(
        allIconYCheck,
      );
      if (r.error) throw new Error(r.error);
      if (!r.hits || r.hits.length < 2) return; // need ≥2 icons to compare
      // Use center-Y, not top-Y. Icons can have different intrinsic sizes
      // (hamburger 16px vs back-button 32px) but visually align by CENTER.
      // Reference: PanelUI-button (or PanelUI-menu-button) — the hamburger.
      const center = (h: { top: number; bottom: number }) => (h.top + h.bottom) / 2;
      const ref = r.hits.find((h) => h.id === "PanelUI-button" || h.id === "PanelUI-menu-button") ?? r.hits[0]!;
      const refC = center(ref);
      const TOL = 2;
      for (const h of r.hits) {
        const c = center(h);
        if (Math.abs(c - refC) > TOL) {
          throw new Error(
            `Top-row icon center misaligned: id="${h.id}" center=${c.toFixed(1)} ` +
            `vs ref="${ref.id}" center=${refC.toFixed(1)} ` +
            `(diff=${(c - refC).toFixed(1)}px, tolerance ±${TOL}).\n` +
            `All hits: ${JSON.stringify(r.hits, null, 2)}`,
          );
        }
      }
    },
  },
  {
    name: "nav-bar — [hamburger][sidebar][ext] left-anchored, [back forward refresh] right-anchored",
    async run(mn) {
      const rects = await mn.executeScript<Record<string, { left: number; right: number; width: number } | null>>(
        layoutCheck,
      );

      const hamburger = rects["PanelUI-button"];
      const navBar = rects["__nav-bar__"];
      const ext = rects["unified-extensions-button"];
      const back = rects["back-button"];
      if (!hamburger) throw new Error("PanelUI-button not found. rects: " + JSON.stringify(rects, null, 2));
      if (!navBar) throw new Error("#nav-bar not found");
      if (!ext) throw new Error("unified-extensions-button not found. rects: " + JSON.stringify(rects, null, 2));
      if (!back) throw new Error("back-button not found. rects: " + JSON.stringify(rects, null, 2));

      // Hamburger at or very near LEFT edge of nav-bar.
      if (hamburger.left > navBar.left + 80) {
        throw new Error(
          `Hamburger not left-anchored: nav-bar.left=${navBar.left} hamburger.left=${hamburger.left}.\n` +
          JSON.stringify(rects, null, 2),
        );
      }

      // Extensions should be in the LEFT group (within ~150px of hamburger).
      if (ext.left > hamburger.right + 150) {
        throw new Error(
          `Extensions not left-anchored alongside hamburger: hamburger.right=${hamburger.right} ` +
          `ext.left=${ext.left} (gap=${ext.left - hamburger.right}px, expected ≤150).\n` +
          JSON.stringify(rects, null, 2),
        );
      }

      // Back-button should be RIGHT of extensions (the right group).
      if (back.left <= ext.right) {
        throw new Error(
          `back-button must be RIGHT of extensions in expanded layout: ` +
          `ext.right=${ext.right} back.left=${back.left}.\n` +
          JSON.stringify(rects, null, 2),
        );
      }

      // The right group (back/forward/refresh) must be ACTUALLY anchored
      // to the right of nav-bar. Use the right-most of the three (refresh
      // if present, else forward, else back) and assert its right edge is
      // within 60px of nav-bar's right edge.
      const refresh = rects["stop-reload-button"];
      const forward = rects["forward-button"]!;
      const rightmost = refresh ?? forward ?? back;
      const distFromRight = navBar.right - rightmost.right;
      if (distFromRight > 60) {
        throw new Error(
          `Right group not anchored to right edge: rightmost-button.right=${rightmost.right} ` +
          `nav-bar.right=${navBar.right} distance=${distFromRight}px (expected ≤60).\n` +
          JSON.stringify(rects, null, 2),
        );
      }

      // And there should be a visible gap between extensions and back-button.
      const gap = back.left - ext.right;
      if (gap < 40) {
        throw new Error(
          `Gap between left group (ext) and right group (back) too small: ` +
          `ext.right=${ext.right} back.left=${back.left} gap=${gap}px (expected ≥40).\n` +
          JSON.stringify(rects, null, 2),
        );
      }
    },
  },
];

export default tests;
