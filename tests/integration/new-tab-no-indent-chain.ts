// Spec coverage for new-tab placement.
//
// Spec:
//   - Default placement is SIBLING of the currently-active tab.
//     (Successive Ctrl+T pressed while at root → all at root, no
//      indent chain. Ctrl+T while a child is selected → another
//      child of the same parent.)
//   - `gjoa.tabs.newTabPosition` pref, changeable via `:tabpos`,
//     takes "sibling" (default) | "root" | "child".

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

/** Reset the pref + spaces between subtests. */
async function reset(mn: MarionetteClient): Promise<void> {
  await mn.executeScript<void>(`
    try { Services.prefs.clearUserPref("gjoa.tabs.newTabPosition"); } catch {}
    if (window.Spaces) {
      const main = window.Spaces.list().find(s => s.name === "Main") || window.Spaces.list()[0];
      window.Spaces.setActive(main.id);
      for (const s of [...window.Spaces.list()]) {
        if (s.id !== main.id) window.Spaces.delete(s.id);
      }
    }
  `);
}

const tests: IntegrationTest[] = [
  {
    name: "tabpos default — successive Ctrl+T-style at root spawns siblings at root (no indent chain)",
    async run(mn) {
      await waitFor(mn, `return !!document.getElementById("gjoa-tab-panel");`);
      await reset(mn);

      // Single combined script: create 1 root + 3 owner-chained, then
      // walk the rendered rows and capture their inline padding (the
      // visual indent gjoa applies = level * 14 + 8 pixels). All single-
      // script so we don't lose state across marionette sandboxes.
      const stamp = "tabpos-default-" + Date.now();
      const data = await mn.executeScript<Array<{ marker: string; pad: number; parentId: number | string | null }>>(`
        const stamp = ${JSON.stringify(stamp)};
        const principal = Services.scriptSecurityManager.getSystemPrincipal();
        const root = gBrowser.addTab("about:blank", { triggeringPrincipal: principal });
        root.setAttribute("gjoa-test-marker", stamp + "-root");
        gBrowser.selectedTab = root;
        for (let i = 0; i < 3; i++) {
          const owner = gBrowser.selectedTab;
          const t = gBrowser.addTab("about:newtab", { triggeringPrincipal: principal, ownerTab: owner });
          t.setAttribute("gjoa-test-marker", stamp + "-" + i);
          gBrowser.selectedTab = t;
        }
        const marked = [...gBrowser.tabs].filter(t =>
          (t.getAttribute && (t.getAttribute("gjoa-test-marker") || "").startsWith(stamp)));
        return marked.map(t => {
          const row = [...document.querySelectorAll("#gjoa-tab-panel .gjoa-tab-row, #gjoa-tab-panel-pinned .gjoa-tab-row")]
            .find(r => r._tab === t);
          const pad = row ? parseFloat(row.style.paddingInlineStart || "0") : -1;
          return {
            marker: t.getAttribute("gjoa-test-marker"),
            pad,
            parentId: window.gjoaTest.treeOf.get(t)?.parentId ?? null,
          };
        });
      `);
      if (data.length !== 4) {
        throw new Error(`expected 4 marker tabs, got ${data.length}: ${JSON.stringify(data)}`);
      }
      // Root-level rows have padding-inline-start = 8px (level 0 * 14 + 8).
      const nonRoot = data.filter(r => r.pad !== 8 || r.parentId !== null);
      if (nonRoot.length > 0) {
        throw new Error(
          `expected all root (pad=8, parentId=null); got: ${JSON.stringify(data)}`
        );
      }
    },
  },

  {
    name: "tabpos default — Ctrl+T while a CHILD tab is selected spawns a sibling at same depth",
    async run(mn) {
      await waitFor(mn, `return !!document.getElementById("gjoa-tab-panel");`);
      await reset(mn);
      const stamp = "tabpos-sibling-" + Date.now();
      await mn.executeScript<void>(`window.__stamp = "${stamp}";`);

      // Build: parent → child. Select the child.
      await mn.executeScript<void>(`
        const principal = Services.scriptSecurityManager.getSystemPrincipal();
        const parent = gBrowser.addTab("about:blank", { triggeringPrincipal: principal });
        parent.setAttribute("gjoa-test-marker", window.__stamp + "-parent");
        const child = gBrowser.addTab("about:newtab", { triggeringPrincipal: principal, ownerTab: parent });
        child.setAttribute("gjoa-test-marker", window.__stamp + "-child");
        // Pin child to parent in our tree.
        window.gjoaTest.treeOf.get(child).parentId = window.gjoaTest.treeOf.get(parent).id;
        window.gjoaTest.rows.scheduleTreeResync();
        gBrowser.selectedTab = child;
      `);
      await waitFor(mn, `return [...gBrowser.tabs].some(t => t.getAttribute("gjoa-test-marker") === "${stamp}-child");`);

      // Ctrl+T while child is selected — new tab should be SIBLING of child
      // (parentId = child.parentId = parent.id).
      await mn.executeScript<void>(`
        const principal = Services.scriptSecurityManager.getSystemPrincipal();
        const sib = gBrowser.addTab("about:newtab", { triggeringPrincipal: principal, ownerTab: gBrowser.selectedTab });
        sib.setAttribute("gjoa-test-marker", window.__stamp + "-sib");
      `);
      await waitFor(mn, `return [...gBrowser.tabs].some(t => t.getAttribute("gjoa-test-marker") === "${stamp}-sib");`);

      const data = await mn.executeScript<{ parentOfSib: number | string | null; parentOfChild: number | string | null }>(`
        const stamp = window.__stamp;
        const parent = [...gBrowser.tabs].find(t => t.getAttribute("gjoa-test-marker") === stamp + "-parent");
        const child = [...gBrowser.tabs].find(t => t.getAttribute("gjoa-test-marker") === stamp + "-child");
        const sib = [...gBrowser.tabs].find(t => t.getAttribute("gjoa-test-marker") === stamp + "-sib");
        return {
          parentOfSib: window.gjoaTest.treeOf.get(sib).parentId,
          parentOfChild: window.gjoaTest.treeOf.get(child).parentId,
        };
      `);
      if (data.parentOfSib !== data.parentOfChild) {
        throw new Error(
          `Ctrl+T while child selected should produce a sibling of child. ` +
          `sib.parentId=${data.parentOfSib}, child.parentId=${data.parentOfChild}`
        );
      }
    },
  },

  {
    name: ":tabpos root — switching the pref makes new tabs go to root regardless of selected tab",
    async run(mn) {
      await waitFor(mn, `return !!window.gjoaTest && !!window.gjoaTest.vim;`);
      await reset(mn);
      await mn.executeScript<void>(`window.gjoaTest.vim.runExCommand("tabpos root");`);
      const pref = await mn.executeScript<string>(`return Services.prefs.getCharPref("gjoa.tabs.newTabPosition");`);
      if (pref !== "root") throw new Error(`pref not set: ${pref}`);

      // Open: parent → child → grandchild via the pref. With "root",
      // EVERY new tab should be at parentId=null even when an ownerTab
      // is supplied.
      const stamp = "tabpos-root-" + Date.now();
      await mn.executeScript<void>(`
        const principal = Services.scriptSecurityManager.getSystemPrincipal();
        const a = gBrowser.addTab("about:blank", { triggeringPrincipal: principal });
        a.setAttribute("gjoa-test-marker", "${stamp}-a");
        gBrowser.selectedTab = a;
        const b = gBrowser.addTab("about:newtab", { triggeringPrincipal: principal, ownerTab: a });
        b.setAttribute("gjoa-test-marker", "${stamp}-b");
        gBrowser.selectedTab = b;
        const c = gBrowser.addTab("about:newtab", { triggeringPrincipal: principal, ownerTab: b });
        c.setAttribute("gjoa-test-marker", "${stamp}-c");
      `);
      await waitFor(mn, `return [...gBrowser.tabs].some(t => t.getAttribute("gjoa-test-marker") === "${stamp}-c");`);
      const parents = await mn.executeScript<Array<{ m: string; p: number | string | null }>>(`
        return [...gBrowser.tabs]
          .filter(t => t.getAttribute && (t.getAttribute("gjoa-test-marker") || "").startsWith("${stamp}"))
          .map(t => ({ m: t.getAttribute("gjoa-test-marker"), p: window.gjoaTest.treeOf.get(t).parentId }));
      `);
      const nonRoot = parents.filter(r => r.p !== null);
      if (nonRoot.length > 0) {
        throw new Error(`:tabpos root broken — non-root tabs: ${JSON.stringify(parents)}`);
      }
    },
  },

  {
    name: ":tabpos child — switching the pref makes new tabs nest under their owner",
    async run(mn) {
      await waitFor(mn, `return !!window.gjoaTest;`);
      await reset(mn);
      await mn.executeScript<void>(`window.gjoaTest.vim.runExCommand("tabpos child");`);
      const stamp = "tabpos-child-" + Date.now();
      await mn.executeScript<void>(`
        const principal = Services.scriptSecurityManager.getSystemPrincipal();
        const parent = gBrowser.addTab("about:blank", { triggeringPrincipal: principal });
        parent.setAttribute("gjoa-test-marker", "${stamp}-p");
        gBrowser.selectedTab = parent;
        const c = gBrowser.addTab("about:newtab", { triggeringPrincipal: principal, ownerTab: parent });
        c.setAttribute("gjoa-test-marker", "${stamp}-c");
      `);
      await waitFor(mn, `return [...gBrowser.tabs].some(t => t.getAttribute("gjoa-test-marker") === "${stamp}-c");`);
      const data = await mn.executeScript<{ parentId: number | string | null; expectedParent: number }>(`
        const p = [...gBrowser.tabs].find(t => t.getAttribute("gjoa-test-marker") === "${stamp}-p");
        const c = [...gBrowser.tabs].find(t => t.getAttribute("gjoa-test-marker") === "${stamp}-c");
        return {
          parentId: window.gjoaTest.treeOf.get(c).parentId,
          expectedParent: window.gjoaTest.treeOf.get(p).id,
        };
      `);
      if (data.parentId !== data.expectedParent) {
        throw new Error(`:tabpos child broken — got parentId=${data.parentId}, expected ${data.expectedParent}`);
      }
    },
  },

  {
    name: ":tabpos with no arg reports current value",
    async run(mn) {
      await reset(mn);
      await mn.executeScript<void>(`window.gjoaTest.vim.runExCommand("tabpos sibling");`);
      await mn.executeScript<void>(`window.gjoaTest.vim.runExCommand("tabpos");`);
      // The modeline gets a message — we don't assert the exact string,
      // just that the pref is unchanged (no-op behavior of bare :tabpos).
      const pref = await mn.executeScript<string>(`return Services.prefs.getCharPref("gjoa.tabs.newTabPosition");`);
      if (pref !== "sibling") throw new Error(`bare :tabpos should be read-only, pref changed to ${pref}`);
    },
  },

  {
    name: ":tabpos rejects invalid arg",
    async run(mn) {
      await reset(mn);
      await mn.executeScript<void>(`window.gjoaTest.vim.runExCommand("tabpos sibling");`);
      await mn.executeScript<void>(`window.gjoaTest.vim.runExCommand("tabpos garbage");`);
      const pref = await mn.executeScript<string>(`return Services.prefs.getCharPref("gjoa.tabs.newTabPosition");`);
      if (pref !== "sibling") throw new Error(`:tabpos garbage should be rejected, pref was ${pref}`);
    },
  },
];

export default tests;
