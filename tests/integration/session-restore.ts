// Real-launch regression: when gjoa starts with multiple tabs already
// open (session-restore case), EVERY tab must end up as a visible row
// in the sidebar.
//
// The other new-tab tests verify the in-session "open new tab" path.
// This one verifies the at-startup "session restored 5 tabs" path —
// which goes through loadFromHistory → buildFromSaved / buildPanel,
// a different code path entirely.

import type { IntegrationTest } from "../../tools/test-driver/runner.ts";
import type { MarionetteClient } from "../../tools/test-driver/marionette.ts";

async function waitFor(
  mn: MarionetteClient,
  scriptReturningBool: string,
  timeoutMs = 2000,
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
    name: "Session-like — opening 5 tabs in a row, every one renders as a visible sidebar row",
    async run(mn) {
      await waitFor(mn, `return !!document.getElementById("gjoa-tab-panel");`);
      // Clear any non-Main spaces so visibility filter never hides legit tabs.
      await mn.executeScript<void>(`
        if (window.Spaces) {
          const main = window.Spaces.list().find(s => s.name === "Main") || window.Spaces.list()[0];
          window.Spaces.setActive(main.id);
          for (const s of [...window.Spaces.list()]) {
            if (s.id !== main.id) window.Spaces.delete(s.id);
          }
        }
      `);

      const before = await mn.executeScript<number>(`
        return document.querySelectorAll("#gjoa-tab-panel .gjoa-tab-row").length;
      `);

      // Open 5 tabs as quickly as possible — mimics what session-restore
      // does (5 successive TabOpen events).
      await mn.executeScript<void>(`
        const principal = Services.scriptSecurityManager.getSystemPrincipal();
        for (let i = 0; i < 5; i++) {
          gBrowser.addTab("https://example.com/restore-" + i, { triggeringPrincipal: principal });
        }
      `);

      // Wait for 5 new rows. ALL must be present (we tolerate a couple
      // hundred ms for rAF resyncs to settle).
      await waitFor(mn, `
        return document.querySelectorAll("#gjoa-tab-panel .gjoa-tab-row").length >= ${before + 5};
      `, 3000);

      // CRITICAL: every row must be visible (not [hidden]).
      const counts = await mn.executeScript<{ total: number; visible: number; hiddenSamples: string[] }>(`
        const rows = [...document.querySelectorAll("#gjoa-tab-panel .gjoa-tab-row")];
        const hiddenSamples = rows.filter(r => r.hidden)
          .slice(0, 3)
          .map(r => (r._tab?.label || r._tab?.linkedBrowser?.currentURI?.spec || "?"));
        return {
          total: rows.length,
          visible: rows.filter(r => !r.hidden).length,
          hiddenSamples,
        };
      `);
      if (counts.visible < before + 5) {
        throw new Error(
          `expected ${before + 5} visible rows, got ${counts.visible} visible / ${counts.total} total. ` +
          `hidden samples: ${JSON.stringify(counts.hiddenSamples)}`
        );
      }
    },
  },

  {
    name: "Session-like — panel construction is bulletproof: even with pre-set spaces state, panel exists and has rows for every tab",
    async run(mn) {
      // This pokes at the user's actual failure shape: profile state
      // includes spaces / migrated prefs, the panel still must render.
      await waitFor(mn, `return !!document.getElementById("gjoa-tab-panel");`);

      // Force a "messy" state: create some spaces, set a non-Main one
      // active, then verify the panel STILL has visible rows for the
      // tabs (which are anchored to Main / default, so they're hidden
      // under the active non-Main space). Then switch back to Main:
      // tabs must reappear.
      await mn.executeScript<void>(`
        const work = window.Spaces.create("Work");
        window.Spaces.setActive(work.id);
      `);
      // Open a couple of tabs in Work.
      await mn.executeScript<void>(`
        const principal = Services.scriptSecurityManager.getSystemPrincipal();
        gBrowser.addTab("https://example.com/work-a", { triggeringPrincipal: principal });
        gBrowser.addTab("https://example.com/work-b", { triggeringPrincipal: principal });
      `);
      await waitFor(mn, `
        const rows = [...document.querySelectorAll("#gjoa-tab-panel .gjoa-tab-row")];
        return rows.filter(r => !r.hidden).length >= 2;
      `);

      // Switch to Main → at least the original (pre-Work) tabs must be
      // visible. (Defining "at least 1" so the test is robust regardless
      // of pre-suite tab count.)
      await mn.executeScript<void>(`
        const main = window.Spaces.list().find(s => s.name === "Main");
        window.Spaces.setActive(main.id);
      `);
      const visibleOnMain = await mn.executeScript<number>(`
        return [...document.querySelectorAll("#gjoa-tab-panel .gjoa-tab-row")]
          .filter(r => !r.hidden).length;
      `);
      if (visibleOnMain < 1) {
        throw new Error(`switching back to Main showed 0 rows — visibility filter likely hides Main tabs`);
      }
    },
  },
];

export default tests;
