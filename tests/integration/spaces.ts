// Integration tests for Spaces (workspaces).
//
// Drives the live `window.Spaces` API exposed by tabs/index.ts. Validates:
//   - default space exists at startup
//   - new tabs land in the active space
//   - switching spaces hides tabs of other spaces
//   - assignTab moves a tab between spaces
//   - delete + orphan reparenting

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
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(
    `timed out waiting for: ${scriptReturningBool.slice(0, 160)}` +
    (lastErr ? ` (last error: ${(lastErr as Error).message})` : ""),
  );
}

/** Count tab rows actually visible (not [hidden]) in the sidebar. */
function visibleTabRows(): string {
  return `
    return [...document.querySelectorAll("#gjoa-tab-panel .gjoa-tab-row, #gjoa-tab-panel-pinned .gjoa-tab-row")]
      .filter(r => !r.hidden).length;
  `;
}

const tests: IntegrationTest[] = [
  {
    name: "Spaces — window.Spaces is exposed with a default 'Main' space",
    async run(mn) {
      await waitFor(mn, `return !!window.Spaces && window.Spaces.list().length >= 1;`);
      const list = await mn.executeScript<Array<{ name: string }>>(
        `return window.Spaces.list().map(s => ({ name: s.name }));`,
      );
      if (!list.length || list[0]!.name !== "Main") {
        throw new Error(`expected default 'Main', got ${JSON.stringify(list)}`);
      }
      const activeName = await mn.executeScript<string>(
        `return window.Spaces.active().name;`,
      );
      if (activeName !== "Main") {
        throw new Error(`expected active='Main', got '${activeName}'`);
      }
    },
  },

  {
    name: "Spaces — creating + switching hides original tabs and shows new-space tabs",
    async run(mn) {
      // 0. Baseline: visible tabs in default space.
      await waitFor(mn, `return !!window.Spaces;`);
      const before = await mn.executeScript<number>(visibleTabRows());

      // 1. Create a "Work" space and switch to it.
      await mn.executeScript<void>(`
        const s = window.Spaces.create("Work");
        window.Spaces.setActive(s.id);
      `);
      await waitFor(mn, `return window.Spaces.active().name === "Work";`);

      // 2. All previously-visible tabs should now be hidden (they're in Main).
      await waitFor(mn, `${visibleTabRows().replace("return ", "const c = ")}; return c === 0;`);
      const afterSwitch = await mn.executeScript<number>(visibleTabRows());
      if (afterSwitch !== 0) {
        throw new Error(`after switching to Work, expected 0 visible tabs, got ${afterSwitch} (baseline ${before})`);
      }

      // 3. Open a tab; it should land in Work and be visible.
      await mn.executeScript<void>(`
        gBrowser.addTab("https://example.com/work-tab", {
          triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
        });
      `);
      // Wait for the row to render + receive an assignment + pass the visibility filter.
      await waitFor(mn, `${visibleTabRows().replace("return ", "const c = ")}; return c >= 1;`, 8000);

      // 4. Switch back to Main; Work tab disappears, original tabs return.
      await mn.executeScript<void>(`
        const main = window.Spaces.list().find(s => s.name === "Main");
        window.Spaces.setActive(main.id);
      `);
      await waitFor(mn, `return window.Spaces.active().name === "Main";`);
      // Original visible count is restored.
      await waitFor(mn, `${visibleTabRows().replace("return ", "const c = ")}; return c === ${before};`, 5000);
    },
  },

  {
    name: "Spaces — assignTab moves a tab between spaces (visibility follows)",
    async run(mn) {
      await waitFor(mn, `return !!window.Spaces;`);
      // Setup: ensure we have a Work space and we're on Main.
      await mn.executeScript<void>(`
        const work = window.Spaces.list().find(s => s.name === "Work")
          || window.Spaces.create("Work");
        window.Spaces._testWorkId = work.id;
        const main = window.Spaces.list().find(s => s.name === "Main");
        window.Spaces.setActive(main.id);
      `);

      // Open a fresh tab on Main, then move it to Work.
      await mn.executeScript<void>(`
        const t = gBrowser.addTab("https://example.com/movable", {
          triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
        });
        window.Spaces._testMovableTab = t;
      `);
      // Tab should be visible (it's on Main).
      await waitFor(mn, `return window.Spaces._testMovableTab != null;`);
      const visBefore = await mn.executeScript<boolean>(`
        const t = window.Spaces._testMovableTab;
        return window.Spaces.isVisible(t);
      `);
      if (!visBefore) throw new Error("freshly-opened tab should be visible on Main");

      // Move to Work; should now be invisible (we're on Main).
      await mn.executeScript<void>(`
        window.Spaces.assignTab(window.Spaces._testMovableTab, window.Spaces._testWorkId);
      `);
      const visAfter = await mn.executeScript<boolean>(`
        const t = window.Spaces._testMovableTab;
        return window.Spaces.isVisible(t);
      `);
      if (visAfter) throw new Error("tab moved to Work should not be visible on Main");

      // Switch to Work, tab is visible again.
      await mn.executeScript<void>(`
        window.Spaces.setActive(window.Spaces._testWorkId);
      `);
      const visOnWork = await mn.executeScript<boolean>(`
        return window.Spaces.isVisible(window.Spaces._testMovableTab);
      `);
      if (!visOnWork) throw new Error("tab in Work should be visible while Work is active");
    },
  },

  {
    name: "Spaces — deleting an active space falls back to default; orphan tabs surface",
    async run(mn) {
      await waitFor(mn, `return !!window.Spaces;`);
      // Create + switch to a doomed space; assign a tab; delete; assert orphan visibility.
      await mn.executeScript<void>(`
        const doomed = window.Spaces.create("Doomed");
        window.Spaces.setActive(doomed.id);
        const t = gBrowser.addTab("https://example.com/orphan-test", {
          triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
        });
        window.Spaces._testOrphanTab = t;
        window.Spaces._testDoomedId = doomed.id;
      `);
      await waitFor(mn, `return window.Spaces._testOrphanTab != null;`);

      await mn.executeScript<void>(`
        window.Spaces.delete(window.Spaces._testDoomedId);
      `);

      const activeName = await mn.executeScript<string>(`return window.Spaces.active().name;`);
      if (activeName !== "Main") {
        throw new Error(`expected active=Main after deleting Doomed, got '${activeName}'`);
      }
      // Orphan tab: spaceOf must return default (active), and isVisible must be true.
      const orphanState = await mn.executeScript<{ vis: boolean; sid: string; defId: string }>(`
        const t = window.Spaces._testOrphanTab;
        const def = window.Spaces.list()[0].id;
        return { vis: window.Spaces.isVisible(t), sid: window.Spaces.spaceOf(t), defId: def };
      `);
      if (!orphanState.vis) {
        throw new Error(`orphan tab should be visible (default-fallback), state=${JSON.stringify(orphanState)}`);
      }
      if (orphanState.sid !== orphanState.defId) {
        throw new Error(`orphan should surface in default space, state=${JSON.stringify(orphanState)}`);
      }
    },
  },
];

export default tests;
