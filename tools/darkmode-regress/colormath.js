/* colormath.js — the ONE canonical dark-mode color math (#85 dark-mode v2, M0).
 *
 * Shared by BOTH the live harness (runner.bjs prepends this to snap.js so the
 * functions are in browser scope) AND the deterministic bun test
 * (tests/darkmode-colormath.test.js requires it). Keep it browser-safe: no Node
 * APIs, plain function declarations, a guarded CommonJS export at the bottom.
 *
 * It realizes the theory's two FORCED instruments (docs/darkmode-v2.md):
 *   (i)  a perceptually-uniform, hue-separable space  -> OKLab/OKLCH (Ottosson)
 *   (ii) a polarity-aware, near-black-honest contrast -> APCA Lc (SA98G, canonical)
 * and the FORCED operator: hold hue exactly, move only the legibility coordinate
 * (lightness), clamp chroma to gamut, land |Lc| inside the band [floor..ceiling].
 *
 * The OLD correct() (RGB-lerp toward white/black) is kept as correctRGB() ONLY so
 * the test can demonstrate it drifts hue — it is NOT the operator. */

/* ---- APCA (canonical SA98G; APCA's own simple 2.4 TRC, no sRGB toe) ---- */
function linApca(c) { return Math.pow(c / 255, 2.4); }
function Ys(p) { return 0.2126729 * linApca(p[0]) + 0.7151522 * linApca(p[1]) + 0.0721750 * linApca(p[2]); }
function apca(t, b) {
  let Yt = Ys(t), Yb = Ys(b); const bt = 0.022, bc = 1.414;
  if (Yt <= bt) Yt += Math.pow(bt - Yt, bc);
  if (Yb <= bt) Yb += Math.pow(bt - Yb, bc);
  if (Math.abs(Yb - Yt) < 0.0005) return 0;
  let C;
  if (Yb > Yt) { const s = (Math.pow(Yb, 0.56) - Math.pow(Yt, 0.57)) * 1.14; C = s < 0.1 ? 0 : s - 0.027; }
  else { const s = (Math.pow(Yb, 0.65) - Math.pow(Yt, 0.62)) * 1.14; C = s > -0.1 ? 0 : s + 0.027; }
  return C * 100;
}

/* ---- sRGB <-> OKLab <-> OKLCH (Bjorn Ottosson; true sRGB transfer, with toe) ---- */
function toLinear(c8) { const c = c8 / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function toSrgb8(x) {
  x = Math.min(1, Math.max(0, x));
  const s = x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
  return Math.min(255, Math.max(0, Math.round(s * 255)));
}
function srgbToOklab(rgb) {
  const r = toLinear(rgb[0]), g = toLinear(rgb[1]), b = toLinear(rgb[2]);
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const l_ = Math.cbrt(l), m_ = Math.cbrt(m), s_ = Math.cbrt(s);
  return [
    0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
  ];
}
function oklabToLinear(L, a, b) {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ];
}
function srgbToOklch(rgb) {
  const [L, a, b] = srgbToOklab(rgb);
  return [L, Math.hypot(a, b), Math.atan2(b, a)]; // h in radians
}
function inGamut(linRGB) {
  const e = 1e-4;
  return linRGB[0] >= -e && linRGB[0] <= 1 + e && linRGB[1] >= -e && linRGB[1] <= 1 + e && linRGB[2] >= -e && linRGB[2] <= 1 + e;
}
/* OKLCH -> sRGB8, gamut-mapped by reducing CHROMA at fixed L and h (CSS Color 4
 * style) — NEVER a naive RGB clip, which would shift hue and break the solved
 * tone. Holds hue exactly. */
function oklchToSrgb(L, C, h) {
  let lin = oklabToLinear(L, C * Math.cos(h), C * Math.sin(h));
  if (!inGamut(lin)) {
    let lo = 0, hi = C;
    for (let i = 0; i < 20; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklabToLinear(L, mid * Math.cos(h), mid * Math.sin(h)))) lo = mid; else hi = mid;
    }
    lin = oklabToLinear(L, lo * Math.cos(h), lo * Math.sin(h));
  }
  return [toSrgb8(lin[0]), toSrgb8(lin[1]), toSrgb8(lin[2])];
}

/* ---- THE OPERATOR (per-mark step 3 of docs/darkmode-v2.md) ----
 * Land |Lc(mark, frozen bg)| inside the band [T .. ceiling], moving ONLY lightness,
 * holding hue EXACTLY, never ADDING chroma (H-K: shed, don't add). Polarity-pick the
 * lighter/darker side that can reach the band against THIS backdrop, then binary-search
 * the MINIMAL lightness shift that clears T (+3 hysteresis). The minimal-shift solution
 * lands near the floor, so it cannot breach the ceiling; the ceiling clamp is the
 * backstop for surfaces/extremes. Returns sRGB8. */
function correct(fg, bg, T, ceiling) {
  if (ceiling == null) ceiling = 100;
  const [L0, C0, h0] = srgbToOklch(fg);
  const cw = Math.abs(apca([255, 255, 255], bg));
  const cb = Math.abs(apca([0, 0, 0], bg));
  const Lext = cw >= cb ? 1 : 0;                 // forced polarity: toward whichever reads
  const at = (k) => {
    const L = L0 + k * (Lext - L0);
    return oklchToSrgb(L, C0, h0);               // hold hue; chroma clamped to gamut (never added)
  };
  // If even the extreme cannot clear T, return it (backdrop-capped; residual is a bg problem).
  if (Math.abs(apca(at(1), bg)) < T + 3) return at(1);
  let lo = 0, hi = 1, best = at(1);
  for (let i = 0; i < 24; i++) {
    const k = (lo + hi) / 2, c = at(k), lc = Math.abs(apca(c, bg));
    if (lc >= T + 3) { best = c; hi = k; } else { lo = k; }
  }
  // Ceiling backstop: if minimal-shift still breaches the halation ceiling, walk L back
  // toward fg until |Lc| <= ceiling (stays >= floor by construction of the search).
  if (Math.abs(apca(best, bg)) > ceiling) {
    let lo2 = 0, hi2 = 1;
    for (let i = 0; i < 20; i++) {
      const k = (lo2 + hi2) / 2, c = at(k), lc = Math.abs(apca(c, bg));
      if (lc > ceiling) { hi2 = k; } else if (lc < T) { lo2 = k; } else { best = c; break; }
      best = c;
    }
  }
  return best;
}

/* OLD solver — RGB lerp toward white/black. Kept ONLY for the test to show it drifts
 * hue + is non-monotone across the polarity crossing. NOT the operator. */
function correctRGB(fg, bg, T) {
  const cw = Math.abs(apca([255, 255, 255], bg)), cb = Math.abs(apca([0, 0, 0], bg));
  const toward = cw >= cb ? [255, 255, 255] : [0, 0, 0];
  let lo = 0, hi = 1, best = toward.slice();
  for (let i = 0; i < 18; i++) {
    const k = (lo + hi) / 2;
    const c = [Math.round(fg[0] + k * (toward[0] - fg[0])), Math.round(fg[1] + k * (toward[1] - fg[1])), Math.round(fg[2] + k * (toward[2] - fg[2]))];
    if (Math.abs(apca(c, bg)) >= T + 3) { best = c; hi = k; } else { lo = k; }
  }
  return best;
}

/* engine Y->1-lum pre-inversion (RelativeLuminanceUtils::Adjust), replicated exactly. */
function invertLum(rgb) {
  const compute = (u) => { const f = u / 255; return f <= 0.03928 ? f / 12.92 : Math.pow((f + 0.055) / 1.055, 2.4); };
  const decompute = (x) => { const s = x <= 0.03928 / 12.92 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055; return Math.min(255, Math.max(0, Math.round(s * 255))); };
  const lr = compute(rgb[0]), lg = compute(rgb[1]), lb = compute(rgb[2]);
  const lum = 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
  const target = 1 - lum, factor = (target + 0.05) / (lum + 0.05);
  const adj = (l) => decompute(Math.max(0, (l + 0.05) * factor - 0.05));
  return [adj(lr), adj(lg), adj(lb)];
}

/* ---- The four falsification metrics (docs/darkmode-v2.md Part II) ---- */
// (1) hue-drift: |Δh| in OKLCH degrees; 0 for achromatic endpoints.
function hueDriftDeg(a, b) {
  const ca = srgbToOklch(a), cb = srgbToOklch(b);
  if (ca[1] < 0.002 || cb[1] < 0.002) return 0; // achromatic: hue undefined, no drift
  let d = Math.abs(ca[2] - cb[2]) * 180 / Math.PI;
  if (d > 180) d = 360 - d;
  return d;
}
// (2) two-sided band: a mark is a FAIL if below the floor OR above the halation ceiling.
function apcaBand(mark, bg, floor, ceiling) {
  const lc = Math.abs(apca(mark, bg));
  return { lc: lc, belowFloor: lc < floor, aboveCeiling: lc > ceiling, inBand: lc >= floor && lc <= ceiling };
}
// (3) sign/polarity against the real backdrop: +1 mark lighter than ground, -1 darker.
function polaritySign(fg, bg) { const d = Ys(fg) - Ys(bg); return d > 1e-6 ? 1 : d < -1e-6 ? -1 : 0; }
// (4) convergence: a naive JOINT fg+bg solve (each chases the other's last value) — returns
//     the |Lc| history so a test can assert it oscillates (never settles) vs the frozen-bg solve.
function jointSolveHistory(fg0, bg0, T, iters) {
  let fg = fg0.slice(), bg = bg0.slice(); const hist = [];
  for (let i = 0; i < (iters || 12); i++) {
    const nf = correctRGB(fg, bg, T);  // mark chases current ground
    const nb = correctRGB(bg, fg, T);  // ground chases current mark (the illegal joint move)
    fg = nf; bg = nb;
    hist.push(Math.abs(apca(fg, bg)));
  }
  return hist;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    linApca, Ys, apca, toLinear, toSrgb8, srgbToOklab, oklabToLinear, srgbToOklch,
    inGamut, oklchToSrgb, correct, correctRGB, invertLum,
    hueDriftDeg, apcaBand, polaritySign, jointSolveHistory,
  };
}
