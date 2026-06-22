## Stewardship: Security

gjoa tracks Firefox 152 and owns ~10 patches + a `src/gjoa/` overlay. The security task is two-sided: **respond fast** when upstream Mozilla ships a fix, and **never let our own mitigations rot** when we rebase onto a new tarball. The governing rule is one line:

> **A rebuild may never silently reintroduce a vulnerability.** Every mitigation — whether it lives in a patch, a source file, or a pref — carries a machine-checked regression assertion that fails the build *before* a 2–3 h compile if the mitigation is gone.

This is enforced by three preflight gates (`tools/scripts/preflight.bjs`), three tracked config anchors, the `tools/security/*` toolchain, and the `about:sovereignty` egress audit. None of it is advisory; `bun run preflight` exits non-zero and CLAUDE.md Rule #2 forbids building past a red gate.

---

### 1. Responding to upstream Firefox security fixes

Cadence is policy, not vibes (`docs/security-policy.md`):

| Trigger | SLA |
|---|---|
| Mozilla point release (152.0.1 → 152.0.2) | 7 days |
| Major release with MFSAs | 48 hours |
| In-the-wild CVE against our pin | same-day |
| Disclosed zero-day | immediate (`security:bump` + rebuild) |

**Detection** (`tools/security/check.bjs`, `bun run security:check`): reads `gjoa.json`'s pinned `firefox.version`, fetches Mozilla product-details (`firefox_versions.json`) for `LATEST_FIREFOX_VERSION`/`FIREFOX_ESR`, and parses the MFSA known-vulnerabilities index for advisories newer than our pin, flagging "exploited in the wild"/"critical". Classifies **OK / STALE / CRITICAL** (exit 0/2/3). It is **fail-OPEN on network error** — losing internet must not block work — and `gjoa status` reports when the probe last *succeeded*, so "verified safe" is distinguishable from "couldn't verify."

**Enforcement at two layers:**
- `bin/gjoa` launcher refuses to start a STALE/CRITICAL binary absent a one-off `GJOA_ALLOW_INSECURE=1`.
- In-process gate (`src/gjoa/chrome/bjs/security/index.bjs`) re-checks every 60 min at chrome-window load; **quits** on major-behind or in-the-wild, warns on patch-behind.

**Bump**: `bun run security:bump` writes the latest stable into `gjoa.json`. The rebase then runs the full ladder — `bun run import` first (so `engine/` reflects `src/gjoa/`), then `bun run preflight`. Because Mozilla refactors signatures every release, the C++/Rust patches are the conflict-prone surface; the Lane-3 doctrine (prefer `.sys.mjs` overlay over Mozilla-source patch — CLAUDE.md Rule #3) exists precisely to shrink what a security rebase has to re-validate.

---

### 2. Keeping our own mitigations from rotting

A mitigation has two failure modes on rebase: a **patch** silently stops applying (the vuln re-opens with no error), or a **source belt** gets edited/deleted in an unrelated refactor. gjoa closes both, plus drift, with three gates against tracked anchors.

#### Gate S — security-tagged patch persistence (#120)
A patch that *is* a mitigation declares a `# security:` block (`id`, `refs:` → CVE/MFSA, `mitigates`, `persist`) parsed by `tools/prep/patch-header.bjs` (`parseSecurity`); `patch-header.bjs check` rejects a `# security:` block lacking an `id:`. Gate S then treats such a patch differently from every other:
- A security patch that **fails to apply is a HARD STOP** — never the warn/drift of Gate A. A non-security patch that breaks the cumulative chain is *also* fail-closed (it blocks proving the downstream security patches).
- Each patch's declared `depends-on` upstream anchors are resolved via Gate L's `check-contract`; an unresolved anchor (a Mozilla symbol/path that moved) **fails closed**.
- Missing source tarball ⇒ fail-closed (`bun run download` to populate `~/.cache/gjoa/sources`), so the gate never claims an unverified "applies".

Currently **vacuously green**: zero patches carry a `# security:` block (preflight.bjs:807). The gate *arms automatically* the moment one is added.

#### Gate R — non-patch mitigations intact (#121)
`configs/security-mitigations.json` is a per-mitigation regression manifest. For each shipped mitigation it pins a `file` + `mustMatch` source regexes (the belt/cap/pref is still *present*), and — for a regex-validator mitigation — an `extractRegex` + `mustReject`/`mustAccept` corpus. Two entries ship today:

- **`cosmetic-css-injection-unvalidated-selectors`** (high) → `src/gjoa/toolkit/components/content-classifier/GjoaCosmeticChild.sys.mjs`. Gate R cannot import the file (it `extends JSWindowActorChild`), so it **extracts the regex literal from source text** and re-tests it directly. The shipped belt is `const UNSAFE_SELECTOR = /[{}@<]|\*\//;` + `safeSelector` filtering via `Array.prototype.filter.call(selectors, safeSelector)` — all three pinned in `mustMatch`. The corpus asserts breakouts stay rejected (`a{}`, `x*/y`, `h1{color:red}@import`) and real rules stay accepted (`.ad-banner`, `#promo`, `div[data-ad] > span`). This is the root-cause fix behind commit `6ac9045` (reject CSS-structural chars in cosmetic-filter selectors).
- **`list-scriptlets-default-off`** (high) → `GjoaCosmeticParent.sys.mjs`. Pins that `gjoa.contentblock.scriptlets.listDriven.enabled` is read with a default of `false` — list-driven scriptlets stay opt-in. A flipped default goes RED here.

If the belt is deleted, the `*/` guard dropped, or the pref default flipped, Gate R fails *before* the build. (`tools/security/mitigations.test.bjs` exercises the same extract-and-retest logic without a build.)

#### Gate J — scriptlet bundle integrity
`src/gjoa/toolkit/components/content-classifier/scriptlet-resources.json` holds base64-encoded scriptlet JS run via `evalInSandbox`; Gate J shells `tools/prep/verify-scriptlet-resources.sh`, which recomputes the bundle digest and HARD-FAILS on drift from the SHA-256 pinned in that verifier + `scriptlet-resources.PROVENANCE.md` (finding F10). So the scriptlet payloads injected into content can't change unreviewed — a real supply-chain surface, since these execute in the page. Curated-only by policy; list-driven scriptlets stay opt-in behind Gate R's `list-scriptlets-default-off`.

#### Gate P — patch-hash drift (#104a)
`configs/patch-hashes.json` records the expected SHA-256 of every `patches/*.patch`. Gate P recomputes each digest and HARD-FAILS on any mismatch, any patch missing from the manifest, or any manifest entry whose patch was deleted. A patch cannot change — or appear/vanish — without a review-gated manifest update; that *is* the point. (Distinct from the aggregate `gjoa.build.engine-patch-hash` that `fingerprint.bjs` bakes into the binary for provenance.)

---

### 3. Disclosure that can't lie

The `# security:` headers feed `configs/security-patches.json`, regenerated by `tools/security/patch-disclosure.bjs` (`bun run security:patch-disclosure`), **wired into the import flow** (`tools/prep/import.bjs`, `regen-patch-disclosure!`) next to the sovereignty manifest. Because it's *generated*, it can't drift: a dropped or retitled security patch surfaces as a diff in a tracked file. Each entry records `{id, refs[], mitigates, persist, file, sha256, applyStatus}`, where `applyStatus` comes from the same cumulative-apply probe Gate A/S use ("unknown (no cached source)" when the tarball isn't cached — never a fabricated "applies"). The current correct state is an **empty list with an explanatory note**: the honest baseline.

A regressed mitigation is also logged in the findings ledger (`private-docs/security-findings.edn`, gitignored) with `:status "open"`, and `tools/security/audit-ledger.bjs findings` re-surfaces it until the patch is regenerated. The ledger ↔ manifest cross-check warns if a `mitigated`/`fixed` finding has no Gate-R entry — so a claimed mitigation with no regression assertion is itself flagged.

---

### 4. The egress trust surface (`about:sovereignty`)

`src/gjoa/.../sovereignty/` ships a privileged `about:sovereignty` page rendering a **source-derived egress audit** (`manifest.json`), checked against the running build's commit. It catalogs every network call the build can make — classified `unattendedExternal` / `userEnabledNetwork` / `local` / `unproven` — plus `inheritedEgress` (15/17 Firefox built-in egress vectors disabled by default; SafeBrowsing deliberately kept for security). The current claim: **one unattended external call — the Firefox version check** (the security probe in §1). The badge "degrades honestly": it reflects real current egress, the most conservative true statement, never rounded up to "zero egress". If the audit's commit lags the build, it says so rather than overclaiming.

---

### Why this is structural, not heroic

The maintenance thesis is to leverage structure so a fast response stays *safe*. Concretely:
- **Tracked anchor + gate** is the recurring pattern: `patch-hashes.json`/Gate P, `security-mitigations.json`/Gate R, `# security:` headers/Gate S, the generated `security-patches.json` disclosure. A mitigation is never just code — it's code *plus a committed assertion that the code is still there*, checked on every preflight.
- **`baseline-firefox:` headers** (`patch-header.bjs`) turn a rebase conflict from archaeology into a 3-way merge: pull the recorded baseline tarball, diff `touches` against the new version, replay our delta.
- **Lane discipline** (CLAUDE.md Rule #3) keeps the security-critical surface small: chrome JS conflicts ~never, `.sys.mjs` overlays per major version, native patches per release. The cosmetic-selector belt living in a `.sys.mjs` (Gate R), not a C++ sink patch, is exactly this choice paying off.

**Net:** a Firefox security bump runs `security:bump` → `import` → `preflight`. Gates P/R/S are part of that mandatory preflight. A bump that breaks a security patch, deletes a belt, flips a default-off pref, or silently changes a patch **cannot reach a build** — and the disclosure artifact makes any such drop visible as a tracked diff.
