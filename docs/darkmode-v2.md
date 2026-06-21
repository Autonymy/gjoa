# Dark Mode v2 — The Legibility-Channel Frame Shift

**Status:** Canonical plan. Supersedes `docs/darkmode-v2-plan.md` (commit 45fdc63),
which is absorbed below. Derived, not designed — every architectural decision is a
theorem of three postulates about the eye, not a choice. This document is structured
in the style of `fram/docs/WHY_FRAM_EXISTS.md`: a verdict, the atom, the forced
derivation, the architecture as theorems, the negative space, and a decision record
with falsification conditions.

**Revisit policy:** This theory may only be retired by *refuting it in its own terms*
(see the Decision Record). It may not be retired because a cheaper transform benchmarks
well on achromatic prose, nor because "inversion is simpler." Those are pre-answered.

---

## Verdict (one sentence)

The atom is **luminance-channel figure/ground discrimination at the dark-adapted eye** —
reading is one brightness wire resolving a glyph's edge against the surface *actually
behind it* — so dark mode is **forced** to be the maximal downward translation of the
luminance frame that still holds every figure/ground pair inside a glare-bounded band,
solving **surfaces-first-then-text**, holding the two identity (chroma) coordinates fixed;
every other piece (OKLab, APCA, the ~#121212 floor, the ~Lc 90 ceiling, never-touch-photo,
the tiers) is a theorem of that one anatomical fact plus the night cost, not a designer's
choice.

---

## Part I — The Theory

### The atom (the turtle at the bottom)

Reading is figure/ground discrimination performed by the eye's **one achromatic
(luminance) opponent channel** — the only channel with the spatial-acuity bandwidth to
resolve a glyph edge. So a screen color, *to a reader*, decomposes into **one legibility
coordinate** (luminance) orthogonal to **two identity coordinates** (chroma/hue). The
relation is irreducible because:

1. It is a property of an ordered **pair** — (glyph-region, the region actually behind
   it) — evaluated by a nonlinear sensor. A single color carries **zero** bits of
   readability. One hand cannot clap; a gray card has no readability until you say "on
   *what*?"
2. It is **signed** — which is figure, which is ground — because dark-on-light and
   light-on-dark are different perceptual regimes near black.

Beneath this is only human vision at the night operating point, which we do not get to
redesign. That is the turtle: **reading = the brightness wire discriminating a signed
edge across a pair.**

### The three postulates

- **P1 — THE EYE'S BASIS (reading lives on one wire).** Vision encodes a surface as one
  legibility coordinate (luminance) orthogonal to two identity coordinates (chroma/hue,
  which carry identity, not legibility). Reading is recovery of the *signed* luminance
  figure/ground relation across each (mark, real-ground) pair: conserve its sign and its
  perceptual magnitude. This fact alone forces *what may move* (luminance) and *what must
  be conserved* (the two chroma coordinates, and the sign).

- **P2 — THE NIGHT FRAME (darkness is the budget, not the goal).** At low ambient the eye
  adapts to a dark operating point where emitted light is costly (glare, melanopic load,
  energy) **and** discrimination is maximal only inside a two-sided **band**: a floor from
  the contrast-sensitivity function (too little = illegible) and a ceiling from
  glare/halation (too much on a dark-adapted surround scatters in the eye and *smears the
  very edge being read*). Absolute luminance is therefore a frame the operator is
  *obligated to translate downward* — as far as the band tolerates — never a target to
  maximize.

- **P3 — ROLE DIES AT RENDER (freeze before you solve).** Authored intent (which region
  is mark, which is ground, which is a photograph) is destroyed once rasterized to a flat
  pixel buffer. The transform is ill-posed unless evaluated where role still exists
  (layout/paint), and it must be **sequenced**: a contrast relation needs a fixed
  reference, so the ground must be resolved and *frozen* before any mark is solved against
  it. Photographs carry no authored figure/ground relation — they are signal to display,
  not structure to read — so they lie *outside the operator's domain by definition*.

### The forced derivation

**The pixel is the wrong atom — structurally** (the datom-vs-claim move). The quantity
reading consumes (P1) is a property of a *pair*, not locatable in either color alone nor
in any linear function of the pair. So **any per-color operator is blind to its own
success metric by construction** — its domain is single colors, so it literally cannot
read whether the mark is still discriminable from its ground. This is *exactly today's
bug*: patch 0009 inverts per-property at `Color::to_computed_color` (verified: Y→1−Y WCAG
involution, role-blind), so nothing checks the final mark against the final color behind
it, and MIT Press Reader goes dark-on-dark. The same fact forces the **layer**: in
WebRender's flat `ColorF` the pair and the role are gone, so the operator there is *not
slower — it is impossible*, because the operand (the pair) does not exist. The operator is
forced **up** to where role lives (layout / `nsTextFrame` paint, sampling the real
composited backdrop).

- **Hold-hue is a theorem, not an axiom.** Two routes agree: (a) act only on the
  legibility coordinate ⇒ the identity coordinates are untouched; (b) write the minimal
  transform as moving (L, C, h) and note hue *h* enters **no** contrast constraint
  (contrast is luminance) and **no** emission constraint (chroma/hue do not set the night
  budget). A variable absent from every constraint has its minimizer exactly at its
  original value ⇒ **Δh = 0 exactly.** `255−x` is rejected *by stationarity, not by taste*.

- **A perceptually-uniform, hue-separable space is required, not preferred** (OKLab/
  OKLCH/HCT). Acting in RGB shears identity while moving legibility (dark blue → purple) —
  the wrong basis, a different and wrong operator.

- **APCA is the forced instrument, not an axiom.** P2 forces requirement (ii): a contrast
  *metric* that is polarity-aware and honest near black, because the band's edges *live*
  near black. WCAG-2 overstates contrast near black — it would certify illegible
  dark-on-dark as passing. That polarity-aware near-black-honest shape *is* APCA's. Needing
  (ii) is the theorem; APCA is the instrument.

- **Chroma-compression is a basis correction, not a softening.** By Helmholtz–Kohlrausch
  the luminance channel reads saturated chroma as *added* brightness, so to land a mark at
  a target band-luminance you *must* shed chroma — otherwise residual chroma re-inflates
  perceived luminance and the mark drifts out of band.

- **Freeze-surfaces-then-solve-text is forced by convergence.** A joint fg+bg fixed point
  *oscillates* (darken the ground → mark too close; lighten the mark → too bright; round
  forever — a non-contraction, **verified**). A frozen-bg 1-D monotone root-find
  *converges*. P2 pins each surface independently (emission constrains the *ground*
  luminance alone), which is the only thing that breaks the fg/bg coupling. Sequencing is
  *existence-of-a-solution*, not preference. (This is also why a content-side corrective
  applied while the ground transform is still live gets re-inverted — verified: saga
  pre==post 16→16.)

- **The band's two edges, the floor, never-touch-photo, idempotence/tiers** all fall out
  of P1 ∩ P2 ∩ P3 (see Theorems).

### The operator

`RETONE` = a per-document, role-resolved, **sequenced** luminance frame-shift, evaluated
where role and the real backdrop both exist (layout / `nsTextFrame` paint, **not**
WebRender's flat `ColorF`), realized in a hue-separable perceptually-uniform space
(OKLab/OKLCH/HCT as instrument):

0. **Identity gate.** If the document is declared-dark **and measures legible-in-band**
   under P2, return the zero transform (Tier 0). Else:
1. **Partition** by the role the layout resolver still knows — surface / mark
   (text, icon, border) / photo. Photographs, canvas, video, WebGL are **outside the
   domain**: never recolored.
2. **Freeze surfaces.** Map each surface's lightness *monotonically* (sign/order-
   preserving) onto a dark ramp floored at ~#121212 (never #000), holding hue, compressing
   chroma to gamut; **freeze** them.
3. **Solve marks** against the now-constant ground: per mark, a 1-D monotone APCA
   root-find on the *luminance* coordinate to land |Lc(mark, frozen-ground)| inside the
   band [floor ~Lc 60 body / ~45 large … ceiling ~Lc 90], choosing the polarity that
   maximizes APCA against this backdrop, holding hue, compressing chroma (H-K). *This is
   gjoa's proven `snap.js correct(fg, bg, T)`* — polarity-pick + binary-search the minimal
   hue-preserving shift that clears the floor (+3 hysteresis), capped below the ceiling.
4. **Scrim** over role=photo bearing text: a minimal dark scrim (itself a P2 emitting
   surface) re-establishes a ground — patch 0010 as a theorem.
5. **Idempotent throughout:** any pair already in-band and under-budget maps to itself.

Net vs today: patch 0009's reflection but (a) per-**pair** not per-property, (b)
ground-**frozen**-before-mark, (c) band-**clamped** via APCA instead of unbounded, (d)
emitted at the ground-resolved paint stage so the mark solve is never re-inverted.

### Architecture as theorems

Every architectural piece is a *consequence*, not a module chosen for convenience:

| Piece | Forced by |
|---|---|
| Hold hue exactly (Δh=0) | P1 + stationarity (hue in no constraint) |
| Search only lightness (1-D) | P1 (constraints are functions of luminance) |
| Freeze surfaces, then solve text | Convergence (joint fixed point oscillates — verified) |
| Role recovery in layout | "the pair must be solvable" ⇒ must know which is which |
| Two-sided band (floor *and* ceiling) | P1 ∩ P2 (CSF floor; glare/halation ceiling) |
| Soft-dark floor ~#121212, never #000 | P2 (pure black maximizes halation + collapses surface order) |
| Never-touch-photo + scrim | P1+P3 (no pair to conserve) **and** P2 (gratuitous photons) |
| Declared-dark = identity; the tiers | P2 zero-distance case; tiers = the operator's domain partition |
| Chroma compression | Helmholtz–Kohlrausch (saturated chroma reads as luminance) |

### Constants: forced vs confessed-free

**Forced (derived, not chosen):** Δh = 0 (hold hue); monotone reflected lightness order;
surfaces-before-text sequencing; a perceptually-uniform hue-separable space; a
polarity-aware near-black-honest contrast metric; the *direction and necessity* of
chroma-compression; the *existence* of a two-sided band, a near-black floor, and a
size-dependent legibility floor.

**Confessed free (honest debts, like Why-Fram's cardinality concession):**

- Legibility floor numbers (~Lc 60 body / 45 large): *that* a size-dependent floor exists
  is forced (CSF); the values are APCA reading-research calibration. `snap.js` default 45.
- Halation ceiling (~Lc 90) and floor hex (~#121212–#1E1E1E): forced *in kind*, free in
  exact value (display gamma, ambient, individual glare sensitivity unmodeled).
- The native-dark luminance threshold `0.22` (patch 0009): genuinely free **and
  mis-specified** — it approximates P2's identity clause with a frame-1 pixel guess instead
  of reading the `color-scheme` *declaration* and measuring the band. MIT passes 0.22 yet
  fails the band. Replace it (M4).
- The chroma-compression *curve* (perceptual vs clip; HCT vs OKLCH gamut-map); the `+3`
  hysteresis margin; the photo scrim alpha (~0.55); *which library* realizes the space /
  the metric; the retone cache eviction policy (granularity is forced — paint-time
  frame-level, **not** Stylo's rule-keyed cache — eviction is free).

### Negative space (what this is NOT)

- **NOT darkness.** Darkness is the *budget* (P2), spent, never the target. A maximally
  dark illegible page has *failed*.
- **NOT inversion.** `filter:invert` / `255−x` / Y→1−Y is one cheap lossy realization that
  approximates the operator on achromatic prose and *diverges* wherever a real backdrop
  enters — precisely MIT. Inversion is a degenerate special case, not the thing.
- **NOT a per-color decision.** No function of a single color can be dark mode; the
  quantity to conserve is a property of a *pair*. The whole filter family is blind to its
  own success metric.
- **NOT a WebRender/compositor transform.** The pair and role are gone at `ColorF`;
  placing the operator there is impossible, not merely slow.
- **NOT "OKLab/APCA are better color science."** They are the *forced shape* of any
  instrument honoring P1 and P2. A better instrument would not change the theory; the
  libraries are not axioms and must never be resurrected as authority.
- **NOT WCAG-AA compliance.** WCAG-2 is actively wrong near black; passing it is neither
  necessary nor sufficient.
- **NOT taste.** "Softer greys look nicer" is a downstream description of the minimizer's
  output. Pure black is harsh *because of halation at the dark-adapted operating point*
  (P2), not because designers dislike it. The floor is physics.
- **NOT a floor with a safety margin — a two-sided band.** Erase the upper edge and the
  white-on-black bug returns.
- **NOT a lift of the RGB lerp-toward-white/black solver into tone space** (refuted): it
  drifts hue and is non-monotone across the polarity crossing — a different, worse
  operator; the tone-space retone must be authored *fresh*.

### Teaching (the napkin)

> Your eyes read with mostly **one wire** — the brightness wire. It's the only one sharp
> enough to see the *edge* of a letter; the color wires are blurry, they only tell you
> *what* color a thing is, never exactly where its edge sits. So reading is really just:
> is this letter brighter or darker than the paper right behind it? That's the whole
> secret — and it's always about a **pair**, a letter *and* its paper, never one color
> alone. (Hold up a gray card: "can you read it?" has no answer until you say "on
> *what*?" One hand can't clap.)
>
> That's why the lazy trick — "flip every color, 255 minus each number" — isn't just
> worse, it's *wrong*: it looks at colors one at a time, so it literally can't see whether
> you can still read, and it yanks all the wires at once, turning a blue link into mud.
>
> The right way, in order, every step forced: **First**, turn the lights down — that's all
> dark mode is, dimming the brightness wire for night — but *don't touch the color wires*,
> so a blue link stays blue, only sliding lighter or darker until it reads. **Second**,
> keep every letter in a comfortable *band* against its paper: not too close (can't read
> it) and *not too far* either — pure white on pure black at night **glows and smears**
> your eyes (halation), so use a soft almost-black page (never pitch black — black is a
> hole where letters bloom) and a not-quite-white letter. **Third** — the one people miss
> — do the *paper* first, freeze it, *then* pick each letter; move both at once and they
> chase each other in circles forever. Freeze the paper and there's exactly one right
> brightness for each letter. And **photos**? Leave them completely alone — a photo isn't a
> letter on paper, it's a window; you only dim it with a sheet of smoky glass on top.
> **Last**: if a page already came dressed in dark and you can read it fine, do *nothing*.
>
> Everything fancy — OKLab, APCA, tiers — is just the careful way to do these few things
> without lying to your eyes. That's the whole thing.

---

## Part II — The Engineering

Grounded against the real FF152 tree (`engine/`), adversarially reviewed (two
load-bearing claims were refuted and folded in below).

### Where it hooks (FF152, exact)

Role is recoverable *per layout resolver* — the resolver that asks for a color *is* the
role — and these resolvers feed **both** the WebRender and the gfx-fallback/print paths:

- **Text/foreground:** `engine/layout/generic/nsTextPaintStyle.cpp` `GetTextColor()` —
  the one function that knows "this nscolor is text fg"; flows to both `PushText` (WR) and
  the gfx fallback via the same `SetColor`. *Order against `EnsureSufficientContrast`
  (the existing a11y bump) so the retone isn't double-corrected.* **Separately hook**
  `mSelectionTextColor` / `mTextEmphasisColor` / `mTextDecorationColor` — the adversarial
  pass confirmed these bypass `GetTextColor` and would otherwise go un-retoned.
- **Background/canvas:** `nsDisplayList.cpp` `CreateBackgroundColor` — transform `aColor`
  so the stored `mColor` is already retoned.
- **Solid / border / gradient / SVG-fill:** `nsDisplaySolidColor` (has `OverrideColor`),
  `nsCSSRendering` border resolution, `nsCSSRenderingGradients` stop baking,
  `SVGGeometryFrame.cpp:784`.
- **Tier-0 pre-paint gate:** `nsPresContext::ApplyHybridDefaultInvertIfThemeless`
  (`PresShell.cpp`), re-keyed from the `lum≥0.22` pixel sniff to the *declared*
  `color-scheme` bit read from **`StyleUI()->mColorScheme.bits`** (the adversarial pass
  showed `Document::mColorSchemeBits` is `<meta>`-only and misses CSS `:root{color-scheme}`
  — the majority case), with an APCA-pass backstop for broken declared-dark themes.

### Reconciliation with v1 (extend, don't rip out)

- **Keep (load-bearing v1 plumbing):** patch 0009's per-document gate
  (`nsPresContext::mColorInversion` + `ColorInversion()` + the per-top-`BrowsingContext`
  `ColorInversionOverride` IPC/webidl + the `gjoa.darkmode.*` prefs); patch 0010's island
  scrim (`SELF_OR_ANCESTOR_HAS_IMAGE_BACKDROP`) — it *is* the photo-exclusion + scrim hook,
  now a theorem; the `GjoaDarkmode` actor (Tier-2 owner, no-FOUC sync override); `snap.js
  correct()` — the proven per-mark APCA solver, *lifted not rewritten*.
- **Change:** the transform *core* moves from v1's WCAG Y→1−Y luminance flip to the
  role-aware OKLCH retone; its *location* moves from the role-blind Stylo hook to the
  per-role layout resolvers; the APCA solve moves from post-paint JS to paint-time against
  the frozen backdrop.
- **Retire:** the `filter:invert` chrome CSS (naive full-frame, superseded).

### The milestone ladder (each tied to the postulate it serves)

The non-negotiable discipline: **prove the math in JS on the 226-site harness before
spending a single Lane-3 build on the C++ paint hook.**

**Status (2026-06-21):** M0 ✅ (`colormath.js` + 11-test gate, wired into `bun run test`).
M1 ✅ committed `patches/0012` (role choke-point, identity-gated). M2 ✅ committed `fb23599`
(fixes DB 2→69, 6-agent quality-gated). M3 ✅ committed `patches/0013` (`GjoaDarkText.{h,cpp}`
= the colormath port, hooked at `nsTextPaintStyle::GetTextColor`) — **first engine build in
progress**. M4 (Tier-0 color-scheme bit) in progress. M5 pending (after M3/M4 verify). Note:
the engine build runs `GjoaDarkText` directly at `nsTextPaintStyle::GetTextColor` — the draft
found `mFrameBackgroundColor` already carries the opaque ancestor-composited backdrop, so the
"hardest risk" (backdrop acquisition) was already solved by an existing primitive.

| M | Title | Serves | Lane | Build? | Gate |
|---|---|---|---|---|---|
| **M0** | OKLCH retone + tone-space APCA band-solve proven in `snap.js`/`apply-correctives.js` (replace the RGB extreme-walk with hue-fixed/chroma-clamped tone bisection + ~Lc 90 ceiling) | P1+P2 instruments | 1 | no | corpus PASS beats the engine-mode baseline (109/65) with no new \|Lc\|<45 fails; correctives-per-site trend down |
| **M1** | Role resolver in layout (surface/text/border/icon/photo) — the precondition for freezing surfaces | P3 | 3 | yes | role resolves at each hook; chrome UI un-retoned |
| **M2** | Tier-2 fixes DB expanded 2→~50–150 from Dark Reader's config + new override primitives (`noInvert`/`removeBg`/`ignoreImageAnalysis`); image `color_buckets_ratio` photo-vs-icon discriminator promoted to core | P3 / domain partition | 1 | no | per-fixed-site visual QA; photos untouched, icons counter-retone |
| **M3** | Surfaces-first **freeze** onto the dark ramp (floor ~#121212), then `correct()` at `nsTextFrame` paint against the **frozen composited backdrop**, cached frame-level (**not** ComputedValues — refuted) | Convergence theorem | 3 | yes | full corpus A/B beats M0's JS numbers; print/WR parity; no re-inversion |
| **M4** | Two-sided **band** clamp (add the halation ceiling the current build lacks) + tiers as domain partition (replace the 0.22 proxy with declaration+band measurement) | P1∩P2 band | 3 | yes | zero marks above the ceiling; declared-legible-dark sites render native (zero correctives) |
| **M5** | Retire `filter:invert`; fold modes; close patch 0010's scrim as the P2 photo surface | idempotence | 1 | no | all modes resolve to a tiered path; harness green; BUILD-LEDGER updated |

### The adversarial corrections (what reshaped the plan)

The foundation's own refutation pass changed three things and they are now baked in:

1. **The tone-space solver is authored fresh, not "lifted."** v1's `correct()` LERPs the
   whole RGB triple toward white/black — it drifts hue and `|Lc|` is *non-monotone* across
   a polarity crossing. M0 specifies a *new* solver (search L only, hold H, clamp C,
   gamut-map C down) and re-proves it from scratch; keep one canonical APCA+solver shared
   by harness and engine so "measure == fix" survives.
2. **The retone cache is paint-time frame-level**, keyed by (input-color,
   sampled-backdrop-bucket) — *not* Stylo's rule-keyed `ComputedValues` cache, which has no
   color/role/backdrop dimension and where "role" doesn't exist. M3 owns this cache.
3. **OKLCH vs HCT is a measured decision, not assumed.** OKLCH is the default (zero new
   crate; HCT's `hct_cam16` would force a `Cargo.lock`/cargo-vet/`--frozen` cost — gjoa was
   burned by exactly this in `be69f4d`). The harness gains a hue-drift metric (below) so
   "competitive with HCT" becomes *testable* before commitment, not asserted.

### The harness + four new falsification metrics

Today `tools/darkmode-regress/` (226 sites — see Part III) measures **only** APCA `|Lc|`
pass/fail at `<45`. The theory's two sharpest claims — the band's *upper* edge and
hold-hue — are currently **unfalsifiable**. Top backlog: add to the harness —

1. **Hue-drift** (ΔH in OKLab per transformed mark): retone ⇒ ~0; per-color flip ⇒ large
   on chromatic content. Makes hold-hue testable.
2. **Two-sided band / mistone:** flag any surface below the floor *or* any mark above the
   ceiling as a **halation fail**. Today pure-white-on-near-black (`|Lc|~106`) *passes*; it
   must *fail*.
3. **Sign/polarity** against the *real composited backdrop*: catches the monotone-but-
   sign-flipping map that scores high on unsigned `|Lc|` yet reads inverted — the MIT
   dark-on-dark bug the `|Lc|`-only metric is blind to.
4. **Convergence:** assert surfaces-frozen-first terminates while a joint solve oscillates
   (instrument the root-find iteration count).

### Harness status — what runs Lane-1 today vs what is build-gated (P2)

The contrast/APCA harness splits cleanly along the Lane boundary, and the split is
the honest answer to "is quality measured or asserted?":

- **Lane-1, green today (no binary):** the canonical color math —
  `tools/darkmode-regress/colormath.js` + `colormath.test.js` (11 tests, 99
  assertions) and the pure scorer `tools/test-driver/contrast-score.bjs` — are
  pure functions, unit-tested with **zero running binary**, and wired into
  `bun run test` (`test:unit`). This is the floor under every later engine change:
  the APCA/OKLab math the engine and the harness share is regression-gated now.
- **Lane-3, build-gated (the actual P2 block):** the end-to-end oracle —
  `tools/darkmode-regress/runner.bjs` and the test-driver `darkmode` / `contrast`
  subsystems — drive a **built gjoa binary** under Marionette (it spawns
  `<gjoa-bin>` and `drawSnapshot`s composited pixels). It therefore needs a Lane-3
  build (`nix build` or mach + `nix develop .#mach`) before it can run; it cannot be
  unblocked from chrome JS. This is *not* a chrome-side bug to fix — it is an
  inherent dependency on a compiled engine, because the thing being measured (the
  cascade-time inversion + paint-time text solve) only exists in the binary.
- **The known content-context limit** (noted in the executive report): inversion
  detaches the content `BrowsingContext` handle, so the harness measures via
  chrome-side `drawSnapshot` of the *composited* result, not a content-context
  read — `runner.bjs` already does exactly this (it `setContext`es to `chrome` for
  the snapshot). So that limit is already worked around in the harness design; what
  remains is purely the build dependency above.

**Net P2 conclusion:** the Lane-1 portion of the harness is unblocked and green; the
remaining gap is a Lane-3 engine build to run the end-to-end oracle, which is out of
scope for a chrome-only change and is sequenced behind the M3/M4 engine builds.

---

## The escape-hatch hierarchy (how to override dark mode on a site)

Dark mode is layered: a global default you can shift, then progressively narrower
overrides for the sites the general path gets wrong. The layers compose — each one
overrides the layer before it — so you reach for the *narrowest* hatch that fixes
your problem and leave everything else on the smart default. From broadest to
narrowest:

1. **Global mode** — `about:gjoa` → Dark mode section → **Mode**
   (pref `gjoa.darkmode.mode`). The top-level switch for *how* pages get dark:
   - `system` (default) — follow the OS theme. Dark OS → always-dark (native-dark
     sites use their theme, the rest are engine-inverted); light OS → sites render
     as authored.
   - `hybrid` — always dark regardless of OS (same native-or-invert split).
   - `auto` — only sites that ship their own dark theme go dark; nothing is inverted.
   - `engine` / `filter` / `off` — legacy / debug modes, reachable only by setting
     the pref in `about:config` (not surfaced in `about:gjoa`).

2. **The "how dark" knobs** — still global, but tune the *output* rather than the
   strategy: **Darkness** (`gjoa.darkmode.invert.bgLightness`, the OKLCH-L floor
   inverted pages land on) and **Scrim strength** (`gjoa.darkmode.scrim.alpha`, the
   darkening over full-bleed background photos). Both in `about:gjoa`. Their advanced
   companions — the light-text ceiling `gjoa.darkmode.invert.fgLightness` and the
   APCA contrast floor `gjoa.darkmode.normalize.floor` — live in `about:config`.

3. **Per-site overrides** — `about:config` host lists (comma-separated), applied in
   `hybrid`/`system`-dark by `GjoaDarkmodeParent`. Precedence within this layer:
   `off` > `force-invert` > `force-native`.
   - `gjoa.darkmode.user.force-native` — *keep the site's own look*; never invert it
     (use when inversion makes a site you like worse).
   - `gjoa.darkmode.user.force-invert` — *always invert this site*, even if it claims
     a dark theme (use when a site's "dark" theme is broken).
   - `gjoa.darkmode.user.off` — *no dark-mode treatment at all* for this site.

4. **The curated per-site fixes DB** — a built-in, shipped database of per-host CSS
   overrides and invert-selectors (a Dark Reader v4.9.127 MIT port). This is the
   pre-tuned escape hatch for sites the general path gets wrong, applied
   automatically; you don't configure it per-site, but it is the reason most tricky
   sites already look right without a manual `user.*` entry.

5. **The engine layers** — the lowest level, not user-facing knobs but the mechanism
   the above ride on: tier-0 native-dark detection (leave declared-dark sites alone),
   the style-resolution-time color inversion (cached in the cascade), the island
   scrim over photos, the role resolver, and the paint-time APCA text solve. A site is
   handled by whichever engine layers its mode + overrides select.

**Rule of thumb:** wrong globally → change **Mode** or **Darkness**; one site too
dark / not dark / double-inverted → a `user.force-native` / `force-invert` / `off`
entry for that host; a site the general path mangles → it is probably already in (or
belongs in) the curated fixes DB.

---

## Part III — The corpus

`tools/darkmode-regress/corpus.json` — **226 sites**, expanded with 52 failure-mode-tagged
content sites (the v2 classifier stress cases): `owns-dark-mode` (Tier-0 back-off, must not
double-invert), `white-header` (the MIT class), `hero-photo` (never invert the photo),
`code-syntax`, `svg-diagram` (icon-vs-photo on canvas), `near-black-text`, `gradient-ui`,
`transparency-composite`. Each milestone gates against the relevant slice; M2's image work
gates against the photo/SVG slices; the Tier-0 gate against `owns-dark-mode`.

---

## Prior art & honest caveats (the not-a-crank check)

Each load-bearing pillar was verified against published literature/standards. None is
invented; three are textbook, three are real-but-debated. The caveats below are folded
into the theory's own honesty (the atom is already stated as "a calibrated bet";
APCA/OKLab as "instruments"; the band numbers as "confessed free").

- **Reading rides the luminance channel** — *well-established.* The achromatic channel
  is band-pass and carries edge acuity; the chromatic channels are low-pass (Mullen 1985,
  *J. Physiol.* 359:381–400; Legge et al. 1990; Knoblauch et al. 1991). *Caveat:* "one
  wire" is an idealization — chromatic channels still resolve to ~11–12 cpd and isoluminant
  text reads at ~300 wpm; and do **not** claim a specific magno/parvo wiring (contested,
  Skottun 2003). Rest the weight on the psychophysical channel result, not a pathway story.
- **OKLab/OKLCH perceptual, hue-separable space** — *well-established.* Ottosson (2020);
  CSS Color 4; ships in browsers. *Caveat:* "roughly hue-uniform," not hue-exact — OKLab
  holds hue well but is slightly worse than IPT/ICtCp on Ottosson's own metric. "Hold hue
  exactly" means *hold the OKLab h coordinate exactly* (which we do); perceptual hue
  constancy is excellent but not literally perfect.
- **Paint-time, role-classified auto-dark (photos excluded)** — *well-established prior
  art*, so the architecture is not novel/crank: Chromium `DarkModeFilter` (ElementRole
  {kText,kListSymbol,kBackground,kSVG}), Android force-dark. *Caveat:* Chromium gates on
  fixed brightness *thresholds*; gjoa's contribution is replacing those with a perceptual
  **band-solve** (APCA) + perceptual **retone** (OKLCH) — that's the delta, stated honestly.
- **APCA / polarity-aware contrast** — *supported-but-debated.* APCA is a real, recognized
  model and the polarity asymmetry (dark-on-light vs light-on-dark) is peer-reviewed
  (Buchner & Baumgartner 2007; Piepenbrock et al. 2013/14); WCAG 2's symmetric ratio is
  genuinely poor near black. *Caveat:* APCA is **not** a standard — it was a WCAG 3
  candidate, removed from the draft in 2023, non-normative as of 2026. Use it as the
  instrument; never imply it is The Standard.
- **Helmholtz–Kohlrausch (compress chroma)** — *supported-but-debated.* The effect (chroma
  reads as added brightness) is established. *Caveat:* the magnitude is strongly
  hue-dependent (large for blue/red, ~nil for yellow), so the *direction* of
  chroma-compression is forced but a single fixed magnitude is not — exactly why the
  compression curve is a confessed free parameter, not a derived constant.
- **Soft-dark floor / avoid pure-white-on-pure-black** — *supported-but-debated.* Polarity
  and glance-legibility effects are measured (Dobres et al., *Applied Ergonomics*); the
  ~#121212 floor is Material Design guidance. *Caveat:* "halation" is a motivating
  mechanism, not a separately-quantified outcome in the legibility studies — so the floor
  and ceiling are well-motivated design bounds whose *exact* values are confessed free, not
  hard physical constants.

---

## Decision Record

**Decision:** Build dark mode v2 as the Legibility-Channel Frame Shift — a per-pair,
surfaces-frozen-first, hue-held, band-clamped luminance frame-shift at the role-resolving
paint layer.

This is correct as long as the atom holds. To overturn, **refute one of these in its own
terms** (not with "a simpler thing benchmarks better"):

1. A page whose every (mark, real-ground) pair is sign-preserved and in-band, under
   budget, yet read *worse* than naive Y→1−Y by a sighted reader at low ambient ⇒ the atom
   (P1/P2) is incomplete.
2. A two-axis operator (luminance **+ one chroma axis**) measurably beats the single-wire
   model at figure/ground discrimination with hue held ⇒ refutes P1's single-channel claim.
   *(This is the theory's sharpest exposure, and it owns it: chroma-contrast is a weak
   independent channel for some readers/content — the single-wire atom is a calibrated
   bet, honestly falsifiable.)*
3. Freeze-surfaces-then-solve fails to converge on a real page, **or** a joint fg+bg solve
   is shown to converge ⇒ refutes that convergence forces the ordering.
4. A measurable hue rotation improves the reader map vs holding hue at equal contrast ⇒
   refutes Δh = 0.
5. Recoloring a photograph (not merely scrimming it) measurably improves reading ⇒ refutes
   never-touch-photo and the relation-only atom.
6. A declared-dark page that *passes the band* still needs transformation ⇒ refutes the
   idempotence theorem.

Absent a refutation, every decision in Part I is forced, and Part II is the buildable
shadow it casts.
