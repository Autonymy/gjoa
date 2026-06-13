// Spaces (aka workspaces) — pure data shapes.
//
// A Space is just a named grouping of tabs. Tab → Space is many-to-one.
// Every tab is in exactly one space at all times. The "default" space
// ("Main") is created on first init and is the only space that cannot
// be deleted — orphans on space-delete reparent to it.
//
// This file is data-only. No DOM, no chrome globals, no factories.

export type SpaceId = string;

export type Space = {
  readonly id: SpaceId;
  readonly name: string;
  /** Short visual hint — emoji or 1-2 chars. Optional. */
  readonly icon?: string;
  /** Unix ms; used for stable sort order in switchers. */
  readonly createdAt: number;
};

/** Snapshot of the spaces subsystem at a point in time. Persisted via
 *  history.ts's event log alongside the tab tree. */
export type SpacesSnapshot = {
  readonly spaces: ReadonlyArray<Space>;
  readonly activeId: SpaceId;
  /** Tab pfx/gjoa-id → SpaceId mapping. We persist via tab IDs (numeric,
   *  stable across sessions) rather than DOM refs. Tabs not listed default
   *  to the active space on first observation. */
  readonly tabSpaces: ReadonlyArray<readonly [number, SpaceId]>;
};
