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

const server = createServer((req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(HTML);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`cosmetic-fixture-server listening on http://127.0.0.1:${PORT}/`);
});
