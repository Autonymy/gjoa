/* Chrome-context (Marionette executeAsyncScript): capture the active tab's
 * composited content via drawSnapshot (Fission-safe), then for each text rect from
 * rects.js compute APCA Lc(text-color, MEDIAN sampled backdrop pixel). |Lc| <
 * threshold = a dark-on-dark / low-contrast FAIL. args: [meta, threshold, normalize?].
 * When normalize is true, ALSO return per-failing-element corrective text colors
 * (re-polarized against the real backdrop to clear the APCA floor, hue preserved):
 * a content pass applies them, then this script is re-run to measure the residual.
 * resolves { checked, total, fails:[worst...], correctives:[{cn,color}], err? }. */
const done = arguments[arguments.length - 1];
const meta = arguments[0];
const THRESHOLD = arguments[1] || 45;
const NORMALIZE = arguments[2] || false;

function lin(c) { return Math.pow(c / 255, 2.4); }
function Ys(p) { return 0.2126729 * lin(p[0]) + 0.7151522 * lin(p[1]) + 0.0721750 * lin(p[2]); }
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

/* Corrective text color for fg over backdrop bg to clear |Lc| >= T. Choose the
 * polarity (toward white or toward black) that yields the MOST contrast against
 * THIS backdrop, then binary-search the minimal shift along fg→extreme that clears
 * T (+3 margin) — minimal shift preserves the original hue as far as possible.
 * If even the extreme can't reach T (mid-gray backdrop caps achievable contrast),
 * returns the extreme (best achievable; the residual is then a backdrop problem). */
function correct(fg, bg, T) {
  const cw = Math.abs(apca([255, 255, 255], bg));
  const cb = Math.abs(apca([0, 0, 0], bg));
  const toward = cw >= cb ? [255, 255, 255] : [0, 0, 0];
  let lo = 0, hi = 1, best = toward.slice();
  for (let i = 0; i < 18; i++) {
    const k = (lo + hi) / 2;
    const c = [Math.round(fg[0] + k * (toward[0] - fg[0])),
               Math.round(fg[1] + k * (toward[1] - fg[1])),
               Math.round(fg[2] + k * (toward[2] - fg[2]))];
    if (Math.abs(apca(c, bg)) >= T + 3) { best = c; hi = k; } else { lo = k; }
  }
  return best;
}

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

    const fails = []; const correctives = []; let checked = 0;
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
      if (Lc < THRESHOLD) {
        fails.push({ lc: Math.round(Lc), fg: el.fg, bg, tag: el.tag, text: el.text, x: el.x, y: el.y, cn: el.cn });
        if (NORMALIZE && el.cn != null) {
          const c = correct(el.fg, bg, THRESHOLD);
          correctives.push({ cn: el.cn, color: "rgb(" + c[0] + "," + c[1] + "," + c[2] + ")" });
        }
      }
    }
    fails.sort((a, c) => a.lc - c.lc);
    done({ checked, total: fails.length, fails: fails.slice(0, 40), correctives });
  } catch (e) { done({ err: String(e && e.message || e) }); }
})();
