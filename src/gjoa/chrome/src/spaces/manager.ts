// Spaces manager — factory + API. No DOM. No chrome globals. No gBrowser.
//
// State is mutable but encapsulated: spaces (array), activeId (scalar),
// tabSpace (WeakMap). All mutations go through the API; readers get
// snapshots, not references.
//
// Async coordination: every mutation schedules ONE visibility refresh via
// deps.onChange. The refresh is debounced by the caller (rows.scheduleTreeResync
// or platform/scheduler). We never animate or transform here.

import type { Tab } from "../tabs/types.ts";
import { isInActiveSpace } from "./visibility.ts";
import type { Space, SpaceId, SpacesSnapshot } from "./types.ts";

// =============================================================================
// INTERFACE
// =============================================================================

export type SpacesDeps = {
  /** Called whenever the active space changes OR any tab→space mapping changes.
   *  Caller debounces and re-renders visibility. Should be cheap to call
   *  repeatedly (the underlying scheduler dedupes). */
  readonly onChange: () => void;
  /** Called AFTER setActive flips _activeId. Fires only on a real switch
   *  (prev !== next). Consumer uses this to drive `gBrowser.selectedTab`
   *  to a tab inside the new space — without it the sidebar shows the new
   *  space while the content area still shows the old tab. */
  readonly onActivated?: (prev: SpaceId, next: SpaceId) => void;
};

export type SpacesAPI = {
  /** All spaces in stable order (createdAt asc, then id). */
  list(): ReadonlyArray<Space>;
  /** Currently active space's id. Never null — there's always an active space. */
  activeId(): SpaceId;
  /** Lookup. Returns the space record, or null if id is unknown. */
  get(id: SpaceId): Space | null;
  /** Get the active Space record (sugar). */
  active(): Space;
  /** Lookup the space a tab belongs to. Tabs not yet assigned are reported
   *  as belonging to the active space (this matches the visibility predicate). */
  spaceOf(tab: Tab): SpaceId;

  /** Create a new space and return it. Does NOT switch to it — call
   *  setActive separately if desired. */
  create(name: string, icon?: string): Space;
  /** Rename. No-op if id is unknown. */
  rename(id: SpaceId, name: string): void;
  /** Set icon. Pass empty string / undefined to clear. */
  setIcon(id: SpaceId, icon: string | undefined): void;
  /** Delete a space. Orphan tabs reparent to the default space (id ===
   *  list()[0].id). Trying to delete the default space is a no-op. If the
   *  deleted space was active, the default becomes active. */
  delete(id: SpaceId): void;

  /** Switch active space. No-op if id is unknown or already active. */
  setActive(id: SpaceId): void;
  /** Move a tab into a space. No-op if space id is unknown. */
  assignTab(tab: Tab, id: SpaceId): void;
  /** Pure visibility check. The single source of truth — never re-derive. */
  isVisible(tab: Tab): boolean;
  /** Pure visibility check for anything with a stored space id (groups, etc).
   *  Same fallback policy as `isVisible`: unknown/orphan/empty id resolves
   *  to the default space. */
  isSpaceActive(spaceId: SpaceId | null | undefined): boolean;

  /** Re-hydrate state from a snapshot. Caller is responsible for re-binding
   *  the numeric tab ids to live Tab refs via `tabById`. */
  hydrate(
    snapshot: SpacesSnapshot,
    tabById: (id: number) => Tab | null,
  ): void;
};

// =============================================================================
// IMPLEMENTATION
// =============================================================================

const DEFAULT_NAME = "Main";

function uuid(): string {
  // chrome scope exposes crypto.randomUUID.
  return (crypto as { randomUUID(): string }).randomUUID();
}

export function makeSpaces(deps: SpacesDeps): SpacesAPI {
  const { onChange, onActivated } = deps;

  // --- State (private) ----------------------------------------------------
  const _spaces = new Map<SpaceId, Space>();
  const _tabSpace = new WeakMap<Tab, SpaceId>();
  let _activeId: SpaceId;

  // Always create the default space at init. It's the floor — every space
  // operation can rely on at least one space existing.
  const defaultSpace: Space = {
    id: uuid(),
    name: DEFAULT_NAME,
    createdAt: Date.now(),
  };
  _spaces.set(defaultSpace.id, defaultSpace);
  _activeId = defaultSpace.id;

  // --- Helpers ------------------------------------------------------------
  // List order is Map insertion order — deterministic, no ties. The default
  // is always inserted first at construction time, so list()[0] is always
  // the default. We don't sort by createdAt because Date.now() resolution
  // (ms) creates ties for rapid back-to-back creates.
  function listInOrder(): Space[] {
    return [..._spaces.values()];
  }

  /** The default space — the floor. Always exists; never deleted. */
  function defaultId(): SpaceId {
    return listInOrder()[0]!.id;
  }

  // --- API ----------------------------------------------------------------
  return {
    list: listInOrder,
    activeId: () => _activeId,
    get: (id) => _spaces.get(id) ?? null,
    active(): Space {
      return _spaces.get(_activeId)!;
    },
    spaceOf(tab) {
      // Unknown tab (never assigned) → default space (the floor). This
      // matters most at startup: tabs that existed before the user created
      // any non-default spaces stay anchored to "Main" instead of following
      // the active pointer as the user switches spaces.
      // Orphan tab (space was deleted) → default space as well.
      const id = _tabSpace.get(tab);
      if (id && _spaces.has(id)) return id;
      return defaultId();
    },

    create(name, icon) {
      const s: Space = {
        id: uuid(),
        name: name || "Untitled",
        ...(icon ? { icon } : {}),
        createdAt: Date.now(),
      };
      _spaces.set(s.id, s);
      onChange();
      return s;
    },

    rename(id, name) {
      const s = _spaces.get(id);
      if (!s) return;
      if (s.name === name) return;
      _spaces.set(id, { ...s, name });
      onChange();
    },

    setIcon(id, icon) {
      const s = _spaces.get(id);
      if (!s) return;
      const next: Space = { ...s };
      if (icon) (next as { icon?: string }).icon = icon;
      else delete (next as { icon?: string }).icon;
      _spaces.set(id, next);
      onChange();
    },

    delete(id) {
      const def = defaultId();
      if (id === def) return; // floor — never delete
      if (!_spaces.has(id)) return;
      // Orphan-reparenting: we can't iterate WeakMap, so reparenting happens
      // lazily on next spaceOf() / isVisible() call — the deleted id is no
      // longer in _spaces, so getOf treats those tabs as "unknown" and they
      // surface in the active space. Persistence omits orphan rows on save.
      _spaces.delete(id);
      const reactivated = _activeId === id;
      if (reactivated) _activeId = def;
      onChange();
      if (reactivated) onActivated?.(id, def);
    },

    setActive(id) {
      if (!_spaces.has(id)) return;
      if (_activeId === id) return;
      const prev = _activeId;
      _activeId = id;
      onChange();
      onActivated?.(prev, id);
    },

    assignTab(tab, id) {
      if (!_spaces.has(id)) return;
      const prev = _tabSpace.get(tab);
      if (prev === id) return;
      _tabSpace.set(tab, id);
      onChange();
    },

    isVisible(tab) {
      return isInActiveSpace(tab, _tabSpace, _spaces, defaultId(), _activeId);
    },

    isSpaceActive(spaceId) {
      const effective = (spaceId && _spaces.has(spaceId)) ? spaceId : defaultId();
      return effective === _activeId;
    },

    hydrate(snapshot, tabById) {
      _spaces.clear();
      for (const s of snapshot.spaces) _spaces.set(s.id, s);
      // Ensure floor exists. If snapshot had no spaces (legacy), recreate
      // the default and treat all tabs as belonging to it.
      if (_spaces.size === 0) {
        _spaces.set(defaultSpace.id, defaultSpace);
        _activeId = defaultSpace.id;
      } else {
        _activeId = _spaces.has(snapshot.activeId)
          ? snapshot.activeId
          : defaultId();
      }
      // tabSpace can't be cleared (WeakMap has no clear()); fresh init,
      // so this is fine in practice (called once at startup).
      for (const [tabId, spaceId] of snapshot.tabSpaces) {
        if (!_spaces.has(spaceId)) continue; // skip orphans
        const tab = tabById(tabId);
        if (tab) _tabSpace.set(tab, spaceId);
      }
      onChange();
    },
  };
}
