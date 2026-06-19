// Tiny local HTTP fixture server for the dark-mode contrast-regression harness
// (#55). Serves the self-contained pages under fixtures/contrast/<name>/index.html
// on http://127.0.0.1:8976/<name>. Each fixture models a specific dark-mode
// failure class (white text over a dark background-image, native-dark sites,
// dark text over a light image, etc.) so the contrast oracle can score it.
// Local so the test never depends on remote network. Run with: bun (or node).
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = 8976;
const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, "fixtures", "contrast");

// The fixture names, in a stable order, used both for routing and the index page.
const NAMES = [
  "mit-news",
  "hacker-news",
  "youtube",
  "wikipedia",
  "github",
  "editorial-card",
  "docs-codeblocks",
  "svg-logo",
  "dark-text-hero",
];

const indexPage = () =>
  `<!doctype html>
<html><head><meta charset="utf-8"><title>gjoa contrast fixtures</title></head>
<body>
  <h1>gjoa contrast fixtures</h1>
  <ul>
${NAMES.map((n) => `    <li><a href="/${n}">${n}</a></li>`).join("\n")}
  </ul>
</body></html>`;

const server = createServer((req, res) => {
  const url = req.url || "";
  // Strip query string and a single trailing slash, then take the first segment.
  const path = url.split("?")[0].replace(/\/+$/, "");
  const name = path.replace(/^\//, "");

  if (name === "") {
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(indexPage());
    return;
  }

  if (NAMES.includes(name)) {
    try {
      const html = readFileSync(join(FIXTURES, name, "index.html"), "utf8");
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(html);
      return;
    } catch {
      // fall through to 404 if the file is missing
    }
  }

  res.writeHead(404, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(`<!doctype html><html><body><h1>404</h1></body></html>`);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`contrast-fixture-server listening on http://127.0.0.1:${PORT}/`);
});
