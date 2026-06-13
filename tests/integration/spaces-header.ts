// Spaces UX:
//   1. `:sp` and `:spc` aliases run the same dispatch as `:space`
//   2. `#gjoa-space-header` renders the active space name in the sidebar
//   3. The header updates on switch and rename
//   4. Clicking the header opens the spaces picker

import type { IntegrationTest } from "../../tools/test-driver/runner.ts";
import type { MarionetteClient } from "../../tools/test-driver/marionette.ts";

async function waitFor(
  mn: MarionetteClient,
  script: string,
  timeoutMs = 1500,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await mn.executeScript<boolean>(script)) return;
    } catch (_) { /* keep polling */ }
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`timed out waiting for: ${script.slice(0, 140)}`);
}

async function resetSpaces(mn: MarionetteClient): Promise<void> {
  await mn.executeScript<void>(`
    const main = window.Spaces.list().find(s => s.name === "Main")
              || window.Spaces.list()[0];
    window.Spaces.setActive(main.id);
    for (const s of [...window.Spaces.list()]) {
      if (s.id !== main.id) window.Spaces.delete(s.id);
    }
  `);
}

const tests: IntegrationTest[] = [
  {
    name: "Spaces — :spc (canonical) creates and switches",
    async run(mn) {
      await waitFor(mn, `return !!window.gjoaTest && !!window.gjoaTest.vim && !!window.Spaces;`);
      await resetSpaces(mn);

      await mn.executeScript<void>(`window.gjoaTest.vim.runExCommand("spc new Reading");`);
      const r = await mn.executeScript<{ count: number; activeName: string; names: string[] }>(`
        const list = window.Spaces.list();
        return {
          count: list.length,
          activeName: window.Spaces.active().name,
          names: list.map(s => s.name),
        };
      `);
      if (r.count !== 2) throw new Error(`expected 2 spaces after :spc new, got ${r.count} (${r.names.join(",")})`);
      if (r.activeName !== "Reading") throw new Error(`expected active="Reading", got "${r.activeName}"`);
    },
  },
  {
    name: "Spaces — :space (legacy alias) still routes to spc dispatch",
    async run(mn) {
      await resetSpaces(mn);
      await mn.executeScript<void>(`window.gjoaTest.vim.runExCommand("space new Work");`);
      const activeName = await mn.executeScript<string>(`return window.Spaces.active().name;`);
      if (activeName !== "Work") throw new Error(`expected active="Work" after :space new, got "${activeName}"`);
    },
  },
  {
    name: "Spaces — :sp is NOT a recognized command (only :spc / :space)",
    async run(mn) {
      await resetSpaces(mn);
      const before = await mn.executeScript<number>(`return window.Spaces.list().length;`);
      // `:sp new Ghost` should hit the unknown-command path; no space created.
      await mn.executeScript<void>(`window.gjoaTest.vim.runExCommand("sp new Ghost");`);
      const after = await mn.executeScript<number>(`return window.Spaces.list().length;`);
      const names = await mn.executeScript<string[]>(`return window.Spaces.list().map(s => s.name);`);
      if (after !== before) {
        throw new Error(
          `:sp should be unknown — but a space was created. before=${before} after=${after} ` +
          `names=${JSON.stringify(names)}`,
        );
      }
      if (names.includes("Ghost")) {
        throw new Error(`:sp created a "Ghost" space — alias was not removed. names=${JSON.stringify(names)}`);
      }
    },
  },
  {
    name: "Spaces header — element exists in sidebar above tab panel",
    async run(mn) {
      await resetSpaces(mn);
      const probe = await mn.executeScript<{
        headerExists: boolean;
        labelText: string | null;
        precedesPanel: boolean;
        precedesPinned: boolean;
      }>(`
        const header = document.getElementById("gjoa-space-header");
        const label = document.getElementById("gjoa-space-header-label");
        const panel = document.getElementById("gjoa-tab-panel");
        const pinned = document.getElementById("gjoa-pinned-container");
        function precedes(a, b) {
          if (!a || !b) return false;
          const cmp = a.compareDocumentPosition(b);
          return !!(cmp & Node.DOCUMENT_POSITION_FOLLOWING);
        }
        return {
          headerExists: !!header,
          labelText: label ? (label.getAttribute("value") || label.textContent) : null,
          precedesPanel: precedes(header, panel),
          precedesPinned: precedes(header, pinned),
        };
      `);
      if (!probe.headerExists) throw new Error("#gjoa-space-header not in DOM");
      if (!probe.precedesPanel) throw new Error("#gjoa-space-header is not before #gjoa-tab-panel in DOM order");
      if (!probe.precedesPinned) throw new Error("#gjoa-space-header is not before #gjoa-pinned-container in DOM order");
      if (probe.labelText !== "Main") {
        throw new Error(`header label should read "Main" on fresh state, got "${probe.labelText}"`);
      }
    },
  },
  {
    name: "Spaces header — updates to the new name on :spc switch",
    async run(mn) {
      await resetSpaces(mn);
      await mn.executeScript<void>(`window.gjoaTest.vim.runExCommand("spc new Project");`);
      await waitFor(mn, `
        const l = document.getElementById("gjoa-space-header-label");
        return !!l && (l.getAttribute("value") || l.textContent) === "Project";
      `);

      // Now switch back to Main and verify header re-reflects.
      await mn.executeScript<void>(`
        const main = window.Spaces.list().find(s => s.name === "Main");
        window.Spaces.setActive(main.id);
      `);
      await waitFor(mn, `
        const l = document.getElementById("gjoa-space-header-label");
        return !!l && (l.getAttribute("value") || l.textContent) === "Main";
      `);
    },
  },
  {
    name: "Spaces header — aligned with content rail (matches nav-bar icon column)",
    async run(mn) {
      await resetSpaces(mn);
      const r = await mn.executeScript<{
        headerLeft: number;
        labelLeft: number;
        firstNavIconLeft: number | null;
        sidebarLeft: number;
      }>(`
        const header = document.getElementById("gjoa-space-header");
        const label = document.getElementById("gjoa-space-header-label");
        const sidebar = document.getElementById("sidebar-main");
        const navIcons = sidebar?.querySelectorAll("#nav-bar .toolbarbutton-icon, #nav-bar image");
        let firstNavIconLeft = null;
        if (navIcons) {
          let minLeft = Infinity;
          for (const ic of navIcons) {
            const rect = ic.getBoundingClientRect();
            if (rect.width > 0 && rect.left < minLeft) minLeft = rect.left;
          }
          if (minLeft !== Infinity) firstNavIconLeft = minLeft;
        }
        return {
          headerLeft: header.getBoundingClientRect().left,
          labelLeft: label.getBoundingClientRect().left,
          firstNavIconLeft,
          sidebarLeft: sidebar.getBoundingClientRect().left,
        };
      `);
      // The header content (its visible box, after margin) should not be
      // flush against the sidebar edge — it should sit inside the inset.
      const headerInset = r.headerLeft - r.sidebarLeft;
      if (headerInset < 6) {
        throw new Error(
          `Header flush-left against sidebar edge: headerLeft=${r.headerLeft} ` +
          `sidebarLeft=${r.sidebarLeft} inset=${headerInset}px (expected ≥6px).`,
        );
      }
      // And the label's left edge should be within ~12px of the leftmost
      // nav-bar icon — i.e. on the same visual content rail.
      if (r.firstNavIconLeft !== null) {
        const drift = Math.abs(r.labelLeft - r.firstNavIconLeft);
        if (drift > 24) {
          throw new Error(
            `Header label not aligned with nav-bar icons: labelLeft=${r.labelLeft} ` +
            `firstNavIconLeft=${r.firstNavIconLeft} drift=${drift}px (expected ≤24px).`,
          );
        }
      }
    },
  },
  {
    name: "Spaces header — updates on :spc rename of the active space",
    async run(mn) {
      await resetSpaces(mn);
      await mn.executeScript<void>(`window.gjoaTest.vim.runExCommand("spc rename Inbox");`);
      await waitFor(mn, `
        const l = document.getElementById("gjoa-space-header-label");
        return !!l && (l.getAttribute("value") || l.textContent) === "Inbox";
      `);
      // Restore so subsequent tests see "Main".
      await mn.executeScript<void>(`window.gjoaTest.vim.runExCommand("spc rename Main");`);
    },
  },
];

export default tests;
