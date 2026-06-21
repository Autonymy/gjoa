// AUTO-VENDORED by tools/prep/overlay.bjs from <beagle-pin>/beagle-lib/lib/beagle/core.js (configs/beagle.ref = 9d791ed57e84).
// DO NOT EDIT BY HAND — re-vendored on every `bun run import` so the
// $$bc value-semantics runtime always matches the beagle the chrome was
// compiled against. Bump configs/beagle.ref + re-import to change it.
export function range(...args) {
  let start = 0, end, step = 1;
  if (args.length === 1) { end = args[0]; }
  else if (args.length === 2) { start = args[0]; end = args[1]; }
  else { start = args[0]; end = args[1]; step = args[2]; }
  const r = [];
  if (step > 0) { for (let i = start; i < end; i += step) r.push(i); }
  else if (step < 0) { for (let i = start; i > end; i += step) r.push(i); }
  return r;
}

export function remove(pred, coll) {
  return coll.filter(x => !pred(x));
}

export function mapcat(f, coll) {
  return coll.flatMap(f);
}

export function every_p(pred, coll) {
  return coll.every(pred);
}

export function keep(f, coll) {
  return coll.map(f).filter(x => x != null);
}

export function map_indexed(f, coll) {
  return coll.map((x, i) => f(i, x));
}

export function assoc_in(m, path, v) {
  if (path.length === 0) return v;
  const [k, ...rest] = path;
  return { ...m, [k]: rest.length === 0 ? v : assoc_in(m[k] || {}, rest, v) };
}

export function update_in(m, path, f) {
  if (path.length === 0) return f(m);
  const [k, ...rest] = path;
  return { ...m, [k]: rest.length === 0 ? f(m[k]) : update_in(m[k] || {}, rest, f) };
}

export function select_keys(m, ks) {
  const r = {};
  for (const k of ks) if (k in m) r[k] = m[k];
  return r;
}

export function merge_with(f, ...ms) {
  const r = {};
  for (const m of ms) {
    for (const k in m) {
      r[k] = k in r ? f(r[k], m[k]) : m[k];
    }
  }
  return r;
}

export function take_while(pred, coll) {
  const r = [];
  for (const x of coll) {
    if (!pred(x)) break;
    r.push(x);
  }
  return r;
}

export function drop_while(pred, coll) {
  let dropping = true;
  const r = [];
  for (const x of coll) {
    if (dropping && pred(x)) continue;
    dropping = false;
    r.push(x);
  }
  return r;
}

export function memoize(f) {
  // Equiv-correct memoization: cache keys are the ARGS VALUE, compared by
  // Clojure value-equality (equiv), not JSON.stringify. JSON.stringify is
  // both lossy (Set/undefined/key-order) and wrong for value identity
  // (distinct-but-equiv compound args must hit the same cache entry). We
  // bucket by hash(args) for O(1) lookup, then equiv-confirm within the
  // bucket so an equiv-but-distinct compound arg returns the cached result.
  const buckets = new Map(); // hash(args) -> array of [argsArray, result]
  return (...args) => {
    const h = hash(args);
    let bucket = buckets.get(h);
    if (bucket) {
      for (const entry of bucket) {
        if (equiv(entry[0], args)) return entry[1];
      }
    } else {
      bucket = [];
      buckets.set(h, bucket);
    }
    const v = f(...args);
    bucket.push([args, v]);
    return v;
  };
}

export function fnil(f, ...defaults) {
  return (...args) => f(...args.map((a, i) => a == null && i < defaults.length ? defaults[i] : a));
}

export function some_fn(...preds) {
  return (...args) => {
    for (const p of preds) {
      const v = p(...args);
      if (v) return v;
    }
    return null;
  };
}

export function every_pred(...preds) {
  return (...args) => {
    for (const p of preds) {
      if (!p(...args)) return false;
    }
    return true;
  };
}

export function rename_keys(m, kmap) {
  const r = { ...m };
  for (const [old_k, new_k] of Object.entries(kmap)) {
    if (old_k in r) {
      r[new_k] = r[old_k];
      delete r[old_k];
    }
  }
  return r;
}

export function map_keys(f, m) {
  return Object.fromEntries(Object.entries(m).map(([k, v]) => [f(k), v]));
}

export function map_vals(f, m) {
  return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, f(v)]));
}

export function disj(s, ...ks) {
  const r = new Set(s);
  for (const k of ks) r.delete(k);
  return r;
}

export function reduce_kv(f, init, m) {
  let acc = init;
  for (const [k, v] of Object.entries(m)) acc = f(acc, k, v);
  return acc;
}

export function dedupe(coll) {
  const r = [];
  let prev;
  for (const x of coll) {
    if (r.length === 0 || x !== prev) r.push(x);
    prev = x;
  }
  return r;
}

export function interpose(sep, coll) {
  const r = [];
  for (let i = 0; i < coll.length; i++) {
    if (i > 0) r.push(sep);
    r.push(coll[i]);
  }
  return r;
}

export function partition_all(n, coll) {
  const r = [];
  for (let i = 0; i < coll.length; i += n) r.push(coll.slice(i, i + n));
  return r;
}

export function partition_by(f, coll) {
  if (coll.length === 0) return [];
  const r = [];
  let group = [coll[0]], prev = f(coll[0]);
  for (let i = 1; i < coll.length; i++) {
    const cur = f(coll[i]);
    if (cur === prev) { group.push(coll[i]); }
    else { r.push(group); group = [coll[i]]; prev = cur; }
  }
  r.push(group);
  return r;
}

export function split_with(pred, coll) {
  const t = [], d = [];
  let splitting = true;
  for (const x of coll) {
    if (splitting && pred(x)) t.push(x);
    else { splitting = false; d.push(x); }
  }
  return [t, d];
}

export function zipmap(keys, vals) {
  const r = {};
  for (let i = 0; i < keys.length && i < vals.length; i++) r[keys[i]] = vals[i];
  return r;
}

export function format(fmt, ...args) {
  let i = 0;
  return fmt.replace(/%[sd]/g, () => i < args.length ? String(args[i++]) : '');
}

// --- HAMT (persistent collection) value-awareness ----------------------------
// core.js stays IMPORT-FREE: it knows hamt.js's node shapes by structure and
// never imports it (same discipline as count's _bg branch), so core.js remains
// tree-shakeable. A HAMT ({_bg:'hamtMap'|'hamtSet', root, count}) and a NATIVE
// map/set of equal value must be equiv-equal AND hash-equal — the
// value-indistinguishability invariant that makes per-site native/persistent
// representation selection sound (a value that becomes a HAMT must still = the
// same value left native).
//   entry {t:'e',k,v} | bitmap {t:'n',slots:[...]} | collision {t:'c',bucket:[[k,v]...]}
function isHamt(x) {
  return x != null && typeof x === "object" && (x._bg === "hamtMap" || x._bg === "hamtSet");
}
function hamtWalk(node, out) {
  if (node == null) return out;
  if (node.t === "e") out.push([node.k, node.v]);
  else if (node.t === "c") { for (const p of node.bucket) out.push(p); }
  else { for (const s of node.slots) hamtWalk(s, out); }
  return out;
}
// A hamtMap's entries as a NATIVE-object view, IFF every key is scalar (so it is
// comparable to a plain-object map, whose keys are always strings). null if any
// key is compound (such a map has no native equivalent). Scalar keys coerce to
// string exactly like native map emission, so HAMT{1} matches native{"1"}.
function hamtMapNativeView(m) {
  const o = {};
  for (const [k, v] of hamtWalk(m.root, [])) {
    if (k !== null && typeof k === "object") return null;
    o[k] = v;
  }
  return o;
}
function hamtEquiv(a, b) {
  const aSetH = isHamt(a) && a._bg === "hamtSet", bSetH = isHamt(b) && b._bg === "hamtSet";
  // SET side: a hamtSet vs (hamtSet | native Set) — element multiset by equiv.
  if (aSetH || bSetH || a instanceof Set || b instanceof Set) {
    const ael = hamtElems(a), bel = hamtElems(b);
    if (ael == null || bel == null || ael.length !== bel.length) return false;
    const used = new Array(bel.length).fill(false);
    outer: for (const x of ael) {
      for (let i = 0; i < bel.length; i++) {
        if (!used[i] && equivV(x, bel[i])) { used[i] = true; continue outer; }
      }
      return false;
    }
    return true;
  }
  // MAP side.
  const aMapH = isHamt(a) && a._bg === "hamtMap", bMapH = isHamt(b) && b._bg === "hamtMap";
  if (aMapH && bMapH) {
    if (a.count !== b.count) return false;
    const be = hamtWalk(b.root, []);
    for (const [k, v] of hamtWalk(a.root, [])) {
      let found = false;
      for (const [k2, v2] of be) { if (equivV(k, k2)) { if (!equivV(v, v2)) return false; found = true; break; } }
      if (!found) return false;
    }
    return true;
  }
  // hamtMap vs native object: coerce the HAMT to its native view, compare as maps.
  const hm = aMapH ? a : (bMapH ? b : null);
  const other = aMapH ? b : a;
  if (hm == null) return false;
  if (other == null || typeof other !== "object" || Array.isArray(other) || other instanceof Set) return false;
  const view = hamtMapNativeView(hm);
  if (view == null) return false; // compound keys -> no native equivalent
  return equivV(view, other);
}
function hamtElems(x) {
  if (isHamt(x)) return x._bg === "hamtSet" ? hamtWalk(x.root, []).map(p => p[0]) : null;
  if (x instanceof Set) return [...x];
  return null;
}
function hamtHash(x) {
  if (x._bg === "hamtSet") { // mirror the native Set branch (seed 6, order-insensitive).
    let acc = 0;
    for (const [e] of hamtWalk(x.root, [])) acc = (acc + hashV(e)) | 0;
    return mix(6, acc);
  }
  // hamtMap: mirror the native object-map branch (seed 7). Scalar keys hash via
  // their native string form so HAMT and native of equal content hash equal.
  let acc = 0;
  for (const [k, v] of hamtWalk(x.root, [])) {
    const hk = (k !== null && typeof k === "object") ? hashV(k) : hashV(String(k));
    acc = (acc + mix(hk, hashV(v))) | 0;
  }
  return mix(7, acc);
}

// Native structural value-equality (arrays / sets / plain objects+records),
// PARAMETERIZED by the recursive equiv to thread. Written ONCE so the lite and
// HAMT-aware variants share it and can't drift; the only difference between them
// is whether the recursion (rec) handles nested HAMTs.
function equivNative(a, b, rec) {
  const ta = typeof a, tb = typeof b;
  // scalars: numbers, strings (keywords emit as bare strings), booleans.
  if (ta !== "object" || tb !== "object") return a === b;

  const aArr = Array.isArray(a), bArr = Array.isArray(b);
  if (aArr || bArr) {
    // arrays (vectors/lists/seqs): order-sensitive elementwise equiv.
    if (!aArr || !bArr || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!rec(a[i], b[i])) return false;
    return true;
  }

  const aSet = a instanceof Set, bSet = b instanceof Set;
  if (aSet || bSet) {
    // sets: value membership (NOT reference identity), same size.
    if (!aSet || !bSet || a.size !== b.size) return false;
    const bItems = [...b];
    const used = new Array(bItems.length).fill(false);
    outer: for (const x of a) {
      for (let i = 0; i < bItems.length; i++) {
        if (!used[i] && rec(x, bItems[i])) { used[i] = true; continue outer; }
      }
      return false;
    }
    return true;
  }

  // plain objects: maps AND records (a record's tag is just another key) —
  // same own enumerable keys, recursive equiv on values.
  const ak = Object.keys(a), bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!rec(a[k], b[k])) return false;
  }
  return true;
}

// LITE equiv — Clojure = over native value reps, NO HAMT branch. Programs that
// never produce a HAMT (rep-metric 0 HAMT, no poly $bc read) import THIS, so
// esbuild never pulls the HAMT helpers (recovers the ~456 gz native-only margin).
export function equiv(a, b) {
  if (a == null || b == null) return a == null && b == null;
  if (a === b) return true;
  return equivNative(a, b, equiv);
}

// HAMT-AWARE equiv — adds the persistent-collection branch so a HAMT and a native
// of equal value compare equal (value-indistinguishability). Programs that produce
// a HAMT or emit a poly $bc read import this as `equiv` (single-file alias).
export function equivV(a, b) {
  if (a == null || b == null) return a == null && b == null;
  if (a === b) return true;
  if (isHamt(a) || isHamt(b)) return hamtEquiv(a, b);
  return equivNative(a, b, equivV);
}

// LITE contains? — native only (set membership by equiv; vector index; map key),
// NO HAMT branch. `contains?` tests KEY/INDEX, except sets where element IS key.
export function contains(coll, x) {
  if (coll == null) return false;
  if (coll instanceof Set) { // value membership by EQUIV (not ref-eq Set.has).
    for (const e of coll) if (equiv(e, x)) return true;
    return false;
  }
  if (Array.isArray(coll)) return Number.isInteger(x) && x >= 0 && x < coll.length;
  if (typeof coll === "object") return Object.prototype.hasOwnProperty.call(coll, x);
  return false;
}

// HAMT-AWARE contains? — adds the persistent branch (hamtSet element membership /
// hamtMap key presence by equivV); native cases inlined with equivV.
export function containsV(coll, x) {
  if (coll == null) return false;
  if (isHamt(coll)) {
    if (coll._bg === "hamtSet") {
      for (const [e] of hamtWalk(coll.root, [])) if (equivV(e, x)) return true;
      return false;
    }
    for (const [k] of hamtWalk(coll.root, [])) if (equivV(k, x)) return true;
    return false;
  }
  if (coll instanceof Set) {
    for (const e of coll) if (equivV(e, x)) return true;
    return false;
  }
  if (Array.isArray(coll)) return Number.isInteger(x) && x >= 0 && x < coll.length;
  if (typeof coll === "object") return Object.prototype.hasOwnProperty.call(coll, x);
  return false;
}

// `distinct` core: a new array, EQUIV-duplicates removed, order preserved.
// Bucketed by hash for O(n) average. Parameterized by hash/equiv so lite and
// HAMT-aware share it (lite for native-only programs, V where HAMTs can appear).
function distinctImpl(coll, hashFn, equivFn) {
  const out = [];
  const seen = new Map(); // hash(x) -> array of already-kept values
  for (const x of coll) {
    const h = hashFn(x);
    let bucket = seen.get(h);
    if (bucket) {
      let dup = false;
      for (const y of bucket) { if (equivFn(y, x)) { dup = true; break; } }
      if (dup) continue;
    } else {
      bucket = [];
      seen.set(h, bucket);
    }
    bucket.push(x);
    out.push(x);
  }
  return out;
}
export function distinct_equiv(coll) { return distinctImpl(coll, hash, equiv); }
export function distinct_equivV(coll) { return distinctImpl(coll, hashV, equivV); }

export function count(x) {
  // Clojure `count` over Beagle EMITTED JS representations, rep-dispatched at
  // runtime — for operands whose collection rep isn't statically known (the
  // var-ref/leaf case, parallel to `contains`). Native: array/string -> length;
  // Set/Map -> size; plain object (map/record) -> own-key count. Persistent: a
  // HAMT wrapper ({_bg:'hamtMap'|'hamtSet', count}) carries its count as a field,
  // so this reads it directly — core.js never imports hamt.js (stays import-free
  // and tree-shakeable). nil -> 0.
  if (x == null) return 0;
  if (Array.isArray(x)) return x.length;
  if (typeof x === "string") return x.length;
  if (x instanceof Map || x instanceof Set) return x.size;
  if (x._bg === "hamtMap" || x._bg === "hamtSet") return x.count;
  return Object.keys(x).length;
}

export function get(coll, k, notFound = null) {
  // Clojure `get`, rep-dispatched at runtime — the POLYMORPHIC read used when the
  // collection's rep isn't statically known (an Any/union/type-var/Float/Nil key
  // type, where a NATIVE scalar map can flow in by Map-key covariance but a HAMT
  // can too). Handles both reps + native vec/set. Import-free (traverses the HAMT
  // node structure directly, like equiv/hash/contains). nil-safe.
  if (coll == null) return notFound;
  if (isHamt(coll)) {
    if (coll._bg === "hamtMap") {
      for (const [kk, vv] of hamtWalk(coll.root, [])) if (equivV(kk, k)) return vv;
      return notFound;
    }
    // hamtSet: (get set x) -> x if present (by value), else notFound.
    for (const [e] of hamtWalk(coll.root, [])) if (equivV(e, k)) return e;
    return notFound;
  }
  if (Array.isArray(coll)) {
    return (Number.isInteger(k) && k >= 0 && k < coll.length) ? coll[k] : notFound;
  }
  if (coll instanceof Set) {
    for (const e of coll) if (equivV(e, k)) return e;
    return notFound;
  }
  if (typeof coll === "object") { // native map / record
    return Object.prototype.hasOwnProperty.call(coll, k) ? coll[k] : notFound;
  }
  return notFound;
}

export function keys(coll) {
  // map keys, rep-polymorphic: HAMT -> traversed keys; native object map -> own keys.
  if (coll == null) return [];
  if (isHamt(coll) && coll._bg === "hamtMap") return hamtWalk(coll.root, []).map(p => p[0]);
  if (typeof coll === "object" && !Array.isArray(coll) && !(coll instanceof Set)) return Object.keys(coll);
  return [];
}

export function vals(coll) {
  // map values, rep-polymorphic: HAMT -> traversed values; native object map -> own values.
  if (coll == null) return [];
  if (isHamt(coll) && coll._bg === "hamtMap") return hamtWalk(coll.root, []).map(p => p[1]);
  if (typeof coll === "object" && !Array.isArray(coll) && !(coll instanceof Set)) return Object.values(coll);
  return [];
}

function mix(h, c) {
  // order-sensitive 32-bit combine.
  return ((h << 5) - h + c) | 0;
}

// Structural content hash CONSISTENT with equiv (equiv(a,b) => hash(a)===hash(b)),
// PARAMETERIZED by the recursive hash to thread. Written once; lite and HAMT-aware
// share it and differ only in whether the recursion handles nested HAMTs.
function hashNative(x, rec) {
  const t = typeof x;
  if (t === "number") return mix(1, x | 0) ^ ((x * 2654435761) | 0);
  if (t === "string") {
    let h = 2;
    for (let i = 0; i < x.length; i++) h = mix(h, x.charCodeAt(i));
    return h | 0;
  }
  if (t === "boolean") return x ? 3 : 4;
  if (Array.isArray(x)) { // order-SENSITIVE combine.
    let h = 5;
    for (let i = 0; i < x.length; i++) h = mix(h, rec(x[i]));
    return h | 0;
  }
  if (x instanceof Set) { // order-INSENSITIVE (sum) so element order is irrelevant.
    let acc = 0;
    for (const e of x) acc = (acc + rec(e)) | 0;
    return mix(6, acc);
  }
  if (t === "object") { // maps AND records: order-INSENSITIVE over (key,value).
    let acc = 0;
    for (const k of Object.keys(x)) acc = (acc + mix(rec(k), rec(x[k]))) | 0;
    return mix(7, acc);
  }
  return mix(8, rec(String(x))); // fallback: stable string coercion.
}

// LITE hash — native, NO HAMT branch (pairs with lite equiv). Returns 32-bit int.
export function hash(x) {
  if (x == null) return 0;
  return hashNative(x, hash);
}

// HAMT-AWARE hash — a HAMT hashes identically to the equal native collection.
export function hashV(x) {
  if (x == null) return 0;
  if (isHamt(x)) return hamtHash(x);
  return hashNative(x, hashV);
}

export function get_in(m, path) {
  let v = m;
  for (const k of path) {
    if (v == null) return null;
    v = v[k];
  }
  return v ?? null;
}

export function take_nth(n, coll) {
  const r = [];
  for (let i = 0; i < coll.length; i += n) r.push(coll[i]);
  return r;
}

export function keep_indexed(f, coll) {
  return coll.map((x, i) => f(i, x)).filter(x => x != null);
}

export function reductions(f, ...args) {
  const [init, coll] = args.length === 1 ? [args[0][0], args[0].slice(1)] : [args[0], args[1]];
  const r = [init];
  let acc = init;
  for (const x of coll) { acc = f(acc, x); r.push(acc); }
  return r;
}

export function replace(smap, coll) {
  return coll.map(x => x in smap ? smap[x] : x);
}

export function max_key(k, ...xs) {
  return xs.reduce((a, b) => k(b) > k(a) ? b : a);
}

export function min_key(k, ...xs) {
  return xs.reduce((a, b) => k(b) < k(a) ? b : a);
}
