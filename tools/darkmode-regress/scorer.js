#!/usr/bin/env bun
// gjoa dark-mode quality scorer (v1: coverage + leak localization + colorfulness).
// Pure scoreDarkMode(rgba,W,H) so it runs identically here and chrome-side (drawSnapshot).
// Research basis: median-L* coverage (immune to bright minorities), connected-component
// leak detection, Hasler-Susstrunk colorfulness as the muddiness scalar. APCA legibility
// (needs DOM text/bg pairs) lands in v2 via the actor's #normalizeContrast rects.

function toLinear(c8) { const c = c8 / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function wcagY(r, g, b) { return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b); }
function Lstar(Y) { return Y <= 0.008856 ? 903.3 * Y : 116 * Math.cbrt(Y) - 16; }

function colorfulness(buf, N) {           // Hasler & Susstrunk 2003 (0..~110)
  let mrg = 0, myb = 0; const rg = new Float64Array(N), yb = new Float64Array(N);
  for (let i = 0; i < N; i++) { const o = i * 4, R = buf[o], G = buf[o + 1], B = buf[o + 2];
    rg[i] = R - G; yb[i] = 0.5 * (R + G) - B; mrg += rg[i]; myb += yb[i]; }
  mrg /= N; myb /= N;
  let vrg = 0, vyb = 0;
  for (let i = 0; i < N; i++) { vrg += (rg[i] - mrg) ** 2; vyb += (yb[i] - myb) ** 2; }
  return Math.sqrt(vrg / N + vyb / N) + 0.3 * Math.sqrt(mrg * mrg + myb * myb);
}

// rgba = Uint8 buffer of W*H*4 (downsample to ~64x64 before calling for global stats)
// Per-tile chroma STANDARD DEVIATION (not full colorfulness). This is the photo
// detector: a PHOTO has many different colors -> high chroma variance; a FLAT colored UI
// surface (amazon's orange promo banner, a brand header) is uniform -> low variance even
// though it's far from grey. We must NOT exclude flat colored UI as "media" (it should be
// darkened), only true varied media. So key on variance, deliberately dropping the
// mean-chroma-offset term that a flat colored banner would trip.
function tileChromaStd(buf, W, x0, x1, y0, y1) {
  let mrg = 0, myb = 0, c = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const o = (y * W + x) * 4, R = buf[o], G = buf[o + 1], B = buf[o + 2];
    mrg += R - G; myb += 0.5 * (R + G) - B; c++;
  }
  if (!c) return 0;
  const mr = mrg / c, my = myb / c;
  let vrg = 0, vyb = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const o = (y * W + x) * 4, R = buf[o], G = buf[o + 1], B = buf[o + 2];
    vrg += (R - G - mr) ** 2; vyb += (0.5 * (R + G) - B - my) ** 2;
  }
  return Math.sqrt(vrg / c + vyb / c);
}

function scoreDarkMode(buf, W, H) {
  const N = W * H;
  const Ls = new Float64Array(N);
  for (let i = 0; i < N; i++) { const o = i * 4; Ls[i] = Lstar(wcagY(buf[o], buf[o + 1], buf[o + 2])); }
  const globalMedian = Float64Array.from(Ls).sort()[Math.floor(N / 2)];
  // MEDIA-AWARE coverage. Tile into TXxTY; per tile take median L* + colorfulness. A
  // COLORFUL tile is legitimate media (photo/thumbnail/product shot) — the rubric KEEPS
  // it bright (fidelity), so it's excluded from the "are the surfaces dark?" measure and
  // never counts as a leak. Coverage is the darkness of the non-media SURFACE tiles; a
  // bright FLAT tile (un-darkened white/grey UI) is the real leak. This stops the scorer
  // false-failing a correctly-dark, photo-heavy page (cnn, amazon) while still catching a
  // genuinely light page (its flat-white tiles are not media).
  const TX = 16, TY = 16, tw = W / TX, th = H / TY, BRIGHT = 65, MEDIA_STD = 22;
  const tileL = new Float64Array(TX * TY), bright = new Uint8Array(TX * TY), media = new Uint8Array(TX * TY);
  const surfaceLs = [];
  for (let ty = 0; ty < TY; ty++) for (let tx = 0; tx < TX; tx++) {
    const x0 = (tx * tw) | 0, x1 = ((tx + 1) * tw) | 0, y0 = (ty * th) | 0, y1 = ((ty + 1) * th) | 0;
    const v = [];
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) v.push(Ls[y * W + x]);
    v.sort((a, b) => a - b); const m = v[v.length >> 1] || 0; const ti = ty * TX + tx;
    tileL[ti] = m;
    if (tileChromaStd(buf, W, x0, x1, y0, y1) >= MEDIA_STD) {
      media[ti] = 1; // high chroma variance → true varied media (photo), excluded
    } else {
      surfaceLs.push(m);
      if (m >= BRIGHT) bright[ti] = 1; // bright FLAT UI → real leak
    }
  }
  const seen = new Uint8Array(TX * TY), comps = [];
  for (let i = 0; i < TX * TY; i++) {
    if (!bright[i] || seen[i]) continue;
    const st = [i]; seen[i] = 1; let area = 0, peak = 0;
    while (st.length) { const c = st.pop(); area++; peak = Math.max(peak, tileL[c]);
      const cx = c % TX, cy = (c / TX) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy; if (nx < 0 || ny < 0 || nx >= TX || ny >= TY) continue;
        const ni = ny * TX + nx; if (bright[ni] && !seen[ni]) { seen[ni] = 1; st.push(ni); } } }
    comps.push({ area_frac: +(area / (TX * TY)).toFixed(3), peak: Math.round(peak) });
  }
  comps.sort((a, b) => b.area_frac * b.peak - a.area_frac * a.peak);
  const leak_area = comps.reduce((s, c) => s + c.area_frac, 0);
  const media_frac = media.reduce((s, v) => s + v, 0) / (TX * TY);
  // Surface darkness: median L* of the non-media tiles (fall back to global if a page is
  // almost entirely media, so an all-photo page can't read falsely dark).
  const surfMedian = surfaceLs.length >= TX * TY * 0.15
    ? surfaceLs.sort((a, b) => a - b)[surfaceLs.length >> 1]
    : globalMedian;
  const DARK_LO = 20, DARK_HI = 50;
  const coverage_raw = Math.max(0, Math.min(1, (DARK_HI - surfMedian) / (DARK_HI - DARK_LO)));
  const coverage = Math.max(0, coverage_raw - leak_area);
  const verdict = coverage >= 0.7 ? "DARK" : coverage < 0.4 ? "LIGHT/FAIL" : "PARTIAL";
  return {
    coverage: +coverage.toFixed(3), median_Lstar: +surfMedian.toFixed(1),
    leak_area_frac: +leak_area.toFixed(3), media_frac: +media_frac.toFixed(2), leaks: comps.slice(0, 3),
    colorfulness: +colorfulness(buf, N).toFixed(1), verdict,
  };
}

module.exports = { scoreDarkMode, wcagY, Lstar };
if (import.meta.main) {
  const { execSync } = require("child_process"); const fs = require("fs");
  for (const png of process.argv.slice(2)) {
    try {
      execSync(`magick "${png}" -resize 64x64\\! -depth 8 RGBA:/tmp/_score64.raw`);
      const buf = new Uint8Array(fs.readFileSync("/tmp/_score64.raw"));
      const s = scoreDarkMode(buf, 64, 64);
      console.log(`${png.split("/").pop().padEnd(28)} cov=${String(s.coverage).padEnd(6)} medL*=${String(s.median_Lstar).padEnd(5)} leak=${String(s.leak_area_frac).padEnd(6)} M=${String(s.colorfulness).padEnd(5)} ${s.verdict}`);
    } catch (e) { console.log(`${png}  ERR ${e.message}`); }
  }
}
