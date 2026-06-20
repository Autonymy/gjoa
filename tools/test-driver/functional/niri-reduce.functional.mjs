// Functional test for the niri workspace-binding (#41, #87).
//
// reduce-event / switch-to-target / frame-lines are pure (no subprocess, no niri,
// no chrome globals — the Subprocess import is lazy), so they run directly under
// bun. The gjoa chrome modules compile to .beagle-out/ (a different output tree
// than the bun:test harness in .beagle-tools/gjoa/tests/), so this is a standalone
// check rather than a tests/*.test.bjs.
//
//   bun run chrome:compile && bun tools/test-driver/functional/niri-reduce.functional.mjs
//
// Fixtures are the live-captured niri `niri msg event-stream` event shapes.

import { reduce_event, switch_to_target, frame_lines } from "../../../.beagle-out/spaces/niri.js";

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.log("FAIL:", msg); } };

// ── reduce-event ────────────────────────────────────────────────────────────
// WorkspacesChanged caches by id, no switch.
const r1 = reduce_event(new Map(), { WorkspacesChanged: { workspaces: [
  { id: 1, idx: 2, name: "gjoa", is_focused: true },
  { id: 5, idx: 1, name: "music", is_focused: false }] } });
ok(r1.switch === null, "WorkspacesChanged -> switch null");
ok(r1.cache.get(1).name === "gjoa" && r1.cache.size === 2, "WorkspacesChanged caches by id");

// WorkspaceActivated{focused:true} resolves the target {name, idx} by id from cache.
const sw = reduce_event(r1.cache, { WorkspaceActivated: { id: 5, focused: true } }).switch;
ok(sw && sw.name === "music" && sw.idx === 1, "WorkspaceActivated{focused:true} -> {name:music, idx:1}");

// per-output WorkspaceActivated{focused:false} is ignored.
ok(reduce_event(r1.cache, { WorkspaceActivated: { id: 1, focused: false } }).switch === null,
   "WorkspaceActivated{focused:false} ignored");

// activation of an id absent from cache -> no switch (no crash).
ok(reduce_event(r1.cache, { WorkspaceActivated: { id: 99, focused: true } }).switch === null,
   "WorkspaceActivated for unknown id -> no switch");

// unnamed workspace STILL yields a target (name null but idx present) — this is the
// fix: position-matching makes numeric/dynamic niri workspaces drive gjoa.
const swu = reduce_event(new Map([[2, { id: 2, idx: 3, name: null }]]),
                         { WorkspaceActivated: { id: 2, focused: true } }).switch;
ok(swu && swu.name === null && swu.idx === 3, "unnamed workspace -> target carries idx (was the silent-noop bug)");

// unrelated events ignored.
ok(reduce_event(r1.cache, { Ok: "Handled" }).switch === null, "Ok ack ignored");
ok(reduce_event(r1.cache, { WindowsChanged: { windows: [] } }).switch === null, "WindowsChanged ignored");

// ── switch-to-target: two-tier (name, then position) ────────────────────────
function mockSpaces() {
  const created = [], activated = [];
  const spaces = {
    _list: [{ id: "w1", name: "Work" }, { id: "m1", name: "Main" }, { id: "p1", name: "Play" }],
    list() { return this._list; },
    create(n) { created.push(n); const s = { id: "new-" + n, name: n }; this._list.push(s); return s; },
    setActive(id) { activated.push(id); },
  };
  return { spaces, created, activated };
}

// Named hit -> setActive existing, case-insensitive, no create.
{ const { spaces, created, activated } = mockSpaces();
  const res = switch_to_target(spaces, { name: "work", idx: 9 });
  ok(created.length === 0 && activated[0] === "w1" && res.action === "activate" && res.by === "name",
     "named hit -> activate by name (case-insensitive), idx ignored"); }

// Named miss -> create then setActive (intentional naming provisions a space).
{ const { spaces, created, activated } = mockSpaces();
  const res = switch_to_target(spaces, { name: "Music", idx: 2 });
  ok(created[0] === "Music" && activated[0] === "new-Music" && res.action === "create",
     "named miss -> create then activate"); }

// Unnamed (name null) -> position match: idx 3 -> the 3rd space (Play).
{ const { spaces, created, activated } = mockSpaces();
  const res = switch_to_target(spaces, { name: null, idx: 3 });
  ok(created.length === 0 && activated[0] === "p1" && res.action === "activate" && res.by === "idx",
     "unnamed idx=3 -> activate 3rd space by position"); }

// Unnamed with empty-string name also falls to position match.
{ const { spaces, activated } = mockSpaces();
  switch_to_target(spaces, { name: "", idx: 1 });
  ok(activated[0] === "w1", "empty-name idx=1 -> activate 1st space"); }

// Unnamed, idx beyond the space count -> no-op (never auto-create anonymous spaces).
{ const { spaces, created, activated } = mockSpaces();
  const res = switch_to_target(spaces, { name: null, idx: 7 });
  ok(created.length === 0 && activated.length === 0 && res.action === "none" && res.reason === "no-space-at-idx",
     "unnamed idx beyond count -> no-op, no create"); }

// Defensive: null target / null spaces -> none, no throw.
ok(switch_to_target(null, { name: "x" }).action === "none", "null spaces -> none");
ok(switch_to_target(mockSpaces().spaces, null).action === "none", "null target -> none");

// ── frame-lines: arbitrary chunk boundaries -> whole lines + carry ──────────
// Two whole lines in one chunk.
{ const f = frame_lines("", "a\nb\n");
  ok(f.lines.length === 2 && f.lines[0] === "a" && f.lines[1] === "b" && f.rest === "", "two whole lines"); }
// Partial line carried forward across chunks.
{ const f1 = frame_lines("", '{"Ok":');
  ok(f1.lines.length === 0 && f1.rest === '{"Ok":', "partial line -> carried, no lines");
  const f2 = frame_lines(f1.rest, '"Handled"}\n');
  ok(f2.lines.length === 1 && f2.lines[0] === '{"Ok":"Handled"}' && f2.rest === "", "carry + complete -> one line"); }
// A line split across THREE chunks reassembles.
{ let buf = "", out = [];
  for (const c of ["hel", "lo wor", "ld\n"]) { const f = frame_lines(buf, c); buf = f.rest; out.push(...f.lines); }
  ok(out.length === 1 && out[0] === "hello world", "line across 3 chunks reassembles"); }
// Empty lines dropped; trailing partial kept.
{ const f = frame_lines("", "x\n\n\ny");
  ok(f.lines.length === 1 && f.lines[0] === "x" && f.rest === "y", "empty lines dropped, trailing partial kept"); }

console.log(`\nniri reduce-event/switch-to-target/frame-lines: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
