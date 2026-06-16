# Why Beagle for gjoa — the honest case vs TS/JS

This document makes the case that authoring gjoa in Beagle (`.bjs`) was the right
call over TypeScript/JavaScript. It leads with what is **measurable and
undeniable**, and it is honest about what is *not* a win — because a claim that
overreaches is one sentence away from being dismissed.

## TL;DR

The win is **not raw line count**. It is three things TS structurally cannot do,
plus targeted compression where boilerplate actually exists:

1. **Compile-time macros** — a zero-cost domain abstraction layer. TS has no macro system.
2. **One typed language across the entire stack** — chrome JS, the ESM bootstrap module, build tooling, tests, Firefox pref files, and the Nix config. TS can author exactly one of those layers.
3. **Targeted boilerplate collapse**, proven in a controlled experiment (the test suite).

---

## What is NOT a win (honesty first)

- **Raw LOC is a wash.** Beagle source is often *the same size or larger* than the
  JS it emits — inline types (`:- T`), `;;` comments that don't survive emit, and
  Lisp's one-form-per-line verticality all cost lines. The chrome layer is **7,934
  LOC of `.bjs` source → 5,946 LOC of emitted JS**. Beagle is not "fewer lines."
- **Cross-codebase LOC vs the old TS (palefox) is confounded.** gjoa does strictly
  more (SQLite history, Spaces, multi-window sync), the archive has multiple
  iterations of each file, and formatting conventions differ. Any single
  beagle-vs-TS ratio from it is cherry-picked. We don't headline one.
- **Performance is a wash.** Chrome JS runs in the same SpiderMonkey whether it
  came from Beagle or TS; Beagle emits ~the same JS. The only real edges are small:
  macros inline (zero-cost) where a TS helper `byId()` is a runtime call, and
  Beagle emits clean modern ESM with no TS/Babel helper or polyfill bloat.

If someone says "prove Beagle is faster / shorter," the honest answer is "it
isn't, meaningfully — that was never the point." The point is below.

---

## What IS undeniable

### 1. Compile-time macros — a capability TS lacks entirely

`src/gjoa/chrome/bjs/macros.bjs` is **34 macros in 106 LOC**, expanded across
**595 invocation sites** in the chrome layer (~5 sites per macro-line). Each
expansion is zero-cost — it compiles to the primitive, with no runtime indirection.

```clojure
;; the macro (defined once)
(defmacro mi [label handler]
  `(let [_item (.createXULElement document "menuitem")]
     (.setAttribute _item "label" ,label)
     (.addEventListener _item "command" ,handler)
     _item))

;; the call site
(mi "Close Tab" close-handler)
```

expands at compile time to the four DOM calls inline. The TS equivalent is either
a **runtime helper** (`mi(label, handler)` — call overhead, and you still can't
change syntax) or the four calls **repeated by hand** at every menu item. TS has
no third option. Beagle does: define the abstraction once, pay nothing at runtime,
change it in one place.

### 2. Targeted boilerplate collapse — the controlled proof (test suite)

This is the cleanest measurement we have, because it controls for everything: same
tests, same language, same features — the *only* variable is "add a macro DSL."

`tests/dsl.bjs` is a **78-LOC** DSL (`deftest` / `chrome-eval` / `await-true` /
`expect` / `expect-eq` + shared `wait-for`/`sleep`). Applying it across the 13
integration files:

| | before | after |
|---|---|---|
| `tests/integration` total | 2,436 LOC | **2,109 LOC (−13%)** |
| duplicate `wait-for` definitions | 7 | **1** (shared) |
| hand-rolled `(throw (Error. …))` assertions | 103 | collapsed into `expect`/`expect-eq` |
| `(js/await (.executeScript mn …))` wrappers | 163 | collapsed into `chrome-eval` |

Per file, the collapse tracks how much boilerplate existed: **−33%** (`spaces`),
−24% (`new-tab-visibility`), −22% (`session-restore`) on assertion-heavy files;
~0% on files that were already terse (`sqlite`, `adblock-smoke`). Honest spread.

**Before:**
```clojure
{:name "Spaces — window.Spaces is exposed with a default 'Main' space"
 :run (fn [mn]
        (js/await (wait-for mn "return !!window.Spaces && window.Spaces.list().length >= 1;" nil))
        (let [list (js/await (.executeScript mn
                     "return window.Spaces.list().map(s => ({ name: s.name }));"))]
          (if (or (not (.-length list)) (not= (.-name (aget list 0)) "Main"))
            (throw (Error. (str "expected default 'Main', got " (.stringify JSON list))))
            nil)
          (let [activeName (js/await (.executeScript mn "return window.Spaces.active().name;"))]
            (if (not= activeName "Main")
              (throw (Error. (str "expected active='Main', got '" activeName "'")))
              nil))))}
```

**After:**
```clojure
(deftest "Spaces — window.Spaces is exposed with a default 'Main' space" [mn]
  (await-true "return !!window.Spaces && window.Spaces.list().length >= 1;")
  (let [list (chrome-eval "return window.Spaces.list().map(s => ({ name: s.name }));")]
    (expect (and (.-length list) (= (.-name (aget list 0)) "Main"))
            (str "expected default 'Main', got " (.stringify JSON list))))
  (expect-eq (chrome-eval "return window.Spaces.active().name;") "Main" "active space"))
```

Same behavior, same assertions, same embedded JS — verified by the suite staying
**42/42 green**. The `mn` Marionette client is threaded *anaphorically* by the
macros (non-hygienic expansion), so the body never mentions it. TS cannot express
`chrome-eval "…"` resolving `mn` from the enclosing test — it has no macros.

### 3. Stack uniformity — one typed language for the whole browser

The gjoa repo is **100% Beagle-authored**. One language, one type system, one set
of macros, spanning:

| layer | file(s) | TS can do this? |
|---|---|---|
| chrome JS (the browser UI) | `src/gjoa/chrome/bjs/**` | ✅ (this is all TS does) |
| ESM bootstrap module | `GjoaLoader.bjs` → `.sys.mjs` | ⚠️ as ESM, but not unified |
| build tooling | `tools/**` | ⚠️ via ts-node |
| integration tests | `tests/**` | ⚠️ separate |
| Firefox pref files | `defaults/pref/*.bjs` → `pref(…)` | ❌ |
| Nix config | `.bnix` (peer repo) | ❌ |

TS owns the first row. Beagle owns all six — with the same inline types, the same
`expect`/`mi`/`pref` macros, the same compiler and repair loop everywhere. That is
not a line-count argument; it's a "one mental model for the entire system" argument,
and it is not available in TS at any price.

---

## The scorecard, honestly

| metric | verdict |
|---|---|
| compression — raw LOC | **wash / confounded** — not the win, don't claim it |
| compression — boilerplate/duplication | **strong where it exists** (tests −13–33%; 595 macro sites from 106 LOC) |
| performance | **wash** (same engine) + zero-cost macros + bloat-free emit |
| readability | taste-dependent; the macro DSL reads at the domain level |
| **stack uniformity** | **decisive** — one typed, macro-enabled language for the whole stack |
| **correctness tooling** | macros + a repair loop with pointed, structured compile errors |

The case for Beagle is **macros + uniformity + correctness**, demonstrated, not
**"fewer lines"** or **"faster,"** asserted. Lead with what's true and it holds up.
