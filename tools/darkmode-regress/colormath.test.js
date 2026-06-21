/* Deterministic M0 gate for dark-mode v2 (#85): proves the canonical color math
 * (the OKLCH retone + tone-space APCA band-solve) WITHOUT a live site or a build.
 * Run: bun test tools/darkmode-regress/colormath.test.js
 *
 * Each assertion ties to a theorem in docs/darkmode-v2.md: hold-hue (Δh=0),
 * land-in-band, halation ceiling, monotone-in-lightness, polarity conserved,
 * freeze-bg converges / joint solve oscillates. */
import { test, expect, describe } from "bun:test";
import {
  apca, srgbToOklch, oklchToSrgb, correct, correctRGB,
  hueDriftDeg, apcaBand, polaritySign, jointSolveHistory,
} from "./colormath.js";

const FLOOR = 45, CEIL = 90;

describe("OKLab instrument", () => {
  test("sRGB → OKLCH → sRGB round-trips within ±2/channel", () => {
    for (const c of [[40, 90, 220], [225, 64, 64], [18, 18, 18], [245, 245, 245], [120, 200, 120], [200, 180, 40]]) {
      const [L, C, h] = srgbToOklch(c);
      const back = oklchToSrgb(L, C, h);
      for (let i = 0; i < 3; i++) expect(Math.abs(back[i] - c[i])).toBeLessThanOrEqual(2);
    }
  });
});

describe("the operator — hold hue, land in band", () => {
  // A chromatic mark on a DARK ground must brighten (light-on-dark); the tone-space
  // solver moves only L and must hold hue. The old RGB-lerp toward white desaturates.
  const fg = [40, 90, 220], bg = [20, 20, 20];

  test("new correct() holds hue (Δh ≈ 0)", () => {
    const out = correct(fg, bg, FLOOR, CEIL);
    expect(hueDriftDeg(fg, out)).toBeLessThan(2.0); // forced: hue in no constraint → Δh=0
  });

  test("new holds hue near-exactly while the old RGB-lerp drifts materially more", () => {
    // marks that genuinely need a large shift — the regime where the old solver
    // walks toward an extreme and desaturates, rotating hue. The new operator moves
    // only lightness, so it holds hue by construction (the refuted-vs-forced contrast).
    const cases = [[[120, 40, 40], [110, 110, 110]], [[40, 60, 160], [120, 120, 120]],
                   [[30, 120, 40], [130, 130, 130]], [[225, 64, 64], [20, 20, 20]]];
    let oldSum = 0, newSum = 0;
    for (const [f, b] of cases) {
      const od = hueDriftDeg(f, correctRGB(f, b, FLOOR));
      const nd = hueDriftDeg(f, correct(f, b, FLOOR, CEIL));
      expect(nd).toBeLessThan(1.5);           // new: hue held near-exactly, EVERY case
      oldSum += od; newSum += nd;
    }
    expect(oldSum / cases.length).toBeGreaterThan(newSum / cases.length + 2); // old drifts materially more
  });

  test("new correct() lands the mark inside the band [floor..ceiling]", () => {
    const out = correct(fg, bg, FLOOR, CEIL);
    const band = apcaBand(out, bg, FLOOR, CEIL);
    expect(band.belowFloor).toBe(false);
    expect(band.aboveCeiling).toBe(false);
  });

  test("polarity is conserved (mark stays on the readable side of its ground)", () => {
    const out = correct(fg, bg, FLOOR, CEIL);
    // dark ground → mark must be lighter than ground
    expect(polaritySign(out, bg)).toBe(1);
  });

  test("holds hue across many chromatic marks on varied grounds", () => {
    const grounds = [[18, 18, 18], [30, 30, 36], [245, 245, 245], [240, 235, 225]];
    const marks = [[40, 90, 220], [200, 40, 40], [40, 160, 80], [200, 170, 30], [150, 60, 200]];
    for (const bg of grounds) for (const m of marks) {
      const out = correct(m, bg, FLOOR, CEIL);
      expect(hueDriftDeg(m, out)).toBeLessThan(2.5);
    }
  });
});

describe("the band — two-sided (the ceiling the |Lc|<45-only harness is blind to)", () => {
  test("pure white on near-black is a HALATION fail (above ceiling), not a pass", () => {
    const band = apcaBand([255, 255, 255], [18, 18, 18], FLOOR, CEIL);
    expect(band.lc).toBeGreaterThan(100);      // |Lc| ~106
    expect(band.aboveCeiling).toBe(true);       // the bug the old metric scored as PASS
  });

  test("the solver does NOT emit white-on-near-black (respects the ceiling)", () => {
    const out = correct([90, 90, 90], [18, 18, 18], FLOOR, CEIL);
    expect(apcaBand(out, [18, 18, 18], FLOOR, CEIL).aboveCeiling).toBe(false);
  });
});

describe("monotonicity — |Lc| is monotone in lightness on a fixed ground", () => {
  test("sweeping a gray mark away from a fixed dark ground is non-decreasing", () => {
    const bg = [18, 18, 18];
    let prev = -1;
    for (let g = 30; g <= 255; g += 5) {
      const lc = Math.abs(apca([g, g, g], bg));
      expect(lc).toBeGreaterThanOrEqual(prev - 1e-9); // monotone (the 1-D root-find precondition)
      prev = lc;
    }
  });
});

describe("convergence — freeze-ground-first vs the joint solve (existence of a solution)", () => {
  const fg = [40, 90, 220], bg = [20, 20, 20];

  test("frozen-ground solve converges to a stable in-floor color", () => {
    const out = correct(fg, bg, FLOOR, CEIL);
    expect(Math.abs(apca(out, bg))).toBeGreaterThanOrEqual(FLOOR); // a solution exists + is found
  });

  test("freeze-ground-first reaches the band where the joint solve collapses to illegible", () => {
    // A low-contrast near-gray pair: freezing the ground and solving the mark reaches
    // the floor; letting BOTH chase each other drives the pair to Lc≈0 (both converge
    // to the same color — the non-contraction the theory predicts). Existence-of-a-
    // solution depends on freezing, exactly as docs/darkmode-v2.md derives.
    const f = [100, 100, 100], b = [120, 120, 120];
    const frozen = correct(f, b, FLOOR, CEIL);
    expect(Math.abs(apca(frozen, b))).toBeGreaterThanOrEqual(FLOOR); // a solution exists + is found
    const tail = jointSolveHistory(f, b, FLOOR, 14).slice(-6);
    expect(Math.max(...tail)).toBeLessThan(FLOOR);                   // joint collapses below legibility
  });
});
