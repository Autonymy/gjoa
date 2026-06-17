# content-classifier overlay + patch

Firefox 152 ships an experimental `toolkit/components/content-classifier`
component that wraps the in-tree Brave `adblock-rust` engine for **network**
request classification. gjoa builds native ad-blocking on top of it.

`engine/` is gitignored, so anything gjoa changes there must live in the repo or
it won't survive a clean extract / reach CI. Two mechanisms, by kind of change:

## Modifications to upstream files → `patches/0008-content-classifier-cosmetic-filtering.patch`

gjoa's cosmetic-filtering additions are a surgical patch against the stock
FF152 files (fails loud on drift, ~255 lines vs vendoring ~900):
- `nsIContentClassifierService.idl`, `ContentClassifierService.{h,cpp}`,
  `ContentClassifierEngine.{h,cpp}`, `content_classifier_engine/src/lib.rs`,
  `components.conf`, `moz.build` — the Rust FFI
  (`url_cosmetic_resources` / `hidden_class_id_selectors`), the two IDL methods
  (`getUrlCosmeticResources` / `getHiddenClassIdSelectors`), the C++ wrappers +
  cross-engine union, the `@mozilla.org/content-classifier-service;1` contract
  id (so JS can reach the MAIN_PROCESS_ONLY service), and registration of the
  `GjoaCosmetic*.sys.mjs` actors as `EXTRA_JS_MODULES`.

## New gjoa-authored files → whole-file overlays (this directory)

- `ContentClassifierRemoteSettingsClient.sys.mjs` — gjoa's RS client (replaces
  the stock one): loads EasyList/EasyPrivacy from a profile cache.
- `GjoaCosmeticParent.sys.mjs` / `GjoaCosmeticChild.sys.mjs` — the JSWindowActor
  pair that delivers element-hiding to content (USER_SHEET
  `display:none!important`), honoring the global + per-site blocking gates.

## Maintenance

On a Firefox version bump, `patches/0008` will fail to apply if Mozilla
refactored these files — regenerate it against the new stock source
(`~/.cache/gjoa/sources/firefox-<ver>.source.tar.xz` is the exact source CI
extracts). The overlays (actors, RS client) are gjoa-owned and need no rebase
unless the actor/service API changes.

## Privacy note (accepted residual)

Cosmetic hiding is observable from the page: a script can `getComputedStyle()` a
probe element and infer that a filter rule hid it. This is **inherent to all
cosmetic ad-blockers** (uBlock Origin, AdGuard, Brave all expose the identical
oracle) — not gjoa-specific. We mitigate the obvious leaks (the parent derives
the document URL from trusted state, never the content process; the engine only
returns selectors the page's own classes/ids triggered; results are the deduped
union across lists with no per-list attribution) and accept the residual
getComputedStyle side channel as the cost of cosmetic filtering.
