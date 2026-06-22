# Autonomous session — 2026-06-22

Tom's directive: "queue everything up and do not stop until you have literally
no next actions; use your absolute best judgment on every decision; document
each decision here for later review; do not ping me." Standing constraint from
earlier this session: **do everything, but DO NOT cut a release / build** without
it being genuinely safe — and a build is currently unsafe (see B1). This log is
the promised decision record.

## Triage (what's autonomously doable vs blocked-on-Tom)

**Build-safety gate (B1) — discovered first, governs everything below.**
`git status` shows uncommitted edits in the SHARED worktree that are NOT mine
this session: `package.json`, `src/gjoa/.../sovereignty/manifest.json`, and an
untracked `tools/dm-driver/`. Per the shared-worktree rule, *a build bakes
everyone's uncommitted edits*. Therefore I will not trigger any mach/nix build —
that's correctly a Tom decision (consequential, outward-facing, and would bake
cross-agent WIP). All build-gated tasks are documented + queued, not executed.

### DOING autonomously (Lane 1 / tooling, no build):
- A. Vim hotkeys fire while typing in about:gjoa forms — FIX (decision D1).
- B. Dark-mode architecture diagram: self-review (DONE — folded 7 corrections),
     then build the CODE GENERATOR + drift gate so it can't rot (Tom's explicit
     "generate it, don't hand-draw it").
- C. #128 patch-order analysis tool (tool + gate; the renumber itself is Lane 3).
- D. #121 security anti-rot — finish the non-build-gated portions.
- E. Commit my own isolated, finished work per-file (no push, never `git add -A`).

### BLOCKED on Tom (documented, queued, NOT executed):
- #118 build + re-cut v0.4.1 — needs a build + release sign-off + a clean
  worktree (B1). Recommendation recorded at end.
- #128 the one-time renumber — Lane 3 (changes apply order → needs a build).
- #121 css-validation Cargo feature — build-gated (servo selectors).
- #113 nix-native beagle pin — unbuilt draft, deferred.

## Decisions

### D1 — SUPERSEDED by D1' (Tom's correction). Original (wrong) approach below for the record.
Tom stepped in: "Bailing out of the about pages is NOT the solution — that was the
PaleFox-era crutch for when we lacked privileged access. We own the browser now.
EVERY about page should work with vim keys, and the state manager should know 'am
I editing a form right now'." So the URL bail is wrong; the editable-focus detector
must be made universal. Reverted the bail-list addition.

### D1' — Universal editable-focus state manager (the correct fix)
**Root cause (unchanged):** about:gjoa/knobs/sovereignty (and about:config, about:preferences)
are PRIVILEGED parent-process pages. The content-focus detector is a CONTENT-process
frame script (`content-focus.bjs`), which never runs in the parent process — so it
never reports these pages' editable focus, and chrome activeElement is the <browser>.
**Fix (Lane 1, no build):** because these pages are parent-process, their document is
directly readable from chrome via `browser.contentDocument`. Add a same-process
direct-read path to `contentInputFocused`: walk `contentDocument.activeElement`
(through shadow roots) and test editability with the same predicate the frame script
uses. Content-process pages keep using the frame-script cache. One detector, all pages.
**Bail list:** emptied — the state manager now answers "am I in a form" on every page,
so URL-bailing is obsolete (the machinery stays as an escape hatch, list empty).
**Verify:** harness — about:gjoa form typing suppresses vim AND about:gjoa vim-nav
works; about:config search box suppresses vim (a Firefox privileged page, proves
universality). Verdict recorded after the run.

### D2 — Dark mode "black-on-black" (Tom's news.mit.edu screenshot, the recurring pain)
**Root cause (proven, not guessed):** the APCA contrast normalizer — the dark-mode
"no-black-on-black" backstop that drawSnapshots real pixels and re-tones sub-floor
text — was shipped DISABLED (`normalize.enabled=false`). Measured on news.mit.edu via
tools/darkmode-regress: normalize OFF = 7/9 text elements black-on-black; normalize
ON = 0/9. The detector existed AND a suite measures it; we shipped the detector off
and the corpus (226 mainstream sites) never included a hard mixed-theme page like
MIT, so the suite was green while the real page was unreadable.
**Fix (landed):** normalize.enabled -> true (baked default + set-darkmode-defaults!,
Lane-1 so `gjoa sync` flips it on already-built binaries). Added news.mit.edu to the
corpus. Verified 7->0 and viewed the rendered PNG (legible). Follow-up hardening
queued as task #129 (gate the suite on the SHIPPED config; expand hard-page corpus;
wire a CI subset; measure normalizer cost).

### D1 (original, WRONG) — Vim suppression on about:gjoa via URL bail
**Root cause (verified):** about:gjoa/knobs/sovereignty are PRIVILEGED chrome-UI
pages — `settings.js` touches `globalThis.Services.prefs` directly, so they run
in the parent/privileged process. The content-focus frame script
(`content-focus.bjs`) only injects into CONTENT processes, so it never reports
the editable-focus state of these pages. Meanwhile the chrome `document.activeElement`
is the `<browser>`, not the page input — so both existing guards in
`setup-global-keys` pass and vim dispatches the key. The user types "youtube" and
single-key/leader bindings fire.
**Fix:** add the three privileged gjoa UI pages to `PRIVILEGED-BAIL-URI-PREFIXES`
in `vim.bjs` — exactly how `about:preferences`/`about:config` already bail. This
is deterministic (URL-prefix, no process/timing dependency) and matches Tom's
explicit requirement ("on the about pages they need to be able to type").
**Scope decision:** NOT bailing on about:newtab/about:home — verified the gjoa
newtab has only a clock/date, no text inputs, and it's a primary surface where
leader bindings are wanted. The frame-script path remains the general solution
for real content pages (chat apps, search boxes).
