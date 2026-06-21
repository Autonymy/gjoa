// AUTO-VENDORED by tools/prep/overlay.bjs from <beagle-pin>/beagle-lib/lib/beagle/core.js (configs/beagle.ref = 77df8a9343ee).
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

export function equiv(a, b) {
  // Clojure = semantics over Beagle EMITTED JS value representations.
  // nil: both null and undefined represent Clojure nil.
  if (a == null || b == null) return a == null && b == null;

  // identical refs are trivially equal.
  if (a === b) return true;

  const ta = typeof a, tb = typeof b;

  // scalars: numbers, strings (keywords emit as bare strings), booleans.
  if (ta !== "object" || tb !== "object") return a === b;

  // both are objects (arrays, plain objects/records, Sets, ...).
  const aArr = Array.isArray(a), bArr = Array.isArray(b);
  if (aArr || bArr) {
    // arrays (vectors/lists/seqs): order-sensitive elementwise equiv.
    if (!aArr || !bArr) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!equiv(a[i], b[i])) return false;
    return true;
  }

  const aSet = a instanceof Set, bSet = b instanceof Set;
  if (aSet || bSet) {
    // sets: value membership (NOT reference identity), same size.
    if (!aSet || !bSet) return false;
    if (a.size !== b.size) return false;
    const bItems = [...b];
    const used = new Array(bItems.length).fill(false);
    outer: for (const x of a) {
      for (let i = 0; i < bItems.length; i++) {
        if (!used[i] && equiv(x, bItems[i])) { used[i] = true; continue outer; }
      }
      return false;
    }
    return true;
  }

  // plain objects: maps AND records (a record's tag is just another key,
  // e.g. _tag) — same set of own enumerable keys, recursive equiv on values.
  const ak = Object.keys(a), bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!equiv(a[k], b[k])) return false;
  }
  return true;
}

export function contains(coll, x) {
  // Clojure `contains?` semantics over Beagle EMITTED JS representations.
  // Crucially, `contains?` tests for a KEY/INDEX, not a value — EXCEPT for
  // sets, where the element IS the key.
  if (coll == null) return false;

  // Set (Clojure set): value membership by EQUIV, not Set.has (which is
  // reference-eq and so misses distinct-but-equiv compound elements). This is
  // the load-bearing fix.
  if (coll instanceof Set) {
    for (const e of coll) if (equiv(e, x)) return true;
    return false;
  }

  // Array (Clojure vector): `contains?` checks whether x is a VALID INDEX
  // (0 <= x < length), NOT element membership — matching Clojure.
  if (Array.isArray(coll)) {
    return Number.isInteger(x) && x >= 0 && x < coll.length;
  }

  // Map (plain object/record): key present. JS object keys are strings, and
  // Beagle keywords emit as bare strings, so a keyword/string key matches.
  if (typeof coll === "object") {
    return Object.prototype.hasOwnProperty.call(coll, x);
  }

  return false;
}

export function distinct_equiv(coll) {
  // Clojure `distinct` over Beagle EMITTED JS representations: a new array
  // with EQUIV-duplicates removed, original order preserved. So
  // (distinct [{:a 1} {:a 1}]) collapses to a single element. Bucketed by
  // hash for O(n) average lookup, then equiv-confirmed within the bucket.
  const out = [];
  const seen = new Map(); // hash(x) -> array of already-kept values
  for (const x of coll) {
    const h = hash(x);
    let bucket = seen.get(h);
    if (bucket) {
      let dup = false;
      for (const y of bucket) { if (equiv(y, x)) { dup = true; break; } }
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

function mix(h, c) {
  // order-sensitive 32-bit combine.
  return ((h << 5) - h + c) | 0;
}

export function hash(x) {
  // Structural recursive content hash CONSISTENT with equiv:
  // equiv(a,b) implies hash(a) === hash(b). Returns a 32-bit integer.

  // nil: null and undefined hash the same (equiv treats them equal).
  if (x == null) return 0;

  const t = typeof x;
  if (t === "number") {
    // tag numbers; coerce to a stable 32-bit value.
    return mix(1, x | 0) ^ ((x * 2654435761) | 0);
  }
  if (t === "string") {
    let h = 2;
    for (let i = 0; i < x.length; i++) h = mix(h, x.charCodeAt(i));
    return h | 0;
  }
  if (t === "boolean") return x ? 3 : 4;

  if (Array.isArray(x)) {
    // order-SENSITIVE combine.
    let h = 5;
    for (let i = 0; i < x.length; i++) h = mix(h, hash(x[i]));
    return h | 0;
  }

  if (x instanceof Set) {
    // order-INSENSITIVE combine (sum) so element order is irrelevant.
    let acc = 0;
    for (const e of x) acc = (acc + hash(e)) | 0;
    return mix(6, acc);
  }

  if (t === "object") {
    // maps AND records: order-INSENSITIVE over (key, value) pairs so that
    // {a:1,b:2} and {b:2,a:1} hash equal. No special-casing for records.
    let acc = 0;
    for (const k of Object.keys(x)) {
      // per-entry hash combines key + value order-sensitively, then the
      // entries are summed (commutatively) across keys.
      acc = (acc + mix(hash(k), hash(x[k]))) | 0;
    }
    return mix(7, acc);
  }

  // fallback for any other type: stable string coercion.
  return mix(8, hash(String(x)));
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

// ── pin-compat shim (tools/prep/overlay.bjs) ──
export { equiv as equivV };
