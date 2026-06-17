# content-classifier overlay

Firefox 152 ships an experimental `toolkit/components/content-classifier`
component that wraps the in-tree Brave `adblock-rust` engine for **network**
request classification. gjoa builds native ad-blocking on top of it.

These files are **whole-file overlays** (mirrored into `engine/` verbatim by
`tools/prep/overlay.bjs` during `bun run import`). `engine/` is gitignored, so
anything gjoa changes there must live here to survive a clean extract and reach
CI builds.

## What gjoa changed vs upstream FF152

- `ContentClassifierRemoteSettingsClient.sys.mjs` — gjoa's RS client: loads
  EasyList/EasyPrivacy from a profile cache and feeds them to the C++ service.
- `nsIContentClassifierService.idl`, `ContentClassifierService.{h,cpp}`,
  `ContentClassifierEngine.{h,cpp}`, `content_classifier_engine/src/lib.rs`,
  `components.conf`, `moz.build` — gjoa **added cosmetic filtering**: the Rust
  FFI (`url_cosmetic_resources` / `hidden_class_id_selectors`), the two IDL
  methods (`getUrlCosmeticResources` / `getHiddenClassIdSelectors`), the C++
  wrappers + cross-engine union, a `@mozilla.org/content-classifier-service;1`
  contract id (so JS can reach the MAIN_PROCESS_ONLY service), and registration
  of `GjoaCosmetic*.sys.mjs` as `EXTRA_JS_MODULES`.
- `GjoaCosmeticParent.sys.mjs` / `GjoaCosmeticChild.sys.mjs` — gjoa-authored
  JSWindowActor pair that delivers element-hiding to content (USER_SHEET
  `display:none!important`), honoring the global + per-site blocking gates.

## Privacy note (accepted residual)

Cosmetic hiding is observable from the page: a script can `getComputedStyle()` a
probe element and infer that a filter rule hid it. This is **inherent to all
cosmetic ad-blockers** (uBlock Origin, AdGuard, Brave all expose the identical
oracle) — it is not gjoa-specific. We mitigate the obvious leaks (the parent
derives the document URL from trusted state, never the content process; the
engine only returns selectors the page's own classes/ids triggered; results are
the deduped union across lists with no per-list attribution), and accept the
residual getComputedStyle side channel as the cost of cosmetic filtering.

## Maintenance

Because these are whole-file overlays, they **shadow** upstream evolution of
the same files. On a Firefox version bump, re-diff against the new upstream
content-classifier and re-apply gjoa's additions (the additions are localized:
search for `cosmetic`, `GetSingleton`, and `GjoaCosmetic`). The unmodified base
is whatever FF version `gjoa.json` pins.
