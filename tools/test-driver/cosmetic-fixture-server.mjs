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

// Dark-mode hybrid fixtures. "/light" is a real THEMELESS-LIGHT site: it hardcodes
// a white background and ignores prefers-color-scheme, so hybrid mode must invert
// it. "/dark" is a NATIVE-DARK site (authored dark root/body) that hybrid must
// keep. (The plain "/" page authors no background at all, so under hybrid's forced
// prefers-color-scheme:dark it renders with the UA dark canvas — already dark, not
// a themeless-light case — so it is NOT used for the invert assertion.)
const HTML_LIGHT = `<!doctype html>
<html style="background:#fff"><head><meta charset="utf-8"><title>gjoa light fixture</title>
<style>html,body{background:#fff;color:#111}</style></head>
<body><div id="content">THEMELESS LIGHT</div></body></html>`;
const HTML_DARK = `<!doctype html>
<html style="background:#111"><head><meta charset="utf-8"><title>gjoa dark fixture</title>
<style>html,body{background:#111;color:#eee}</style></head>
<body><div id="content">NATIVE DARK</div>
<div id="dm-probe" style="position:fixed;top:0;left:0;width:80px;height:80px;background:#fff;z-index:99999"></div>
</body></html>`;

const server = createServer((req, res) => {
  const url = req.url || "";
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(
    url.startsWith("/dark") ? HTML_DARK : url.startsWith("/light") ? HTML_LIGHT : HTML
  );
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`cosmetic-fixture-server listening on http://127.0.0.1:${PORT}/`);
});
