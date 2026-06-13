// Tab visibility predicate. Pure. Single source of truth for "does this
// tab belong to the active space?"
//
// Note this is intentionally not exposed as part of the SpacesAPI surface —
// the manager owns the policy and exposes the verb (`isVisible(tab)`).
// Callers should never re-derive their own visibility check.

import type { Tab } from "../tabs/types.ts";
import type { Space, SpaceId } from "./types.ts";

/** Pure predicate: does `tab` belong to the active space?
 *  Tabs that have never been explicitly assigned ("unknown") or whose
 *  assigned space has been deleted ("orphan") anchor to the default space —
 *  i.e. they're visible iff the default IS the active space.
 *  This is the property that makes startup-existing tabs stay in Main as
 *  the user switches spaces, instead of following the active pointer.
 *
 *  `defaultId` is the id of the floor space (list()[0]).
 *  `activeId` is the currently-active id. */
export function isInActiveSpace(
  tab: Tab,
  tabSpace: WeakMap<Tab, SpaceId>,
  spaces: ReadonlyMap<SpaceId, Space>,
  defaultId: SpaceId,
  activeId: SpaceId,
): boolean {
  const id = tabSpace.get(tab);
  const effective = (id !== undefined && spaces.has(id)) ? id : defaultId;
  return effective === activeId;
}
