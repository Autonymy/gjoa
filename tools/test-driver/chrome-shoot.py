#!/usr/bin/env python3
"""Raw-socket Marionette client that screenshots the CHROME window (sidebar /
tabs / drawer / toolbars) — not page content. Companion to marionette_shot.py
(which shoots content). Dependency-free (~120 lines), same wire format.

Chrome-context screenshots need the browser launched with
`-remote-allow-system-access` (newer Firefox gates SetContext('chrome') on it).
The launcher (chrome-gallery.sh) passes it.

Usage:
    chrome-shoot.py --port 2829 --out /tmp/chrome.png \
        [--settle-ms 3500] [--eval "<chrome JS to run first>"] [--probe]

--probe dumps a small chrome diagnostic (icons present, gjoa state, JS errors)
to stderr — used to assert structure independent of pixel fidelity, since the
headless SWGL compositor can swap R/B channels (colors unreliable, layout fine).
"""
import argparse, base64, json, socket, sys, time


class Marionette:
    def __init__(self, port, host="127.0.0.1", timeout=60):
        self.buf = b""; self.id = 1
        deadline = time.time() + timeout; last = None
        while time.time() < deadline:
            try:
                self.s = socket.create_connection((host, port), timeout=10)
                self.s.settimeout(120); break
            except OSError as e:
                last = e; time.sleep(0.2)
        else:
            raise SystemExit(f"connect {host}:{port} failed: {last}")
        self._frame()  # discard banner

    def _frame(self):
        while b":" not in self.buf:
            c = self.s.recv(65536)
            if not c: raise SystemExit("socket closed (header)")
            self.buf += c
        i = self.buf.index(b":"); n = int(self.buf[:i]); need = i + 1 + n
        while len(self.buf) < need:
            c = self.s.recv(65536)
            if not c: raise SystemExit("socket closed (body)")
            self.buf += c
        p = self.buf[i + 1:need]; self.buf = self.buf[need:]
        return json.loads(p.decode())

    def send(self, name, params):
        mid = self.id; self.id += 1
        msg = json.dumps([0, mid, name, params]).encode()
        self.s.sendall(f"{len(msg)}:".encode() + msg)
        while True:
            r = self._frame()
            if isinstance(r, list) and r[0] == 1 and r[1] == mid:
                if r[2]: raise SystemExit(f"{name} error: {r[2]}")
                return r[3]

    def newsession(self):
        return self.send("WebDriver:NewSession",
                         {"capabilities": {"alwaysMatch": {}, "firstMatch": [{}]}})

    def ctx(self, c): self.send("Marionette:SetContext", {"value": c})

    def exec_chrome(self, script, args=None):
        return self.send("WebDriver:ExecuteScript",
                         {"script": script, "args": args or [],
                          "scriptTimeout": 30000, "newSandbox": False})

    def shot(self, full=True):
        r = self.send("WebDriver:TakeScreenshot", {"full": full, "hash": False})
        return r if isinstance(r, str) else r.get("value")

    def quit(self):
        try: self.send("Marionette:Quit", {"flags": ["eForceQuit"]})
        except SystemExit: pass


PROBE_JS = r"""
  const out = {};
  try { out.url = window.location.href; } catch(e) { out.url = '?'+e; }
  try { out.hasGjoa = !!window.Gjoa; } catch(e) {}
  try { out.tabPanel = !!document.getElementById('gjoa-tab-panel'); } catch(e) {}
  try { out.sidebarMain = !!document.querySelector('sidebar-main, #sidebar-main'); } catch(e) {}
  try { const imgs = document.querySelectorAll('#gjoa-tab-panel image, #gjoa-tab-panel .gjoa-favicon');
        out.favicons = imgs.length; } catch(e) { out.favicons = '?'+e; }
  try { out.booting = document.documentElement.getAttribute('gjoa-booting'); } catch(e) {}
  return JSON.stringify(out);
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=2829)
    ap.add_argument("--out", required=True)
    ap.add_argument("--settle-ms", type=int, default=3000)
    ap.add_argument("--eval", default=None, help="chrome JS to run before the shot")
    ap.add_argument("--probe", action="store_true")
    a = ap.parse_args()

    m = Marionette(a.port)
    m.newsession()
    m.ctx("chrome")
    if a.eval:
        try: m.exec_chrome(a.eval)
        except SystemExit as e: print("eval error:", e, file=sys.stderr)
    time.sleep(a.settle_ms / 1000.0)
    if a.probe:
        try: print("PROBE:", m.exec_chrome(PROBE_JS), file=sys.stderr)
        except SystemExit as e: print("probe error:", e, file=sys.stderr)
    png = base64.b64decode(m.shot(True))
    with open(a.out, "wb") as f:
        f.write(png)
    print(f"wrote {a.out} ({len(png)} bytes)", file=sys.stderr)
    m.quit()


if __name__ == "__main__":
    main()
