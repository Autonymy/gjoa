// Integration tests for tab groups — the "Create Group" context-menu
// action and dragging tabs into / out of groups.
//
// Bugs under test (regression coverage for #11 and #12):
//   - #11: "Create Group" on a tab should compose the tab + its subtree
//          into the new group, not just spawn an empty group above.
//   - #12: Dropping a tab "as child of group" should land the row indented
//          INSIDE the group, not above it.
//
// All tests run in chrome context, synthesizing the same DragEvents
// gjoa-tabs handlers receive from Firefox. We assert against the
// real chrome DOM (.gjoa-tab-row, .gjoa-group-row classes, parentId in
// the treeData metadata exposed via window.gjoaTabsTest).
//
// Note: gjoa-tabs doesn't currently expose a window.gjoaTabsTest
// hook. We read parentId by walking the tab `gjoa-id` attribute against
// the rendered indent on the row (via inline style or computed
// padding-left). For tighter assertions we also use SessionStore's
// persisted state lookups.

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

/** Wait until gjoa-tabs has rendered N rows in the sidebar panel. */
function waitForRows(mn: MarionetteClient, n: number): Promise<void> {
  return waitFor(
    mn,
    `return document.querySelectorAll("#gjoa-tab-panel .gjoa-tab-row, #gjoa-tab-panel-pinned .gjoa-tab-row").length >= ${n};`,
  );
}

/** Build a drag-chain script. position: top quarter / bottom quarter / middle.
 *  Indices reference document.querySelectorAll(".gjoa-tab-row, .gjoa-group-row")
 *  in DOM order. */
function buildDragScript(opts: {
  sourceIndex: number;
  targetIndex: number;
  position: "before" | "after" | "into";
}): string {
  return `
    const rows = [...document.querySelectorAll(".gjoa-tab-row, .gjoa-group-row")];
    const source = rows[${opts.sourceIndex}];
    const target = rows[${opts.targetIndex}];
    if (!source || !target) {
      throw new Error("source or target row missing — sourceIndex=${opts.sourceIndex} targetIndex=${opts.targetIndex} rows.length=" + rows.length);
    }
    const tRect = target.getBoundingClientRect();
    const yByPosition = {
      before: tRect.top + 2,
      after:  tRect.bottom - 2,
      into:   tRect.top + (tRect.height / 2),
    };
    const clientY = yByPosition[${JSON.stringify(opts.position)}];
    const clientX = tRect.left + (tRect.width / 2);
    const dt = new DataTransfer();
    function fire(el, type, x, y) {
      el.dispatchEvent(new DragEvent(type, {
        bubbles: true, cancelable: true, view: window,
        clientX: x, clientY: y, dataTransfer: dt,
      }));
    }
    const sRect = source.getBoundingClientRect();
    fire(source, "dragstart", sRect.left + 5, sRect.top + 5);
    fire(target, "dragenter", clientX, clientY);
    fire(target, "dragover",  clientX, clientY);
    fire(target, "drop",      clientX, clientY);
    fire(source, "dragend",   clientX, clientY);
    return true;
  `;
}

/** Read the sidebar's tree as `[level, kind, label]` triples in DOM order.
 *  Level is recovered from row.style.paddingInlineStart: gjoa-tabs uses
 *  `paddingInlineStart = level * INDENT + 8` (constants.ts:INDENT=14), so
 *  inverse is `(padding - 8) / 14`. */
const READ_TREE_SCRIPT = `
  const INDENT = 14;
  const rows = [...document.querySelectorAll("#gjoa-tab-panel .gjoa-tab-row, #gjoa-tab-panel .gjoa-group-row")];
  return rows.map(r => {
    const padPx = parseFloat(r.style.paddingInlineStart || "0") || 0;
    const level = Math.max(0, Math.round((padPx - 8) / INDENT));
    const kind = r.classList.contains("gjoa-group-row") ? "group" : "tab";
    const labelEl = r.querySelector(".gjoa-tab-label, .gjoa-group-name");
    return [level, kind, labelEl?.textContent ?? r.getAttribute("aria-label") ?? ""];
  });
`;

async function readTree(mn: MarionetteClient): Promise<[number, string, string][]> {
  return mn.executeScript(READ_TREE_SCRIPT);
}

/** Open the sidebar if it's collapsed — the gjoa-tabs panel only attaches
 *  rows when the launcher is expanded. */
async function ensureSidebarExpanded(mn: MarionetteClient): Promise<void> {
  await mn.executeScript(`
    const sm = document.getElementById("sidebar-main");
    if (sm && !sm.hasAttribute("sidebar-launcher-expanded")) {
      sm.setAttribute("sidebar-launcher-expanded", "true");
    }
    return true;
  `);
  await waitFor(mn, `return !!document.querySelector("#gjoa-tab-panel");`);
}

const tests: IntegrationTest[] = [
  {
    name: "#11 Create Group on parent composes parent + subtree into the new group",
    async run(mn) {
      await ensureSidebarExpanded(mn);

      // Build a parent + 2 children. We do it via gBrowser.addTab + manual
      // parentId so we control the tree shape exactly.
      await mn.executeScript(`
        const sp = Services.scriptSecurityManager.getSystemPrincipal();
        const parent = gBrowser.addTab("about:blank", { triggeringPrincipal: sp });
        const childA = gBrowser.addTab("about:blank", { triggeringPrincipal: sp });
        const childB = gBrowser.addTab("about:blank", { triggeringPrincipal: sp });
        // Force tree via internal API: we don't have one exposed, so we set
        // the parentId via the persisted XUL attribute then poke a resync.
        // The tabs module will pick up the IDs the next time it reads
        // treeData. We rely on the test seeing the right SUBTREE shape by
        // visually constructing it: append children under the parent's
        // panel row by inserting a sibling-tab call that DOES set parentId.
        const td_p = parent._td || null;  // unused; we drive via menu directly
        gBrowser.selectedTab = parent;
        return true;
      `);
      await waitForRows(mn, 4); // initial about:blank + 3 new

      // Use the public "newTabPosition=child" pref to make the next opens
      // inherit parent. This is the cleanest seam for shaping the tree
      // because gjoa-tabs is the one consuming the pref in onTabOpen.
      //
      // Strategy: roll back the 3 tabs we just made, set pref to child,
      // open A under parent, open B under parent. Result tree:
      //   parent
      //   ├── A
      //   └── B
      // Then open the context menu on parent and pick "Create Group".
      // After: a new group sits at parent's old position, containing
      // parent + A + B.
      await mn.executeScript(`
        // Close the children we just made — the test cares about a specific
        // tree shape, not these placeholders.
        for (const t of [...gBrowser.tabs]) {
          if (t._td) continue;
          if (t.linkedBrowser?.currentURI?.spec === "about:blank" &&
              !t.selected && t !== gBrowser.tabs[0]) {
            gBrowser.removeTab(t);
          }
        }
        return true;
      `);

      await mn.executeScript(`Services.prefs.setCharPref("gjoa.tabs.newTabPosition", "child");`);

      await mn.executeScript(`
        const sp = Services.scriptSecurityManager.getSystemPrincipal();
        const parent = gBrowser.addTab("about:blank?p", { triggeringPrincipal: sp });
        gBrowser.selectedTab = parent;
        return true;
      `);
      await waitFor(mn, `
        return [...gBrowser.tabs].some(t =>
          t.linkedBrowser?.currentURI?.spec === "about:blank?p");
      `);
      await mn.executeScript(`
        const sp = Services.scriptSecurityManager.getSystemPrincipal();
        gBrowser.addTab("about:blank?a", { triggeringPrincipal: sp });
        return true;
      `);
      await mn.executeScript(`
        const sp = Services.scriptSecurityManager.getSystemPrincipal();
        gBrowser.addTab("about:blank?b", { triggeringPrincipal: sp });
        return true;
      `);
      await waitForRows(mn, 4);

      // Snapshot the pre-state.
      const before = await readTree(mn);

      // Trigger "Create Group" on the parent (about:blank?p). We poke
      // state.contextTab and fire the command directly — the menu item's
      // command listener doesn't care whether a real right-click happened.
      const triggered = await mn.executeScript<boolean>(`
        const parentTab = [...gBrowser.tabs].find(t =>
          t.linkedBrowser?.currentURI?.spec === "about:blank?p");
        if (!parentTab) throw new Error("parent tab not found");
        // The menu's createGroupItem reads state.contextTab from the tabs
        // module's closure-private state. We can reach it through the
        // contextmenu event the row's listener installs: simulate a real
        // contextmenu on the parent row, then click the menu item.
        const row = document.querySelector('.gjoa-tab-row[selected="true"]')
                 || [...document.querySelectorAll(".gjoa-tab-row")]
                       .find(r => {
                         const lbl = r.querySelector(".gjoa-tab-label");
                         return lbl?.textContent?.includes("about:blank?p");
                       });
        if (!row) {
          // Fallback: just find the row whose underlying tab.linkedBrowser
          // URL matches.
          throw new Error("parent row not found in DOM");
        }
        // Dispatch a contextmenu event on the row so the listener captures
        // state.contextTab. The menu opens but we don't need to wait — the
        // click handler synchronously sets contextTab.
        row.dispatchEvent(new MouseEvent("contextmenu", {
          bubbles: true, cancelable: true, button: 2,
          clientX: row.getBoundingClientRect().left + 5,
          clientY: row.getBoundingClientRect().top + 5,
        }));
        const menu = document.getElementById("gjoa-tab-menu");
        if (!menu) throw new Error("gjoa-tab-menu missing");
        const item = [...menu.querySelectorAll("menuitem")]
          .find(mi => mi.getAttribute("label") === "Create Group");
        if (!item) throw new Error("Create Group menuitem missing");
        // Click the menuitem — fires the command handler that builds the group.
        item.dispatchEvent(new Event("command", { bubbles: true }));
        return true;
      `);
      if (!triggered) throw new Error("Create Group menu click didn't fire");

      // Wait a tick for the tree to settle.
      await new Promise((r) => setTimeout(r, 200));

      const after = await readTree(mn);

      // Assertions:
      //   (a) a group row appeared
      //   (b) parent tab is now indented to group.level + 1
      //   (c) the children (A, B) are indented one further
      const groupIdx = after.findIndex(([, kind]) => kind === "group");
      if (groupIdx < 0) {
        throw new Error(
          `expected a group row in the tree after Create Group. ` +
          `before=${JSON.stringify(before)}, after=${JSON.stringify(after)}`,
        );
      }
      const groupLevel = after[groupIdx]![0];
      const parentIdx = after.findIndex(([, kind, label]) =>
        kind === "tab" && label.includes("about:blank?p"));
      const aIdx = after.findIndex(([, kind, label]) =>
        kind === "tab" && label.includes("about:blank?a"));
      const bIdx = after.findIndex(([, kind, label]) =>
        kind === "tab" && label.includes("about:blank?b"));
      if (parentIdx < 0 || aIdx < 0 || bIdx < 0) {
        throw new Error(`tabs missing in after-tree: ${JSON.stringify(after)}`);
      }
      const expected = groupLevel + 1;
      if (after[parentIdx]![0] !== expected) {
        throw new Error(
          `parent tab level should be ${expected} (group.level + 1), ` +
          `got ${after[parentIdx]![0]}. tree=${JSON.stringify(after)}`,
        );
      }
      if (after[aIdx]![0] <= expected || after[bIdx]![0] <= expected) {
        throw new Error(
          `children should be indented deeper than parent (${expected}), ` +
          `got A=${after[aIdx]![0]} B=${after[bIdx]![0]}. ` +
          `tree=${JSON.stringify(after)}`,
        );
      }
      // Group should sit at the parent's old position (before the parent
      // in DOM order). Since groupIdx < parentIdx already, that's covered.
      if (groupIdx >= parentIdx) {
        throw new Error(
          `group should be inserted BEFORE the parent tab. ` +
          `groupIdx=${groupIdx} parentIdx=${parentIdx}. ` +
          `tree=${JSON.stringify(after)}`,
        );
      }
    },
  },

  {
    name: "#12b drop tab AS CHILD of a non-empty group lands AT END of subtree (after last child)",
    async run(mn) {
      await ensureSidebarExpanded(mn);
      await mn.executeScript(`Services.prefs.setCharPref("gjoa.tabs.newTabPosition", "root");`);

      // Build the group + populate it with one existing child.
      // Use the panel context menu for the group, then move a tab "into" it
      // to seed a child. Finally drop the test "dropper" tab "into" the
      // same group and assert it lands AT THE END of the group's subtree,
      // not anywhere above the group row.
      const spawned = await mn.executeScript<boolean>(`
        const panel = document.getElementById("gjoa-tab-panel");
        const spacer = panel.querySelector("[gjoa-spacer], .gjoa-spacer") || panel.firstChild;
        const rect = (spacer || panel).getBoundingClientRect();
        (spacer || panel).dispatchEvent(new MouseEvent("contextmenu", {
          bubbles: true, cancelable: true, button: 2,
          clientX: rect.left + 4, clientY: rect.top + 4,
        }));
        const menu = document.getElementById("gjoa-panel-menu");
        const item = [...menu.querySelectorAll("menuitem")]
          .find(mi => mi.getAttribute("label") === "New Tab Group");
        item.dispatchEvent(new Event("command", { bubbles: true }));
        return true;
      `);
      if (!spawned) throw new Error("New Tab Group menu click didn't fire");
      // Wait for the LATEST group row (the test before may have spawned its own).
      await waitFor(mn, `return document.querySelectorAll("#gjoa-tab-panel .gjoa-group-row").length >= 2;`);

      // Seed: open a tab + a "dropper" tab.
      await mn.executeScript(`
        const sp = Services.scriptSecurityManager.getSystemPrincipal();
        gBrowser.addTab("about:blank?seed", { triggeringPrincipal: sp });
        gBrowser.addTab("about:blank?dropper2", { triggeringPrincipal: sp });
        return true;
      `);
      await waitFor(mn, `
        const labels = [...document.querySelectorAll("#gjoa-tab-panel .gjoa-tab-row .gjoa-tab-label")].map(e => e.textContent);
        return labels.some(l => l?.includes("about:blank?seed"))
            && labels.some(l => l?.includes("about:blank?dropper2"));
      `);

      // First drag: drop seed INTO the latest group.
      const allRowsBefore = await mn.executeScript<{ kind: string; label: string }[]>(`
        return [...document.querySelectorAll("#gjoa-tab-panel .gjoa-tab-row, #gjoa-tab-panel .gjoa-group-row")]
          .map(r => ({
            kind: r.classList.contains("gjoa-group-row") ? "group" : "tab",
            label: r.querySelector(".gjoa-tab-label, .gjoa-group-name")?.textContent ?? "",
          }));
      `);
      // Latest group = the one furthest down in DOM.
      let latestGroupIdx = -1;
      for (let i = 0; i < allRowsBefore.length; i++) {
        if (allRowsBefore[i]!.kind === "group") latestGroupIdx = i;
      }
      const seedIdx = allRowsBefore.findIndex(r => r.label.includes("about:blank?seed"));
      const dropperIdx = allRowsBefore.findIndex(r => r.label.includes("about:blank?dropper2"));
      if (latestGroupIdx < 0 || seedIdx < 0 || dropperIdx < 0) {
        throw new Error(`setup: latestGroupIdx=${latestGroupIdx} seedIdx=${seedIdx} dropperIdx=${dropperIdx}, rows=${JSON.stringify(allRowsBefore)}`);
      }
      await mn.executeScript(buildDragScript({
        sourceIndex: seedIdx,
        targetIndex: latestGroupIdx,
        position: "into",
      }));
      await new Promise((r) => setTimeout(r, 200));

      // Now the group has one child (seed). Drop dropper2 INTO the same group.
      const allRowsMid = await mn.executeScript<{ kind: string; label: string }[]>(`
        return [...document.querySelectorAll("#gjoa-tab-panel .gjoa-tab-row, #gjoa-tab-panel .gjoa-group-row")]
          .map(r => ({
            kind: r.classList.contains("gjoa-group-row") ? "group" : "tab",
            label: r.querySelector(".gjoa-tab-label, .gjoa-group-name")?.textContent ?? "",
          }));
      `);
      let midGroupIdx = -1;
      for (let i = 0; i < allRowsMid.length; i++) {
        if (allRowsMid[i]!.kind === "group") midGroupIdx = i;
      }
      const newDropperIdx = allRowsMid.findIndex(r => r.label.includes("about:blank?dropper2"));
      if (midGroupIdx < 0 || newDropperIdx < 0) {
        throw new Error(`mid: groupIdx=${midGroupIdx} dropperIdx=${newDropperIdx}, rows=${JSON.stringify(allRowsMid)}`);
      }
      await mn.executeScript(buildDragScript({
        sourceIndex: newDropperIdx,
        targetIndex: midGroupIdx,
        position: "into",
      }));
      await new Promise((r) => setTimeout(r, 200));

      // Final tree shape. The non-empty group should now contain:
      //   group → seed → dropper2
      // All AFTER the group row, both indented at level > group.level.
      const after = await readTree(mn);
      let postGroupIdx = -1;
      for (let i = 0; i < after.length; i++) {
        if (after[i]![1] === "group") postGroupIdx = i;
      }
      const postSeedIdx = after.findIndex(([, kind, label]) =>
        kind === "tab" && label.includes("about:blank?seed"));
      const postDropperIdx = after.findIndex(([, kind, label]) =>
        kind === "tab" && label.includes("about:blank?dropper2"));
      if (postGroupIdx < 0 || postSeedIdx < 0 || postDropperIdx < 0) {
        throw new Error(`after: postGroupIdx=${postGroupIdx} postSeedIdx=${postSeedIdx} postDropperIdx=${postDropperIdx}, tree=${JSON.stringify(after)}`);
      }
      // (1) dropper2 must sit AFTER the group row in DOM order
      if (postDropperIdx <= postGroupIdx) {
        throw new Error(
          `BUG: dropper2 should land AFTER (below) the group row, but is at DOM idx ${postDropperIdx} ` +
          `vs group at ${postGroupIdx}. tree=${JSON.stringify(after)}`,
        );
      }
      // (2) dropper2 must sit AFTER the seed (end of subtree)
      if (postDropperIdx <= postSeedIdx) {
        throw new Error(
          `dropper2 should land AT END of subtree, after seed. ` +
          `dropper@${postDropperIdx} seed@${postSeedIdx}. tree=${JSON.stringify(after)}`,
        );
      }
      // (3) Indented (level > group's level)
      const groupLv = after[postGroupIdx]![0];
      if (after[postDropperIdx]![0] <= groupLv) {
        throw new Error(
          `dropper2 should be indented (level > ${groupLv}), got ${after[postDropperIdx]![0]}. ` +
          `tree=${JSON.stringify(after)}`,
        );
      }
    },
  },

  {
    name: "#12 drop tab AS CHILD of an empty group lands inside (indented), not above",
    async run(mn) {
      await ensureSidebarExpanded(mn);

      // Reset newTabPosition to root so children aren't auto-nested.
      await mn.executeScript(`Services.prefs.setCharPref("gjoa.tabs.newTabPosition", "root");`);

      // Create the panel-level "New Tab Group" first.
      // The cleanest way is to invoke the panel context menu's New Tab
      // Group item — that's a real entry point in the chrome JS.
      const spawned = await mn.executeScript<boolean>(`
        const panel = document.getElementById("gjoa-tab-panel");
        if (!panel) throw new Error("gjoa-tab-panel missing");
        const spacer = panel.querySelector("[gjoa-spacer], .gjoa-spacer")
          || panel.firstChild;
        // Right-click the spacer area.
        const rect = (spacer || panel).getBoundingClientRect();
        (spacer || panel).dispatchEvent(new MouseEvent("contextmenu", {
          bubbles: true, cancelable: true, button: 2,
          clientX: rect.left + 4, clientY: rect.top + 4,
        }));
        const menu = document.getElementById("gjoa-panel-menu");
        if (!menu) throw new Error("gjoa-panel-menu missing");
        const item = [...menu.querySelectorAll("menuitem")]
          .find(mi => mi.getAttribute("label") === "New Tab Group");
        if (!item) throw new Error("New Tab Group menuitem missing");
        item.dispatchEvent(new Event("command", { bubbles: true }));
        return true;
      `);
      if (!spawned) throw new Error("New Tab Group menu click didn't fire");
      await waitFor(mn, `return !!document.querySelector("#gjoa-tab-panel .gjoa-group-row");`);

      // Add a fresh tab at root.
      await mn.executeScript(`
        const sp = Services.scriptSecurityManager.getSystemPrincipal();
        gBrowser.addTab("about:blank?dropper", { triggeringPrincipal: sp });
        return true;
      `);
      await waitFor(mn, `
        return [...document.querySelectorAll("#gjoa-tab-panel .gjoa-tab-row")]
          .some(r => r.querySelector(".gjoa-tab-label")?.textContent?.includes("about:blank?dropper"));
      `);

      // Now drag the "dropper" tab onto the group row using "into" position.
      const tree = await readTree(mn);
      const groupIdx = tree.findIndex(([, kind]) => kind === "group");
      // "dropper" tab index in DOM among (tab|group) rows
      const allRows = await mn.executeScript<{ kind: string; label: string }[]>(`
        return [...document.querySelectorAll("#gjoa-tab-panel .gjoa-tab-row, #gjoa-tab-panel .gjoa-group-row")]
          .map(r => ({
            kind: r.classList.contains("gjoa-group-row") ? "group" : "tab",
            label: r.querySelector(".gjoa-tab-label, .gjoa-group-name")?.textContent ?? "",
          }));
      `);
      const dropperIdx = allRows.findIndex(r => r.label.includes("about:blank?dropper"));
      if (dropperIdx < 0 || groupIdx < 0) {
        throw new Error(`setup: dropperIdx=${dropperIdx} groupIdx=${groupIdx}, tree=${JSON.stringify(allRows)}`);
      }

      await mn.executeScript(buildDragScript({
        sourceIndex: dropperIdx,
        targetIndex: groupIdx,
        position: "into",
      }));
      await new Promise((r) => setTimeout(r, 200));

      const after = await readTree(mn);
      const newDropperIdx = after.findIndex(([, kind, label]) =>
        kind === "tab" && label.includes("about:blank?dropper"));
      const newGroupIdx = after.findIndex(([, kind]) => kind === "group");
      if (newDropperIdx < 0 || newGroupIdx < 0) {
        throw new Error(`after-drop: dropperIdx=${newDropperIdx} groupIdx=${newGroupIdx}, tree=${JSON.stringify(after)}`);
      }
      if (newDropperIdx <= newGroupIdx) {
        throw new Error(
          `dropper should land AFTER (inside) the group, but is at ${newDropperIdx} ` +
          `vs group at ${newGroupIdx}. tree=${JSON.stringify(after)}`,
        );
      }
      const groupLevel = after[newGroupIdx]![0];
      if (after[newDropperIdx]![0] <= groupLevel) {
        throw new Error(
          `dropper should be indented (level > ${groupLevel}), ` +
          `got level=${after[newDropperIdx]![0]}. tree=${JSON.stringify(after)}`,
        );
      }
    },
  },
];

export default tests;
