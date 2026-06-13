// E2E integration: Spaces driven through the actual vim ex-command path
// and chord-key synthesis. This goes beyond the API-driven spaces.ts tests
// and exercises the full keypress → vim dispatcher → spaces manager chain.

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

/** Reset all non-default spaces between subtests so each one starts clean. */
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
    name: "Spaces+vim — :space new <name> creates and switches via runExCommand",
    async run(mn) {
      await waitFor(mn, `return !!window.gjoaTest && !!window.gjoaTest.vim && !!window.Spaces;`);
      await resetSpaces(mn);

      await mn.executeScript<void>(`window.gjoaTest.vim.runExCommand("space new Work");`);
      const state = await mn.executeScript<{ count: number; activeName: string; names: string[] }>(`
        return {
          count: window.Spaces.list().length,
          activeName: window.Spaces.active().name,
          names: window.Spaces.list().map(s => s.name),
        };
      `);
      if (state.count !== 2) throw new Error(`expected 2 spaces, got ${state.count}: ${JSON.stringify(state)}`);
      if (state.activeName !== "Work") throw new Error(`expected active=Work, got ${state.activeName}: ${JSON.stringify(state)}`);
      if (!state.names.includes("Work")) throw new Error(`Work not in list: ${JSON.stringify(state)}`);
    },
  },

  {
    name: "Spaces+vim — :space rename mutates the active space's name",
    async run(mn) {
      await waitFor(mn, `return !!window.gjoaTest;`);
      await resetSpaces(mn);
      await mn.executeScript<void>(`window.gjoaTest.vim.runExCommand("space new Work");`);
      await mn.executeScript<void>(`window.gjoaTest.vim.runExCommand("space rename Office");`);
      const name = await mn.executeScript<string>(`return window.Spaces.active().name;`);
      if (name !== "Office") throw new Error(`expected active name=Office, got ${name}`);
    },
  },

  {
    name: "Spaces+vim — :space switch <name> moves the active pointer",
    async run(mn) {
      await waitFor(mn, `return !!window.gjoaTest;`);
      await resetSpaces(mn);
      await mn.executeScript<void>(`window.gjoaTest.vim.runExCommand("space new Work");`);
      await mn.executeScript<void>(`window.gjoaTest.vim.runExCommand("space switch Main");`);
      const name = await mn.executeScript<string>(`return window.Spaces.active().name;`);
      if (name !== "Main") throw new Error(`expected active=Main after switch, got ${name}`);
    },
  },

  {
    name: "Spaces+vim — :space delete removes non-default; refuses to delete Main",
    async run(mn) {
      await waitFor(mn, `return !!window.gjoaTest;`);
      await resetSpaces(mn);
      // Create + delete (non-default) — should remove and fall back to Main.
      await mn.executeScript<void>(`window.gjoaTest.vim.runExCommand("space new Doomed");`);
      const cntBefore = await mn.executeScript<number>(`return window.Spaces.list().length;`);
      if (cntBefore !== 2) throw new Error(`setup failed: ${cntBefore}`);
      await mn.executeScript<void>(`window.gjoaTest.vim.runExCommand("space delete");`);
      const afterDel = await mn.executeScript<{ count: number; activeName: string }>(`
        return { count: window.Spaces.list().length, activeName: window.Spaces.active().name };
      `);
      if (afterDel.count !== 1) throw new Error(`expected 1 after delete, got ${afterDel.count}`);
      if (afterDel.activeName !== "Main") throw new Error(`expected active=Main, got ${afterDel.activeName}`);

      // Refuse-to-delete-Main: should be a no-op.
      await mn.executeScript<void>(`window.gjoaTest.vim.runExCommand("space delete");`);
      const final = await mn.executeScript<number>(`return window.Spaces.list().length;`);
      if (final !== 1) throw new Error(`Main should not be deletable; got count=${final}`);
    },
  },

  {
    name: "Spaces+vim — gs / gS chord keys cycle active space",
    async run(mn) {
      await waitFor(mn, `return !!window.gjoaTest && !!window.gjoaTest.vim;`);
      await resetSpaces(mn);
      // Build up: A, B, C  (plus default Main = 4 total).
      await mn.executeScript<void>(`
        window.gjoaTest.vim.runExCommand("space new A");
        window.gjoaTest.vim.runExCommand("space new B");
        window.gjoaTest.vim.runExCommand("space new C");
      `);
      // Reset to Main so cycle starts predictably.
      await mn.executeScript<void>(`window.gjoaTest.vim.runExCommand("space switch Main");`);

      // Synthesize chord keys "gs" → keydown 'g' then keydown 's' against the panel.
      // The panel is what the vim handler listens on. We need to focus it first
      // to put vim in "panel-active" mode.
      await mn.executeScript<void>(`window.gjoaTest.vim.focusPanel();`);

      async function chord(keys) {
        for (const k of keys) {
          const ev = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true });
          document.dispatchEvent(ev);
        }
      }
      // Two presses of "gs" → forward two spaces (Main → A → B).
      await mn.executeScript<void>(`(${(async () => {
        await new Promise(r => setTimeout(r, 0));
      }).toString()})()`);
      await mn.executeScript<void>(`
        function press(k, shift) {
          const ev = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, shiftKey: !!shift });
          document.dispatchEvent(ev);
        }
        press("g"); press("s");
      `);
      const after1 = await mn.executeScript<string>(`return window.Spaces.active().name;`);
      await mn.executeScript<void>(`
        function press(k, shift) {
          const ev = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, shiftKey: !!shift });
          document.dispatchEvent(ev);
        }
        press("g"); press("s");
      `);
      const after2 = await mn.executeScript<string>(`return window.Spaces.active().name;`);

      // gS — reverse cycle once.
      await mn.executeScript<void>(`
        function press(k, shift) {
          const ev = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, shiftKey: !!shift });
          document.dispatchEvent(ev);
        }
        press("g"); press("S", true);
      `);
      const afterReverse = await mn.executeScript<string>(`return window.Spaces.active().name;`);

      // Verify we moved (we don't pin to exact name in case ordering shifts;
      // the property we care about is "active changed forward, then back").
      const all = await mn.executeScript<string[]>(`return window.Spaces.list().map(s => s.name);`);
      if (after1 === "Main") {
        throw new Error(`gs from Main did not cycle. all=${JSON.stringify(all)} after1=${after1}`);
      }
      if (after2 === after1) {
        throw new Error(`second gs did not cycle. all=${JSON.stringify(all)} after1=${after1} after2=${after2}`);
      }
      if (afterReverse !== after1) {
        throw new Error(`gS should reverse to after1. all=${JSON.stringify(all)} after1=${after1} after2=${after2} afterReverse=${afterReverse}`);
      }
    },
  },

  {
    name: "Spaces+vim — :space list opens the picker",
    async run(mn) {
      await waitFor(mn, `return !!window.gjoaTest && !!window.gjoaTest.vim;`);
      await resetSpaces(mn);
      await mn.executeScript<void>(`window.gjoaTest.vim.runExCommand("space new Work");`);
      await mn.executeScript<void>(`window.gjoaTest.vim.runExCommand("space");`);
      // Picker should now be visible. We don't assert the exact DOM (picker
      // internals are vim's concern), but we check that a picker container
      // exists in the document.
      const found = await mn.executeScript<boolean>(`
        return !!document.querySelector("#gjoa-picker, [id*='picker']");
      `);
      if (!found) throw new Error("Expected the picker to be open after `:space` (no-arg)");
      // Dismiss it for cleanup.
      await mn.executeScript<void>(`
        const ev = new KeyboardEvent("keydown", { key: "Escape", bubbles: true });
        document.dispatchEvent(ev);
      `);
    },
  },

  {
    name: "Spaces+vim — visibility filter integrates with sidebar rendering after vim switch",
    async run(mn) {
      await waitFor(mn, `return !!window.gjoaTest;`);
      await resetSpaces(mn);
      // Open 2 throwaway tabs in Main first.
      await mn.executeScript<void>(`
        gBrowser.addTab("https://example.com/a", { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
        gBrowser.addTab("https://example.com/b", { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
      `);
      // Wait for rows.
      await waitFor(mn, `
        return [...document.querySelectorAll("#gjoa-tab-panel .gjoa-tab-row")]
          .filter(r => !r.hidden).length >= 2;
      `);
      const before = await mn.executeScript<number>(`
        return [...document.querySelectorAll("#gjoa-tab-panel .gjoa-tab-row")]
          .filter(r => !r.hidden).length;
      `);

      // Switch to a new space via the vim path.
      await mn.executeScript<void>(`window.gjoaTest.vim.runExCommand("space new Foo");`);
      // After the switch, the tabs from Main should be hidden.
      await waitFor(mn, `
        return [...document.querySelectorAll("#gjoa-tab-panel .gjoa-tab-row")]
          .filter(r => !r.hidden).length === 0;
      `, 5000);

      // Switch back via vim path; rows return.
      await mn.executeScript<void>(`window.gjoaTest.vim.runExCommand("space switch Main");`);
      await waitFor(mn, `
        return [...document.querySelectorAll("#gjoa-tab-panel .gjoa-tab-row")]
          .filter(r => !r.hidden).length === ${before};
      `, 5000);
    },
  },
];

export default tests;
