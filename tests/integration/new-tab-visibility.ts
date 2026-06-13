// Regression: new tabs must appear in the gjoa sidebar.
//
// User-reported: "when i switch tabs i don't see new tabs created in the
// sidebar". This test exercises three paths a user can hit to open a new
// tab and verifies a row appears in the sidebar for each.

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
    `timed out waiting for: ${scriptReturningBool.slice(0, 200)}` +
    (lastErr ? ` (last error: ${(lastErr as Error).message})` : ""),
  );
}

const visibleTabRows = `
  return [...document.querySelectorAll("#gjoa-tab-panel .gjoa-tab-row, #gjoa-tab-panel-pinned .gjoa-tab-row")]
    .filter(r => !r.hidden).length;
`;

const tests: IntegrationTest[] = [
  {
    name: "New tab — gBrowser.addTab() row appears in sidebar",
    async run(mn) {
      await waitFor(mn, `return !!document.querySelector("#gjoa-tab-panel");`);
      const before = await mn.executeScript<number>(visibleTabRows);
      await mn.executeScript<void>(`
        gBrowser.addTab("https://example.com/addtab", {
          triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
        });
      `);
      await waitFor(
        mn,
        `${visibleTabRows.replace("return ", "const c = ")}; return c === ${before + 1};`,
        5000,
      );
    },
  },

  {
    name: "New tab — BrowserCommands.openTab() (the + button / Ctrl+T path) row appears",
    async run(mn) {
      await waitFor(mn, `return !!document.querySelector("#gjoa-tab-panel");`);
      const before = await mn.executeScript<number>(visibleTabRows);
      // BrowserCommands.openTab() is what the native UI + button binds.
      const reachable = await mn.executeScript<boolean>(`
        return typeof BrowserCommands !== "undefined" && typeof BrowserCommands.openTab === "function";
      `);
      if (!reachable) {
        // Older Firefox builds bind elsewhere; fall back to the equivalent
        // gBrowser call so this test still reflects the user-facing path.
        await mn.executeScript<void>(`
          gBrowser.addTab("about:newtab", {
            triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
            inBackground: false,
          });
        `);
      } else {
        await mn.executeScript<void>(`BrowserCommands.openTab();`);
      }
      await waitFor(
        mn,
        `${visibleTabRows.replace("return ", "const c = ")}; return c === ${before + 1};`,
        5000,
      );
    },
  },

  {
    name: "New tab in non-default space — appears in that space, hides on switch",
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
      // Create + switch to a fresh space.
      await mn.executeScript<void>(`
        const s = window.Spaces.create("NewTabSpace");
        window.Spaces.setActive(s.id);
      `);
      // Pre-existing tabs (in Main) should be hidden now.
      await waitFor(mn, `${visibleTabRows.replace("return ", "const c = ")}; return c === 0;`);

      // Open a tab via the user-facing flow, and stash a marker attribute
      // on it so we can identify it without depending on URL resolution
      // (which can rewrite to about:neterror for unresolvable hosts).
      await mn.executeScript<void>(`
        const t = gBrowser.addTab("https://example.com/in-new-space", {
          triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
        });
        t.setAttribute("gjoa-test-marker", "in-new-space");
      `);
      // Tab should appear in this space (visible count goes from 0 → 1).
      await waitFor(mn, `${visibleTabRows.replace("return ", "const c = ")}; return c === 1;`);

      // Switching back to Main: this tab disappears.
      await mn.executeScript<void>(`
        const main = window.Spaces.list().find(s => s.name === "Main");
        window.Spaces.setActive(main.id);
      `);
      // Invariant: the marked tab is NOT in the visible row set.
      const inNewSpaceVisible = await mn.executeScript<boolean>(`
        return [...document.querySelectorAll("#gjoa-tab-panel .gjoa-tab-row")]
          .filter(r => !r.hidden)
          .some(r => r._tab && r._tab.getAttribute("gjoa-test-marker") === "in-new-space");
      `);
      if (inNewSpaceVisible) {
        throw new Error("marked tab still visible after switching to Main");
      }
    },
  },
];

export default tests;
