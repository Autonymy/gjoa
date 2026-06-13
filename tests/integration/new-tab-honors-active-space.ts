// Bug fix regression: when the user is on Space B, opening a new tab
// (Ctrl+T, +button, etc.) must land in B — NOT in the space of the
// currently-selected tab's owner, NOT in the default space.
//
// Failure mode pre-fix: Firefox auto-sets tab.owner to the previously-
// selected tab on Ctrl+T. The previously-selected tab was usually in
// a different space than the user just switched to. Our onTabOpen
// handler inherited from owner, so new tabs went to the OWNER's space,
// not the active space. Sidebar showed nothing in the active space and
// the tab silently appeared in the owner's space.

import type { IntegrationTest } from "../../tools/test-driver/runner.ts";
import type { MarionetteClient } from "../../tools/test-driver/marionette.ts";

async function waitFor(
  mn: MarionetteClient,
  scriptReturningBool: string,
  timeoutMs = 1500,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown = null;
  while (Date.now() < deadline) {
    try {
      const ok = await mn.executeScript<boolean>(scriptReturningBool);
      if (ok) return;
    } catch (e) { lastErr = e; }
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(
    `timed out: ${scriptReturningBool.slice(0, 200)}` +
    (lastErr ? ` (last: ${(lastErr as Error).message})` : ""),
  );
}

const tests: IntegrationTest[] = [
  {
    name: "new-tab-honors-active-space — Ctrl+T while in Workspace places tab in Workspace, NOT Main, even when owner is a Main tab",
    async run(mn) {
      await waitFor(mn, `return !!window.Spaces;`);
      // Clean slate.
      await mn.executeScript<void>(`
        const main = window.Spaces.list().find(s => s.name === "Main") || window.Spaces.list()[0];
        window.Spaces.setActive(main.id);
        for (const s of [...window.Spaces.list()]) {
          if (s.id !== main.id) window.Spaces.delete(s.id);
        }
      `);

      // Open a "anchor" tab while in Main, and assign it explicitly to Main.
      await mn.executeScript<void>(`
        const principal = Services.scriptSecurityManager.getSystemPrincipal();
        const anchor = gBrowser.addTab("https://example.com/main-anchor", { triggeringPrincipal: principal });
        anchor.setAttribute("gjoa-test-marker", "main-anchor");
        gBrowser.selectedTab = anchor;
        const main = window.Spaces.list().find(s => s.name === "Main");
        window.Spaces.assignTab(anchor, main.id);
      `);
      await waitFor(mn, `
        return [...gBrowser.tabs].some(t => t.getAttribute("gjoa-test-marker") === "main-anchor");
      `);

      // Create Workspace and switch into it. The anchor tab in Main is
      // still gBrowser.selectedTab, so a fresh Ctrl+T would set owner=anchor.
      await mn.executeScript<void>(`
        const ws = window.Spaces.create("Workspace");
        window.Spaces.setActive(ws.id);
      `);
      await waitFor(mn, `return window.Spaces.active().name === "Workspace";`);

      // Open a new tab WITH owner explicitly set to the anchor tab in Main.
      // This mimics what Firefox does on Ctrl+T (carry over previously-
      // active tab as owner).
      await mn.executeScript<void>(`
        const principal = Services.scriptSecurityManager.getSystemPrincipal();
        const anchor = [...gBrowser.tabs].find(t => t.getAttribute("gjoa-test-marker") === "main-anchor");
        const newTab = gBrowser.addTab("https://example.com/in-workspace", {
          triggeringPrincipal: principal,
          ownerTab: anchor,
        });
        newTab.setAttribute("gjoa-test-marker", "new-in-workspace");
      `);
      // Tab must exist.
      await waitFor(mn, `
        return [...gBrowser.tabs].some(t => t.getAttribute("gjoa-test-marker") === "new-in-workspace");
      `);

      // CRITICAL: the new tab's space must be Workspace, NOT Main.
      const sp = await mn.executeScript<{ space: string; active: string; main: string }>(`
        const newTab = [...gBrowser.tabs].find(t => t.getAttribute("gjoa-test-marker") === "new-in-workspace");
        const ws = window.Spaces.list().find(s => s.name === "Workspace");
        const main = window.Spaces.list().find(s => s.name === "Main");
        return {
          space: window.Spaces.spaceOf(newTab),
          active: ws.id,
          main: main.id,
        };
      `);
      if (sp.space === sp.main) {
        throw new Error(`new tab went to Main instead of Workspace. (Owner-inheritance bug.) sp=${JSON.stringify(sp)}`);
      }
      if (sp.space !== sp.active) {
        throw new Error(`new tab not in active Workspace. sp=${JSON.stringify(sp)}`);
      }

      // And the row must be visible in the sidebar while Workspace is active.
      const visibleInWorkspace = await mn.executeScript<boolean>(`
        return [...document.querySelectorAll("#gjoa-tab-panel .gjoa-tab-row")]
          .filter(r => !r.hidden)
          .some(r => r._tab && r._tab.getAttribute("gjoa-test-marker") === "new-in-workspace");
      `);
      if (!visibleInWorkspace) {
        throw new Error("new tab is in Workspace logically but its row is hidden — visibility filter broken");
      }
    },
  },

  {
    name: "new-tab-honors-active-space — Ctrl+T with NO owner still goes to active space",
    async run(mn) {
      await waitFor(mn, `return !!window.Spaces;`);
      // Clean slate.
      await mn.executeScript<void>(`
        const main = window.Spaces.list().find(s => s.name === "Main") || window.Spaces.list()[0];
        window.Spaces.setActive(main.id);
        for (const s of [...window.Spaces.list()]) {
          if (s.id !== main.id) window.Spaces.delete(s.id);
        }
        const ws = window.Spaces.create("Work2");
        window.Spaces.setActive(ws.id);
      `);
      await waitFor(mn, `return window.Spaces.active().name === "Work2";`);
      await mn.executeScript<void>(`
        const principal = Services.scriptSecurityManager.getSystemPrincipal();
        const t = gBrowser.addTab("https://example.com/no-owner", { triggeringPrincipal: principal });
        t.setAttribute("gjoa-test-marker", "no-owner");
      `);
      await waitFor(mn, `
        return [...gBrowser.tabs].some(t => t.getAttribute("gjoa-test-marker") === "no-owner");
      `);
      const sp = await mn.executeScript<{ inActive: boolean; activeName: string }>(`
        const t = [...gBrowser.tabs].find(t => t.getAttribute("gjoa-test-marker") === "no-owner");
        const ws = window.Spaces.active();
        return { inActive: window.Spaces.spaceOf(t) === ws.id, activeName: ws.name };
      `);
      if (!sp.inActive) throw new Error(`no-owner tab not in active space ${sp.activeName}`);
    },
  },
];

export default tests;
