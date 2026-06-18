// Tiny local HTTP fixture for the M2 cosmetic actor test. Serves one page on
// http://127.0.0.1:8975/ containing a static element that a cosmetic rule
// should hide at load, plus a control element that must stay visible. Local so
// the test never depends on remote network. Run with: bun (or node) this file.
import { createServer } from "node:http";

const PORT = 8975;
const HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>gjoa cosmetic fixture</title></head>
<body>
  <div class="gjoa-probe-static" id="static">STATIC AD</div>
  <div class="gjoa-keep" id="keep">KEEP ME</div>
</body></html>`;

// A themeless LIGHT page (default white) is served at "/"; a NATIVE-DARK page
// (authored dark root/body) at "/dark", so the dark-mode hybrid actor's two
// decisions can be exercised deterministically: light -> invert, dark -> keep.
const HTML_DARK = `<!doctype html>
<html style="background:#111"><head><meta charset="utf-8"><title>gjoa dark fixture</title>
<style>html,body{background:#111;color:#eee}</style></head>
<body><div id="content">NATIVE DARK</div></body></html>`;

const server = createServer((req, res) => {
  const dark = req.url && req.url.startsWith("/dark");
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(dark ? HTML_DARK : HTML);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`cosmetic-fixture-server listening on http://127.0.0.1:${PORT}/`);
});
