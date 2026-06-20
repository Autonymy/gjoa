# Why Beagle for gjoa — the authoring substrate

gjoa is authored in **Beagle** (`.bjs`) — a typed Clojure that compiles `parse →
check → emit` to chrome JS, the native ESM loader, build tooling, tests, and
Firefox pref files. This document is the honest case for that choice. It leads
with what is **measurable and CI-enforced**, and it is explicit about what is
*not* a win — a claim that overreaches is one sentence away from being dismissed.

## TL;DR

The win is **not raw line count**. It is four things TS/JS structurally cannot
do, plus a fifth that goes beyond authoring entirely:

1. **Compile-time macros** — a zero-cost domain abstraction layer. TS has no macro system.
2. **One typed language across the entire stack** — chrome JS, the ESM loader, build tooling, tests, pref files, Nix config.
3. **Machine-checked effect discipline** (`!`-purity) — the one bug class `tsc` cannot catch at any setting.
4. **Targeted boilerplate collapse**, proven in a controlled experiment (the test suite).
5. **Code as claims** — engine patches anchored by *structural identity* (not line numbers, so an upstream refactor can't silently lose them), and gjoa's own source queryable as a call graph (who-calls / blast-radius / leverage). CI-gated.

---

## What is NOT a win (honesty first)

- **Raw LOC is a wash.** Beagle source is often *the same size or larger* than the
  JS it emits — inline types (`:- T`), `;;` comments that don't survive emit, and
  Lisp's one-form-per-line verticality all cost lines. The chrome layer is **8,516
  LOC of `.bjs` source → 6,612 LOC of emitted JS**. Beagle is not "fewer lines."
- **Cross-codebase LOC vs the old TS (palefox) is confounded.** gjoa does strictly
  more (SQLite history, Spaces, multi-window sync), the archive has multiple
  iterations of each file, and conventions differ. Any single beagle-vs-TS ratio
  from it is cherry-picked. We don't headline one.
- **Performance is a wash.** Chrome JS runs in the same SpiderMonkey whether it
  came from Beagle or TS; Beagle emits ~the same JS. The only real edges are small:
  macros inline (zero-cost) where a TS helper `byId()` is a runtime call, and
  Beagle emits clean modern ESM with no TS/Babel helper or polyfill bloat.

If someone says "prove Beagle is faster / shorter," the honest answer is "it
isn't, meaningfully — that was never the point." The point is below.

---

## What IS undeniable

### 1. Compile-time macros — a capability TS lacks entirely

`src/gjoa/chrome/bjs/macros.bjs` is **37 macros in 123 LOC**, expanded across
**~600 invocation sites** in the chrome layer. Each expansion is zero-cost — it
compiles to the primitive, with no runtime indirection.

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

`tests/dsl.bjs` is a **93-LOC** DSL (`deftest` / `chrome-eval` / `await-true` /
`expect` / `expect-eq` + shared `wait-for`/`sleep`), shared across the **integration
suite (28 files, 80 `deftest` cases)**. It deduplicates what was 7 hand-rolled
`wait-for` definitions down to **one**, collapses every `(throw (Error. …))`
assertion into `expect`/`expect-eq`, and every `(js/await (.executeScript mn …))`
wrapper into `chrome-eval`. When the DSL was introduced it cut the then-13-file
suite **~13%** (−33% on assertion-heavy files like `spaces`, ~0% on already-terse
ones — honest spread); the suite has since tripled in size on top of that one DSL.

**Before:**
```clojure
{:name "Spaces — window.Spaces is exposed with a default 'Main' space"
 :run (fn [mn]
        (js/await (wait-for mn "return !!window.Spaces && window.Spaces.list().length >= 1;" nil))
        (let [list (js/await (.executeScript mn
                     "return window.Spaces.list().map(s => ({ name: s.name }));"))]
          (if (or (not (.-length list)) (not= (.-name (aget list 0)) "Main"))
            (throw (Error. (str "expected default 'Main', got " (.stringify JSON list))))
            nil)))}
```

**After:**
```clojure
(deftest "Spaces — window.Spaces is exposed with a default 'Main' space" [mn]
  (await-true "return !!window.Spaces && window.Spaces.list().length >= 1;")
  (let [list (chrome-eval "return window.Spaces.list().map(s => ({ name: s.name }));")]
    (expect (and (.-length list) (= (.-name (aget list 0)) "Main"))
            (str "expected default 'Main', got " (.stringify JSON list)))))
```

Same behavior, same assertions, same embedded JS. The `mn` Marionette client is
threaded *anaphorically* by the macros (non-hygienic expansion), so the body never
mentions it. TS cannot express `chrome-eval "…"` resolving `mn` from the enclosing
test — it has no macros.

### 3. Stack uniformity — one typed language for the whole browser

The gjoa repo is **100% Beagle-authored** (zero hand-written `.ts`/`.js` source).
One language, one type system, one set of macros, spanning:

| layer | file(s) | TS can do this? |
|---|---|---|
| chrome JS (the browser UI) | `src/gjoa/chrome/bjs/**` | ✅ (this is all TS does) |
| ESM loader module | `GjoaLoader.bjs` → `.sys.mjs` | ⚠️ as ESM, but not unified |
| build tooling | `tools/**` | ⚠️ via ts-node |
| integration tests | `tests/**` | ⚠️ separate |
| Firefox pref files | `defaults/pref/*.bjs` → `pref(…)` | ❌ |
| Nix config | `.bnix` (peer repo) | ❌ |

TS owns the first row. Beagle owns all six — with the same inline types, the same
`expect`/`mi`/`pref` macros, the same compiler and repair loop everywhere. That is
not a line-count argument; it's a "one mental model for the entire system" argument,
and it is not available in TS at any price.

### 4. Effect discipline — the one bug class beagle catches that `tsc` cannot

Beagle enforces a naming invariant: a function whose name does **not** end in `!`
must have a **pure body** — no `set!`, no call to a `!`-named (effectful) function.
Break it and the build fails with `E019 purity leak`.

```clojure
;; beagle — COMPILE ERROR (E019): "compute-total has no '!' suffix but its body
;; uses record! — rename to 'compute-total!' or remove the effect"
(defn compute-total [items :- Any] :- Int
  (record! items)                       ; a hidden side effect
  (.reduce items (fn [a b] (+ a b)) 0))
```

```typescript
// tsc --strict — PASSES CLEAN. The mutation is invisible to the type system.
function computeTotal(items: number[]): number {
  globalCache.lastCall = items;         // same hidden side effect
  return items.reduce((a, b) => a + b, 0);
}
```

`tsc` has no concept of purity at any setting — a function that reads like a
calculation but silently mutates shared state type-checks perfectly, and ships as a
heisenbug (it breaks the moment someone memoizes it, reorders it, or runs it twice).
Beagle makes "no `!` means pure" a *machine-checked promise*, enforced across the
whole corpus (`bun run check`, gated in `test`): every effectful function — all the
`make-*` factories, every mutator — is marked `!`, so the *absence* of `!` is a
guarantee you can reason on. That guarantee does not exist in TypeScript.

---

## Beyond authoring: code as claims

The previous four points are about writing the browser. This one is about the
**engine patches** — and it is the affordance with no TS analogue at all, because
it isn't a language feature, it's treating *code as structured data instead of
text* end to end.

gjoa carries patches against Mozilla source. A textual `.patch` is anchored to
line numbers and surrounding context: when Mozilla reflows or renames around a
hunk — which it does every release — the patch `.rej`s and you re-roll it by hand.
gjoa's **projector** (`tools/projector/`) expresses selected edits as **claim-docs**
instead: a small JSON document of verbs like `set-body` on
`AboutNewTabRedirectorParent::newChannel`, anchored by *structural identity* — the
method's parameter list, ordinal, and body identifiers — **not** by line. When the
surrounding source moves, the claim-doc re-locates its target by identity and
re-applies.

This is **real and CI-gated** (`bun run projector:test`, gates A/B in all three
build workflows):

- **Gate A** round-trips the entire `.sys.mjs` corpus through a lossless CST
  (`reflector.bjs`) and renders it back **byte-identically** — the projection
  loses nothing.
- **Gate B** proves the committed `0011` claim-doc
  (`patches/0011-newtab-redirector-gjoa.claims.json`) reproduces its textual patch
  output **exactly**.
- Anchor-recovery (`anchor.bjs`) survives reflow *and a method rename* — fuzzy-
  matching on params + body-identifier overlap when the name itself changes.

The payoff for gjoa today is concrete: **a patch you can't silently lose to an
upstream refactor.**

### Relational queries over gjoa's own source

The other half of "code as claims" is querying the code *relationally* — and gjoa
now does. `tools/projector/codegraph.bjs` parses the emitted chrome JS (acorn, the
same parser the reflector uses), builds the call graph, and answers, over gjoa's
own 300-odd chrome functions:

```sh
bun run projector:codegraph who-calls 'parse-hosts'      # direct callers
bun run projector:codegraph blast-radius 'tree-root'     # transitive dependents
bun run projector:codegraph leverage 20                  # functions ranked by blast-radius
bun run projector:codegraph emit                         # the graph as claim triples
```

`leverage` is the one a `grep` can't give you: it ranks every function by the size
of its **transitive** dependent set — "what is load-bearing." `blast-radius` is the
"what breaks if I change this" answer. The graph emits as `(subject, predicate,
object)` claim triples (`defines` / `calls` / `leverage`), in EDN or Fram-log form.

Two properties keep it honest rather than approximate:

- **Collision-free across modules; closures roll up.** Each chrome module compiles
  to its own IIFE-scoped bundle, so the names defined in more than one module
  (`init!`, `apply!`, `enabled?` …) resolve to distinct per-module nodes —
  blocking's `apply!` and dark-mode's `apply!` have *different* callers, a precision
  a bare-name index can't reach. Nested closures aren't separate nodes; their calls
  roll up to the module-scope function that owns them. (One residual imprecision is
  *reported*, not hidden: when two source files bundled into one module both define
  the same top-level name — today `destroy` and `on-tab-select` in `tabs` — they
  share a node. `projector:codegraph stats` prints these.)
- **More complete than the compiler's own analyzer, and CI-checked against it.**
  `beagle callers` under-reports — it drops call sites inside `(js/export (defn …))`
  bodies and top-level forms (so a helper used ~30× can report *zero* callers).
  Deriving the graph from the emitted JS sees every call. **Gate C** of
  `projector:test` enforces the relationship in CI: for a set of functions, every
  caller `beagle callers` *does* report must appear in the projected graph — the
  projector is a verified **superset** of the compiler's own view (an adversarial
  sweep over all 300+ functions found zero soundness violations and zero
  hallucinated edges).

**Honest scope:** this is the **bare-call** graph — direct calls between named
functions. Three invocation forms are deliberately *not* edges: cross-module
`window.gjoa*` dispatch, function-as-value hand-offs (event handlers,
`.map(f)`-style iteratees), and `.method` interop. So `leverage` / `blast-radius`
rank the bare-call sub-graph — the dominant structure — not every dynamic call.
Macros are compile-time-inlined and correctly are not nodes. It's **shipped and
CI-gated**; cross-module and higher-order edges are the next layers.

---

## The scorecard, honestly

| metric | verdict |
|---|---|
| compression — raw LOC | **wash / confounded** — not the win, don't claim it |
| compression — boilerplate/duplication | **strong where it exists** (test DSL: 93 LOC shared across 80 cases; ~600 macro sites from 123 LOC) |
| performance | **wash** (same engine) + zero-cost macros + bloat-free emit |
| readability | taste-dependent; the macro DSL reads at the domain level |
| **stack uniformity** | **decisive** — one typed, macro-enabled language for the whole stack |
| **effect discipline** | **decisive** — `!`-purity is enforced (the one bug class `tsc` cannot catch) |
| **code as claims** | **shipped + CI-gated**: identity-anchored churn-proof patches **and** a bare-call graph over gjoa's own source (who-calls / blast-radius / leverage), collision-free across modules and verified ⊇ the compiler's own caller analysis |
| **correctness tooling** | macros + a repair loop with pointed, structured compile errors |

The case for Beagle is **macros + uniformity + effect discipline + code-as-claims**,
demonstrated, not **"fewer lines"** or **"faster,"** asserted. Lead with what's true
and it holds up.
