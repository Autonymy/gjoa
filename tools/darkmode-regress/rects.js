/* Content-context (Marionette executeScript): collect every visible text element's
 * viewport rect + computed text color, plus viewport size + dpr. executeScript
 * runs this as a function body, so it must `return` the value (no IIFE). */
const W = window.innerWidth, H = window.innerHeight, dpr = window.devicePixelRatio || 1;
const parseColor = (s) => { const m = s && s.match(/[\d.]+/g); return (m && m.length >= 3) ? [+m[0], +m[1], +m[2]] : null; };
const hasText = (el) => { for (const n of el.childNodes) if (n.nodeType === 3 && n.textContent.trim().length > 1) return true; return false; };
const out = [];
const all = document.body ? document.body.querySelectorAll("h1,h2,h3,h4,h5,h6,p,a,span,li,td,th,div,button,label,strong,em,blockquote,figcaption,dt,dd") : [];
for (const el of all) {
  if (!hasText(el)) continue;
  const r = el.getBoundingClientRect();
  if (r.width < 10 || r.height < 8 || r.top >= H || r.left >= W || r.bottom <= 0 || r.right <= 0) continue;
  const cs = getComputedStyle(el);
  if (cs.visibility === "hidden" || cs.display === "none" || +cs.opacity === 0) continue;
  const fg = parseColor(cs.color); if (!fg) continue;
  out.push({ x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height),
             fg, tag: el.tagName, text: el.textContent.trim().slice(0, 50) });
}
return { w: W, h: H, dpr, els: out };
