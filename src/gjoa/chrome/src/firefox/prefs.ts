// Firefox prefs adapter — typed wrappers around Services.prefs.
//
// Manifest entry: "Services.prefs" (Tier 0, rock-stable).
// Most-touched API in gjoa today (~35 calls across get/set/observe).
// All wrappers swallow exceptions and return the default value, since
// pref access can throw if the branch doesn't exist or has wrong type.

// `Services.prefs` is typed via src/types/chrome.d.ts.

// =============================================================================
// INTERFACE
// =============================================================================

export function getBool(name: string, defaultValue = false): boolean {
  try { return Services.prefs.getBoolPref(name, defaultValue); }
  catch { return defaultValue; }
}

export function setBool(name: string, value: boolean): void {
  try { Services.prefs.setBoolPref(name, value); } catch {}
}

export function getInt(name: string, defaultValue = 0): number {
  try { return Services.prefs.getIntPref(name, defaultValue); }
  catch { return defaultValue; }
}

export function setInt(name: string, value: number): void {
  try { Services.prefs.setIntPref(name, value); } catch {}
}

export function getString(name: string, defaultValue = ""): string {
  try { return Services.prefs.getStringPref(name, defaultValue); }
  catch {
    try { return Services.prefs.getCharPref(name, defaultValue); }
    catch { return defaultValue; }
  }
}

export function setString(name: string, value: string): void {
  try { Services.prefs.setStringPref(name, value); } catch {}
}

/** One-shot migration of legacy palefox-era prefs.
 *  Walks every pref under `pfx.` and copies it to the matching `gjoa.<rest>`
 *  pref, skipping any pref the user has already set on the gjoa.* side.
 *  Idempotent — safe to call on every startup. */
export function migrateLegacyPrefs(): void {
  const root = Services.prefs as unknown as {
    getBranch(prefix: string): { getChildList(prefix: string, count?: object): string[] };
    getPrefType(name: string): number;
    prefHasUserValue(name: string): boolean;
    getBoolPref(name: string): boolean;
    setBoolPref(name: string, value: boolean): void;
    getIntPref(name: string): number;
    setIntPref(name: string, value: number): void;
    getStringPref(name: string): string;
    setStringPref(name: string, value: string): void;
  };
  let children: string[];
  try { children = root.getBranch("pfx.").getChildList("", {}); }
  catch { return; }
  // nsIPrefBranch type constants: 32=string, 64=int, 128=bool.
  for (const suffix of children) {
    const oldName = "pfx." + suffix;
    const newName = "gjoa." + suffix;
    try {
      if (root.prefHasUserValue(newName)) continue;
      const type = root.getPrefType(oldName);
      if (type === 128) root.setBoolPref(newName, root.getBoolPref(oldName));
      else if (type === 64) root.setIntPref(newName, root.getIntPref(oldName));
      else if (type === 32) root.setStringPref(newName, root.getStringPref(oldName));
    } catch {}
  }
}

/** Ensure `sidebar.verticalTabs` defaults to true. Gjoa is designed
 *  around the vertical sidebar layout — horizontal tabs is an opt-in
 *  escape hatch (the sidebar-button context menu offers it), not a
 *  default state. Firefox's source default is `false`, so a fresh
 *  profile boots into the horizontal-tabs world where the gjoa
 *  sidebar button never even appears.
 *
 *  This helper backstops a fresh profile by setting the pref to true
 *  IF the user has never explicitly set it. If they've toggled to
 *  horizontal via the menu (sets a user value), we respect that. The
 *  next nix build will also pin this in firefox.js — this is the
 *  belt-and-suspenders for profiles created before that ships. */
export function ensureVerticalTabsDefault(): void {
  const prefs = Services.prefs as unknown as {
    prefHasUserValue(name: string): boolean;
    setBoolPref(name: string, value: boolean): void;
  };
  try {
    if (!prefs.prefHasUserValue("sidebar.verticalTabs")) {
      prefs.setBoolPref("sidebar.verticalTabs", true);
    }
  } catch {}
}

/** Subscribe to changes on a pref branch. The handler fires whenever any
 *  pref under `name` (exact match for leaf, prefix for branch) changes;
 *  the changed pref's full name is passed as `data` (third argument).
 *  Returns an `unsubscribe()` disposer. Always unsubscribe in unload paths. */
export function observe(name: string, handler: (changedName: string) => void): () => void {
  const observer = {
    observe(_subject: unknown, _topic: string, data: string): void {
      try { handler(data); } catch (e) { console.error(`gjoa prefs observer ${name}:`, e); }
    },
  };
  try { Services.prefs.addObserver(name, observer); } catch {}
  return () => {
    try { Services.prefs.removeObserver(name, observer); } catch {}
  };
}
