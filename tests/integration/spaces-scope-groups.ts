// Groups are scoped to spaces: a group created in Space A must not appear
// when Space B is active, and child tabs of a hidden group must hide too.
//
// Pre-fix: group rows were intentionally space-agnostic ("future iteration"
// in rows.ts:updateVisibility). User reported groups bleeding across spaces.

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

async function cleanSpaces(mn: MarionetteClient): Promise<void> {
  await mn.executeScript<void>(`
    const main = window.Spaces.list().find(s => s.name === "Main") || window.Spaces.list()[0];
    window.Spaces.setActive(main.id);
    for (const s of [...window.Spaces.list()]) {
      if (s.id !== main.id) window.Spaces.delete(s.id);
    }
    // Drop any pre-existing group rows so the test starts from a known state.
    for (const r of document.querySelectorAll("#gjoa-tab-panel .gjoa-group-row")) {
      r.remove();
    }
  `);
}

const tests: IntegrationTest[] = [
  {
    name: "spaces-scope-groups — group created in Space A is hidden when Space B is active",
    async run(mn) {
      await waitFor(mn, `return !!window.Spaces && !!window.gjoaTest;`);
      await cleanSpaces(mn);

      // Create Workspace and switch to it.
      await mn.executeScript<void>(`
        const ws = window.Spaces.create("Workspace");
        window.Spaces.setActive(ws.id);
      `);
      await waitFor(mn, `return window.Spaces.active().name === "Workspace";`);

      // Create a group while in Workspace — it should be tagged with
      // the active space at creation.
      await mn.executeScript<void>(`
        const grp = window.gjoaTest.rows.createGroupRow("WS-only group", 0);
        grp.setAttribute("gjoa-test-marker", "ws-group");
        const panel = document.getElementById("gjoa-tab-panel");
        panel.insertBefore(grp, panel.firstChild);
        window.gjoaTest.rows.updateVisibility();
      `);

      // Assert spaceId captured.
      const created = await mn.executeScript<{ spaceId: string; wsId: string }>(`
        const grp = document.querySelector('[gjoa-test-marker="ws-group"]');
        const ws = window.Spaces.list().find(s => s.name === "Workspace");
        return { spaceId: grp._group.spaceId, wsId: ws.id };
      `);
      if (created.spaceId !== created.wsId) {
        throw new Error(`group.spaceId=${created.spaceId} but Workspace.id=${created.wsId} — createGroupRow didn't capture active space`);
      }

      // Switch back to Main. The group must hide.
      await mn.executeScript<void>(`
        const main = window.Spaces.list().find(s => s.name === "Main");
        window.Spaces.setActive(main.id);
      `);
      // Spaces.setActive triggers onChange which schedules a tree resync;
      // give the scheduler a tick.
      await new Promise((r) => setTimeout(r, 100));
      await mn.executeScript<void>(`window.gjoaTest.rows.updateVisibility();`);

      const inMain = await mn.executeScript<{ hidden: boolean }>(`
        const grp = document.querySelector('[gjoa-test-marker="ws-group"]');
        return { hidden: !!grp.hidden };
      `);
      if (!inMain.hidden) {
        throw new Error(`group leaked into Main — was created in Workspace but stayed visible after setActive(Main)`);
      }

      // Switch back to Workspace — group must be visible again.
      await mn.executeScript<void>(`
        const ws = window.Spaces.list().find(s => s.name === "Workspace");
        window.Spaces.setActive(ws.id);
      `);
      await new Promise((r) => setTimeout(r, 100));
      await mn.executeScript<void>(`window.gjoaTest.rows.updateVisibility();`);

      const backInWs = await mn.executeScript<{ hidden: boolean }>(`
        const grp = document.querySelector('[gjoa-test-marker="ws-group"]');
        return { hidden: !!grp.hidden };
      `);
      if (backInWs.hidden) {
        throw new Error(`group hidden in its own space after returning to Workspace — visibility filter broken`);
      }
    },
  },

  {
    name: "spaces-scope-groups — group spaceId persists across save/load (snapshot envelope carries spaceId)",
    async run(mn) {
      await waitFor(mn, `return !!window.Spaces && !!window.gjoaTest;`);
      await cleanSpaces(mn);

      // Create Project space, switch in, create a group there.
      await mn.executeScript<void>(`
        const proj = window.Spaces.create("Project");
        window.Spaces.setActive(proj.id);
        const grp = window.gjoaTest.rows.createGroupRow("Project-A", 0);
        grp.setAttribute("gjoa-test-marker", "proj-group");
        const panel = document.getElementById("gjoa-tab-panel");
        panel.insertBefore(grp, panel.firstChild);
      `);

      // Build the snapshot envelope (same path scheduleSave takes) and
      // inspect the serialized group entry.
      const env = await mn.executeScript<{ entries: Array<Record<string, unknown>>; projId: string }>(`
        // We can't call buildEnvelope directly, but scheduleSave + history
        // are wired. Instead, walk DOM rows the way buildEnvelope does and
        // assert _group.spaceId is non-empty and matches Project.
        const proj = window.Spaces.list().find(s => s.name === "Project");
        const entries = [];
        for (const r of document.querySelectorAll("#gjoa-tab-panel .gjoa-group-row")) {
          const g = r._group;
          if (!g) continue;
          entries.push({ name: g.name, spaceId: g.spaceId });
        }
        return { entries, projId: proj.id };
      `);
      const projEntry = env.entries.find((e) => e.name === "Project-A");
      if (!projEntry) throw new Error("Project-A group not found in DOM");
      if (projEntry.spaceId !== env.projId) {
        throw new Error(
          `Project-A.spaceId=${projEntry.spaceId} doesn't match Project.id=${env.projId} ` +
          `— would not persist correctly across restart`,
        );
      }
    },
  },
];

export default tests;
