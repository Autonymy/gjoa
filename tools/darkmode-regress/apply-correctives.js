/* Content-context (Marionette executeScript): apply corrective text colors computed
 * by the snapshot pass. Each {cn,color} targets the element tagged data-gjoa-cn=cn
 * by rects.js; set color !important so authored / engine-inverted rules don't win.
 * executeScript runs this as a function body — it must `return` (no IIFE).
 * args: [correctives]. */
const cs = arguments[0] || [];
let n = 0;
for (const c of cs) {
  const el = document.querySelector('[data-gjoa-cn="' + c.cn + '"]');
  if (el) { el.style.setProperty("color", c.color, "important"); n++; }
}
return n;
