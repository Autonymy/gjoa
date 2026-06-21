/* Chrome-context (Marionette executeAsyncScript): capture the active tab's
 * composited content via drawSnapshot (Fission-safe), then for each text rect from
 * rects.js compute APCA Lc(text-color, MEDIAN sampled backdrop pixel). |Lc| <
 * threshold = a dark-on-dark / low-contrast FAIL. args: [meta, threshold, normalize?].
 * When normalize is true, ALSO return per-failing-element corrective text colors
 * (re-polarized against the real backdrop to clear the APCA floor, hue preserved):
 * a content pass applies them, then this script is re-run to measure the residual.
 * resolves { checked, total, fails:[worst...], correctives:[{cn,color}], err? }. */
/* The color math (Ys, apca, correct, invertLum, OKLab) lives in colormath.js, which
 * runner.bjs PREPENDS to this script so the functions are in scope here. correct() is
 * now the tone-space OKLCH band-solve (hold hue, move lightness, clamp to band). */
const done = arguments[arguments.length - 1];
const meta = arguments[0];
const THRESHOLD = arguments[1] || 45;
const NORMALIZE = arguments[2] || false;
const PREINVERT = arguments[3] || false;
const CEILING = arguments[4] || 90;   // halation ceiling (the band's upper edge)

(async () => {
  try {
    const win = Services.wm.getMostRecentWindow("navigator:browser");
    const b = win.gBrowser.selectedBrowser;
    const wg = b.browsingContext.currentWindowGlobal;
    const W = meta.w, H = meta.h;
    const bitmap = await wg.drawSnapshot(new win.DOMRect(0, 0, W, H), 1, "rgb(0,0,0)");
    const canvas = new win.OffscreenCanvas(W, H);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0);
    const data = ctx.getImageData(0, 0, W, H).data;
    const px = (x, y) => { const i = (y * W + x) * 4; return [data[i], data[i + 1], data[i + 2]]; };

    const fails = []; const correctives = []; const halation = []; let checked = 0;
    for (const el of meta.els) {
      const x0 = Math.max(0, el.x), y0 = Math.max(0, el.y);
      const x1 = Math.min(W - 1, el.x + el.w), y1 = Math.min(H - 1, el.y + el.h);
      if (x1 <= x0 || y1 <= y0) continue;
      const samples = [];
      const sx = Math.max(1, Math.floor((x1 - x0) / 14)), sy = Math.max(1, Math.floor((y1 - y0) / 6));
      for (let y = y0; y <= y1; y += sy) for (let x = x0; x <= x1; x += sx) samples.push(px(x, y));
      if (samples.length < 4) continue;
      samples.sort((a, c) => Ys(a) - Ys(c));
      const bg = samples[Math.floor(samples.length / 2)]; // median luminance ≈ backdrop
      const Lc = Math.abs(apca(el.fg, bg)); checked++;
      // Two-sided band (docs/darkmode-v2.md): the HALATION ceiling. |Lc| above the
      // ceiling (e.g. pure-white-on-near-black ~106) is over-contrast = a fail the
      // floor-only metric is blind to. Reported separately so the floor gate/baseline
      // stays comparable; this is what makes the band's upper edge falsifiable.
      if (Lc > CEILING) halation.push({ lc: Math.round(Lc), fg: el.fg, bg, tag: el.tag, x: el.x, y: el.y });
      if (Lc < THRESHOLD) {
        fails.push({ lc: Math.round(Lc), fg: el.fg, bg, tag: el.tag, text: el.text, x: el.x, y: el.y, cn: el.cn });
        if (NORMALIZE && el.cn != null) {
          const c = correct(el.fg, bg, THRESHOLD, CEILING);
          // pre-invert ONLY when the engine is actually inverting this document
          // (meta.inverted) — native-dark sites are left un-inverted, so applying a
          // pre-inverted color there would render the inverse of what we want.
          const a = (PREINVERT && meta.inverted) ? invertLum(c) : c;
          correctives.push({ cn: el.cn, color: "rgb(" + a[0] + "," + a[1] + "," + a[2] + ")" });
        }
      }
    }
    fails.sort((a, c) => a.lc - c.lc);
    halation.sort((a, c) => c.lc - a.lc);
    done({ checked, total: fails.length, fails: fails.slice(0, 40), correctives,
           halationCount: halation.length, halation: halation.slice(0, 40) });
  } catch (e) { done({ err: String(e && e.message || e) }); }
})();
