// Unit tests for the Spaces manager.
//
// Goal: every state invariant is checked here, in isolation from any DOM,
// Firefox global, or persistence layer. No happy-dom needed.

import { describe, expect, test } from "bun:test";
import { makeSpaces } from "./manager.ts";
import type { SpacesAPI } from "./manager.ts";
import type { Tab } from "../tabs/types.ts";

/** Build a fake Tab. We only need object identity for WeakMap; never read
 *  any actual Tab property in these tests. */
function fakeTab(label = "tab"): Tab {
  return { label } as unknown as Tab;
}

/** Spawn a fresh manager + a counter that captures onChange invocations. */
function setup(): { spaces: SpacesAPI; changeCount: () => number; resetChanges: () => void } {
  let changes = 0;
  const spaces = makeSpaces({ onChange: () => { changes++; } });
  return {
    spaces,
    changeCount: () => changes,
    resetChanges: () => { changes = 0; },
  };
}

describe("makeSpaces — init", () => {
  test("creates a default space and activates it", () => {
    const { spaces } = setup();
    const list = spaces.list();
    expect(list.length).toBe(1);
    expect(list[0]!.name).toBe("Main");
    expect(spaces.activeId()).toBe(list[0]!.id);
  });

  test("init does not fire onChange", () => {
    const { changeCount } = setup();
    expect(changeCount()).toBe(0);
  });

  test("active() returns the default record", () => {
    const { spaces } = setup();
    expect(spaces.active().name).toBe("Main");
  });
});

describe("create / rename / setIcon", () => {
  test("create adds a space and fires onChange", () => {
    const { spaces, changeCount } = setup();
    const s = spaces.create("Work");
    expect(s.name).toBe("Work");
    expect(spaces.list().length).toBe(2);
    expect(spaces.get(s.id)).toEqual(s);
    expect(changeCount()).toBe(1);
  });

  test("create with icon stores the icon", () => {
    const { spaces } = setup();
    const s = spaces.create("Work", "💼");
    expect(s.icon).toBe("💼");
  });

  test("create does NOT switch active", () => {
    const { spaces } = setup();
    const before = spaces.activeId();
    spaces.create("Work");
    expect(spaces.activeId()).toBe(before);
  });

  test("rename updates the name and fires onChange", () => {
    const { spaces, changeCount, resetChanges } = setup();
    const s = spaces.create("Work");
    resetChanges();
    spaces.rename(s.id, "Office");
    expect(spaces.get(s.id)!.name).toBe("Office");
    expect(changeCount()).toBe(1);
  });

  test("rename to same name is a no-op (no onChange)", () => {
    const { spaces, changeCount, resetChanges } = setup();
    const s = spaces.create("Work");
    resetChanges();
    spaces.rename(s.id, "Work");
    expect(changeCount()).toBe(0);
  });

  test("rename unknown id is silent no-op", () => {
    const { spaces, changeCount } = setup();
    const before = changeCount();
    spaces.rename("nope", "X");
    expect(changeCount()).toBe(before);
  });

  test("setIcon adds and clears icon", () => {
    const { spaces } = setup();
    const s = spaces.create("Work");
    spaces.setIcon(s.id, "💼");
    expect(spaces.get(s.id)!.icon).toBe("💼");
    spaces.setIcon(s.id, undefined);
    expect(spaces.get(s.id)!.icon).toBeUndefined();
  });
});

describe("delete", () => {
  test("deleting the default space is a no-op", () => {
    const { spaces, changeCount } = setup();
    const def = spaces.activeId();
    spaces.delete(def);
    expect(spaces.list().length).toBe(1);
    expect(spaces.activeId()).toBe(def);
    expect(changeCount()).toBe(0);
  });

  test("deleting a non-default space removes it", () => {
    const { spaces } = setup();
    const s = spaces.create("Work");
    spaces.delete(s.id);
    expect(spaces.list().length).toBe(1);
    expect(spaces.get(s.id)).toBeNull();
  });

  test("deleting the active space switches to default", () => {
    const { spaces } = setup();
    const def = spaces.activeId();
    const s = spaces.create("Work");
    spaces.setActive(s.id);
    spaces.delete(s.id);
    expect(spaces.activeId()).toBe(def);
  });

  test("orphan tabs (assigned to deleted space) read as default space going forward", () => {
    const { spaces } = setup();
    const def = spaces.activeId(); // default == active at init
    const s = spaces.create("Work");
    const t = fakeTab();
    spaces.assignTab(t, s.id);
    expect(spaces.spaceOf(t)).toBe(s.id);
    spaces.delete(s.id);
    // Orphaned tab anchors to the default space (the floor).
    expect(spaces.spaceOf(t)).toBe(def);
  });

  test("delete of unknown id is silent no-op", () => {
    const { spaces, changeCount } = setup();
    const before = changeCount();
    spaces.delete("nope");
    expect(changeCount()).toBe(before);
  });
});

describe("setActive / assignTab / spaceOf / isVisible", () => {
  test("setActive moves the active pointer", () => {
    const { spaces } = setup();
    const s = spaces.create("Work");
    spaces.setActive(s.id);
    expect(spaces.activeId()).toBe(s.id);
  });

  test("setActive to current is a no-op", () => {
    const { spaces, changeCount, resetChanges } = setup();
    resetChanges();
    spaces.setActive(spaces.activeId());
    expect(changeCount()).toBe(0);
  });

  test("setActive with unknown id is a no-op", () => {
    const { spaces, changeCount, resetChanges } = setup();
    const before = spaces.activeId();
    resetChanges();
    spaces.setActive("nope");
    expect(spaces.activeId()).toBe(before);
    expect(changeCount()).toBe(0);
  });

  test("assignTab places a tab in a space; spaceOf reflects it", () => {
    const { spaces } = setup();
    const s = spaces.create("Work");
    const t = fakeTab();
    spaces.assignTab(t, s.id);
    expect(spaces.spaceOf(t)).toBe(s.id);
  });

  test("assignTab to unknown space is a no-op", () => {
    const { spaces } = setup();
    const t = fakeTab();
    spaces.assignTab(t, "nope");
    expect(spaces.spaceOf(t)).toBe(spaces.activeId()); // default fallback
  });

  test("isVisible: assigned tab visible iff its space is active", () => {
    const { spaces } = setup();
    const def = spaces.activeId();
    const work = spaces.create("Work");
    const t = fakeTab();
    spaces.assignTab(t, def);
    expect(spaces.isVisible(t)).toBe(true);
    spaces.setActive(work.id);
    expect(spaces.isVisible(t)).toBe(false);
  });

  test("isVisible: unassigned tab anchors to default, NOT active", () => {
    const { spaces } = setup();
    const def = spaces.activeId();
    const work = spaces.create("Work");
    const t = fakeTab();
    // Default is active → visible.
    expect(spaces.isVisible(t)).toBe(true);
    // Switch to Work → tab is anchored to default (Main), so hidden.
    spaces.setActive(work.id);
    expect(spaces.isVisible(t)).toBe(false);
    expect(spaces.spaceOf(t)).toBe(def);
  });
});

describe("hydrate / persistence round-trip", () => {
  test("hydrate restores spaces + active + tab pairs", () => {
    const a = setup().spaces;
    const work = a.create("Work");
    const play = a.create("Play");
    a.setActive(play.id);

    const t1 = fakeTab("t1");
    const t2 = fakeTab("t2");
    a.assignTab(t1, work.id);
    a.assignTab(t2, play.id);

    // Snapshot: orchestrator-side assembly (mimicking what tabs/index.ts does).
    const snapshot = {
      spaces: a.list(),
      activeId: a.activeId(),
      tabSpaces: [
        [1, a.spaceOf(t1)],
        [2, a.spaceOf(t2)],
      ] as Array<readonly [number, string]>,
    };

    // Fresh manager, hydrate from snapshot, re-bind tab ids → live Tab refs.
    const b = setup().spaces;
    const liveT1 = fakeTab("liveT1");
    const liveT2 = fakeTab("liveT2");
    b.hydrate(snapshot, (id) => id === 1 ? liveT1 : id === 2 ? liveT2 : null);

    expect(b.list().map(s => s.name).sort()).toEqual(["Main", "Play", "Work"]);
    expect(b.active().name).toBe("Play");
    expect(b.spaceOf(liveT1)).toBe(work.id);
    expect(b.spaceOf(liveT2)).toBe(play.id);
  });

  test("hydrate with empty snapshot keeps the default", () => {
    const { spaces } = setup();
    const def = spaces.activeId();
    spaces.hydrate({ spaces: [], activeId: "nope", tabSpaces: [] }, () => null);
    expect(spaces.list().length).toBe(1);
    expect(spaces.activeId()).toBe(def);
  });

  test("hydrate with unknown active falls back to first space", () => {
    const { spaces } = setup();
    const work = spaces.create("Work");
    const snap = {
      spaces: spaces.list(),
      activeId: "phantom-id",
      tabSpaces: [] as Array<readonly [number, string]>,
    };
    spaces.hydrate(snap, () => null);
    // Should fall back to default (first by createdAt).
    expect(spaces.list()[0]!.id).toBe(spaces.activeId());
    expect(work.id).not.toBe(spaces.activeId()); // not Work (created later)
  });

  test("hydrate skips tab pairs whose space no longer exists", () => {
    const { spaces } = setup();
    const def = spaces.activeId();
    const live = fakeTab();
    spaces.hydrate(
      {
        spaces: spaces.list(),
        activeId: def,
        tabSpaces: [[7, "phantom-space"]],
      },
      (id) => id === 7 ? live : null,
    );
    // Pair was dropped; tab reads as default (active fallback).
    expect(spaces.spaceOf(live)).toBe(def);
  });
});

describe("list ordering", () => {
  test("list is stable: createdAt asc, id tiebreak", () => {
    const { spaces } = setup();
    spaces.create("B");
    spaces.create("A");
    const names = spaces.list().map(s => s.name);
    // Default first (created earliest), then B, then A — createdAt asc.
    expect(names[0]).toBe("Main");
    expect(names.slice(1).sort()).toEqual(["A", "B"]);
  });
});
