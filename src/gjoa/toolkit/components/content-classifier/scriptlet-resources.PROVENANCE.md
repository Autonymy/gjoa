# scriptlet-resources.json — provenance & integrity

`scriptlet-resources.json` is a vendored, uBO-derived library of scriptlet /
redirect resources (163 entries: 52 `fn/javascript` + 111
`application/javascript`). Each entry's `content` is **base64-encoded
JavaScript** that the RS client hands to
`nsIContentClassifierService.setScriptletResources(json)`; adblock-rust then
expands `+js(...)` cosmetic rules into scriptlets that are **executed in a
content sandbox via `evalInSandbox`**. Because this bundle is *executable code on
the privileged side of the blocker*, its provenance and integrity matter — a
swapped or tampered bundle would inject attacker-controlled JS into pages.

This file records where the bundle came from and how to verify the committed copy
has not changed. It deliberately does **not** alter the shipped JSON.

## Source

- **Upstream project:** uBlock Origin (uBO)
- **Repository:** https://github.com/uBlockOrigin/uBlock
- **Harvested from commit/tag:** **UNKNOWN** — the bundle was committed to gjoa in
  `710615f` (2026-06-18, "feat(adblock): list-driven scriptlet engine — true
  uBlock +js() parity") as "harvested from uBlock Origin" without recording the
  source revision. This **MUST be pinned at the next refresh**: record the exact
  uBO commit SHA (or release tag) the bundle is regenerated from, so the JS we
  ship to `evalInSandbox` is reproducible from a known upstream point.

## Schema

- **adblock-rust schema version:** `0.12.1`
  (matches `adblock = { version = "0.12.1", ... }` in
  `patches/0008-content-classifier-cosmetic-filtering.patch`; the resource shape
  — `{ name, aliases, kind: { mime }, content (base64) }` — is what
  `Engine::use_resources` deserializes).

## Integrity

- **Committed SHA-256:**
  `f27354411da54d8a34438f542dcf0694ecd1dd4ab961f0a68de2b29f76f6dc56`
- **File:** `scriptlet-resources.json` (this directory)

Verify the committed JSON still matches the recorded hash with:

```sh
tools/prep/verify-scriptlet-resources.sh
```

(wired into `bun run preflight`). The hash above is the single source of truth —
if the bundle is legitimately refreshed, regenerate it from a **pinned** uBO
commit, update both the "Harvested from commit/tag" line and this SHA-256, and
re-run the verifier.
