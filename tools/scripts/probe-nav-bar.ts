#!/usr/bin/env bun
// Diagnostic: launch gjoa, probe nav-bar layout in expanded + compact modes,
// dump rects, save screenshots. Used to verify the actual layout matches
// user's spec WITHOUT running the full integration test suite.
//
// Output:
//   /tmp/gjoa-navbar-expanded.png   (sidebar-launcher-expanded=true)
//   /tmp/gjoa-navbar-compact.png    (sidebar-launcher-expanded absent)
//   Rect dumps printed to stdout.
//
// Usage: bun tools/scripts/probe-nav-bar.ts

import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { connectMarionette } from "../test-driver/marionette.ts";
import { createProfile } from "../test-driver/profile.ts";
import { locateGjoa } from "../test-driver/gjoa-locator.ts";

const PROBE_SCRIPT = `
  const navBar = document.getElementById("nav-bar");
  const sidebarMain = document.getElementById("sidebar-main");
  const expanded = sidebarMain && sidebarMain.hasAttribute("sidebar-launcher-expanded");
  if (!navBar) return { error: "no #nav-bar" };
  const navRect = navBar.getBoundingClientRect();
  const kids = [];
  for (const ch of navBar.children) {
    const r = ch.getBoundingClientRect();
    const cs = getComputedStyle(ch);
    kids.push({
      id: ch.id || "",
      tag: ch.tagName.toLowerCase(),
      cls: ch.className || "",
      hidden: ch.hidden || cs.display === "none" || cs.visibility === "hidden",
      display: cs.display,
      order: cs.order,
      flex: cs.flex,
      left: Math.round(r.left),
      right: Math.round(r.right),
      top: Math.round(r.top),
      width: Math.round(r.width),
    });
  }
  // Also inspect customization-target's direct children.
  const ct = document.getElementById("nav-bar-customization-target");
  const ctRect = ct ? ct.getBoundingClientRect() : null;
  const ctKids = [];
  if (ct) {
    for (const ch of ct.children) {
      const r = ch.getBoundingClientRect();
      const cs = getComputedStyle(ch);
      ctKids.push({
        id: ch.id || "",
        tag: ch.tagName.toLowerCase(),
        hidden: ch.hidden || cs.display === "none" || cs.visibility === "hidden",
        display: cs.display,
        order: cs.order,
        flex: cs.flex,
        marginInlineStart: cs.marginInlineStart,
        left: Math.round(r.left),
        right: Math.round(r.right),
        width: Math.round(r.width),
      });
    }
  }
  return {
    mode: expanded ? "EXPANDED" : "COMPACT",
    navBar: { left: Math.round(navRect.left), right: Math.round(navRect.right), width: Math.round(navRect.width) },
    customizationTarget: ctRect ? {
      left: Math.round(ctRect.left), right: Math.round(ctRect.right), width: Math.round(ctRect.width),
    } : null,
    navBarChildren: kids,
    ctChildren: ctKids,
  };
`;

async function probe(label: string) {
  const r = await mn.executeScript<any>(PROBE_SCRIPT);
  console.log(`\n========== ${label} (mode=${r.mode}) ==========`);
  console.log("nav-bar:", r.navBar);
  console.log("customization-target:", r.customizationTarget);
  console.log("\nnav-bar children (left→right, visible only):");
  const visible = r.navBarChildren.filter((c: any) => !c.hidden && c.width > 0);
  visible.sort((a: any, b: any) => a.left - b.left);
  for (const c of visible) {
    console.log(`  [${String(c.left).padStart(4)}..${String(c.right).padStart(4)}] w=${String(c.width).padStart(4)} order=${c.order.padStart(3)}  ${c.id || c.tag}.${c.cls.slice(0, 30)}`);
  }
  console.log("\ncustomization-target children (visible only):");
  const ctVisible = r.ctChildren.filter((c: any) => !c.hidden && c.width > 0);
  ctVisible.sort((a: any, b: any) => a.left - b.left);
  for (const c of ctVisible) {
    console.log(`  [${String(c.left).padStart(4)}..${String(c.right).padStart(4)}] w=${String(c.width).padStart(4)} order=${c.order.padStart(3)} mIS=${c.marginInlineStart.padStart(6)}  ${c.id || c.tag}`);
  }
}

const profile = await createProfile();
const gjoaBin = locateGjoa().path;
console.log(`profile: ${profile.path}`);
console.log(`binary:  ${gjoaBin}`);

const child = spawn(gjoaBin, [
  "--profile", profile.path,
  "--marionette",
  "--headless",
  "--no-remote",
  "--remote-allow-system-access",
  "-marionette-port", "2828",
], {
  stdio: "pipe",
  env: { ...process.env, GJOA_ALLOW_INSECURE: "1" },
});
child.stdout?.resume();
child.stderr?.resume();

const mn = await connectMarionette({ port: 2828 });
await mn.newSession();
await mn.setContext("chrome");

async function diagExt(label: string) {
  const r = await mn.executeScript<any>(`
    const ext = document.getElementById("unified-extensions-button");
    const ct = document.getElementById("nav-bar-customization-target");
    const sb = document.getElementById("sidebar-main");
    if (!ext) return { error: "no ext" };
    const cs = getComputedStyle(ext);
    const ctCs = ct ? getComputedStyle(ct) : null;
    return {
      ext: {
        position: cs.position,
        right: cs.right,
        top: cs.top,
        transform: cs.transform,
        marginInlineStart: cs.marginInlineStart,
      },
      ct: ctCs ? { position: ctCs.position, display: ctCs.display } : null,
      sidebarMain: {
        present: !!sb,
        hasExpanded: sb ? sb.hasAttribute("sidebar-launcher-expanded") : null,
        hasGjoaCompact: sb ? sb.hasAttribute("data-gjoa-compact") : null,
      },
    };
  `);
  console.log(`-- ${label} computed style --`);
  console.log(JSON.stringify(r, null, 2));
}

try {
  // Default boot — should be expanded mode (test profile sets verticalTabs+revamp=true).
  await new Promise((r) => setTimeout(r, 2000));
  await probe("DEFAULT BOOT");
  await diagExt("DEFAULT");
  const shot1 = await mn.takeScreenshot();
  await writeFile("/tmp/gjoa-navbar-default.png", Buffer.from(shot1, "base64"));
  console.log("\n→ saved /tmp/gjoa-navbar-default.png");

  // Toggle to compact: remove sidebar-launcher-expanded.
  await mn.executeScript(`
    const sb = document.getElementById("sidebar-main");
    if (sb) sb.removeAttribute("sidebar-launcher-expanded");
    // Also collapse using the native API if available.
    if (window.SidebarController && typeof window.SidebarController.toggleExpanded === "function") {
      try { window.SidebarController.toggleExpanded(); } catch {}
    }
    return null;
  `);
  await new Promise((r) => setTimeout(r, 500));
  await probe("AFTER REMOVE sidebar-launcher-expanded");
  await diagExt("COMPACT");
  const shot2 = await mn.takeScreenshot();
  await writeFile("/tmp/gjoa-navbar-compact.png", Buffer.from(shot2, "base64"));
  console.log("\n→ saved /tmp/gjoa-navbar-compact.png");

  // Mimic user's setup: URL bar has a max-width so it doesn't dominate
  // the nav-bar. Then ext should be VISIBLY right of URL, just left of
  // PanelUI/sidebar-toggle. Also force dark color-scheme so ext fill
  // resolves to light on dark bg (test profile defaults to light fill).
  await mn.executeScript(`
    document.documentElement.style.colorScheme = "dark";
    const url = document.getElementById("urlbar-container");
    if (url) url.style.maxWidth = "700px";
    return null;
  `);
  await new Promise((r) => setTimeout(r, 300));
  await probe("WITH 700px URL CAP");
  await diagExt("URL_CAP");
  const shot4 = await mn.takeScreenshot();
  await writeFile("/tmp/gjoa-navbar-urlcap.png", Buffer.from(shot4, "base64"));
  console.log("\n→ saved /tmp/gjoa-navbar-urlcap.png");

  // Try horizontal-tabs mode — flip the pref + reload window via tabsLayout API.
  await mn.executeScript(`
    Services.prefs.setBoolPref("sidebar.verticalTabs", false);
    return null;
  `);
  await new Promise((r) => setTimeout(r, 1000));
  await probe("HORIZONTAL TABS (verticalTabs=false)");
  const shot3 = await mn.takeScreenshot();
  await writeFile("/tmp/gjoa-navbar-horizontal.png", Buffer.from(shot3, "base64"));
  console.log("\n→ saved /tmp/gjoa-navbar-horizontal.png");

  // Also dump ALL toolbar children including hidden ones — useful to see what's
  // there but display:none'd.
  console.log("\n========== ALL NAV-BAR CHILDREN (incl. hidden) ==========");
  const all = await mn.executeScript<any>(`
    const navBar = document.getElementById("nav-bar");
    const ct = document.getElementById("nav-bar-customization-target");
    const out = { navBarChildren: [], ctChildren: [] };
    for (const ch of navBar.children) {
      const cs = getComputedStyle(ch);
      out.navBarChildren.push({ id: ch.id || ch.tagName, hidden: ch.hidden, display: cs.display, order: cs.order });
    }
    if (ct) for (const ch of ct.children) {
      const cs = getComputedStyle(ch);
      out.ctChildren.push({ id: ch.id || ch.tagName, hidden: ch.hidden, display: cs.display, order: cs.order });
    }
    return out;
  `);
  console.log("nav-bar:");
  for (const c of all.navBarChildren) {
    console.log(`  ${c.hidden || c.display === "none" ? "[hidden]" : "[show]  "}  ord=${c.order}  ${c.id}`);
  }
  console.log("customization-target:");
  for (const c of all.ctChildren) {
    console.log(`  ${c.hidden || c.display === "none" ? "[hidden]" : "[show]  "}  ord=${c.order}  ${c.id}`);
  }

} finally {
  try { await mn.deleteSession(); } catch {}
  mn.disconnect();
  child.kill("SIGTERM");
  await profile.cleanup();
}
