// Functional test for the boot orientation-flash deferral (#148).
//
// should-defer-reveal? is pure (two Bools in, one Bool out). It lives in
// tabs/index.js, whose module top-level boots the ENTIRE chrome graph (document,
// Services, sibling constructors, PathUtils, …) — so a plain `import` can't run
// under bare bun the way niri.js did. Rather than stub the whole transitive graph
// (brittle, rots, and surfaces unrelated sibling-module issues), we slice THIS
// function's source out of the real compiled output and evaluate it in isolation.
// The test still tracks the live emit — if the compiled signature or logic drifts,
// extraction or the assertions fail.
//
//   bun run chrome:compile && bun tools/test-driver/functional/orientation-defer.functional.mjs
//
// Truth table: defer the reveal (hide chrome until layout settles) ONLY when
// dynamic orientation is on AND the window launched narrow (will go horizontal).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "../../../.beagle-out/tabs/index.js"), "utf8");

// Extract `export function should_defer_reveal_p(...) { ... }` (a small, brace-balanced
// block in the real emit). Strip the `export` keyword and eval to a callable.
const m = src.match(/export function should_defer_reveal_p\s*\([^)]*\)\s*\{[^}]*\}/);
if (!m) { console.log("FAIL: could not extract should_defer_reveal_p from compiled index.js"); process.exit(1); }
const should_defer_reveal_p = new Function(m[0].replace(/^export\s+/, "") + "\nreturn should_defer_reveal_p;")();

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.log("FAIL:", msg); } };

ok(should_defer_reveal_p(true,  true)  === true,  "dynamic-on + narrow -> defer (the flash case)");
ok(should_defer_reveal_p(true,  false) === false, "dynamic-on + wide -> no defer (wide spawn untouched)");
ok(should_defer_reveal_p(false, true)  === false, "dynamic-off + narrow -> no defer");
ok(should_defer_reveal_p(false, false) === false, "dynamic-off + wide -> no defer");

console.log(`\norientation should-defer-reveal?: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
