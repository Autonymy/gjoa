#!/usr/bin/env python3
"""Decisive checks for the #130 link-hints hardening (Vimium/Tridactyl lessons):
  A. CLOSED shadow-DOM piercing — a link inside a closed shadow root gets a hint
     (the fork advantage; the old querySelectorAll path gave 0).
  B. Occlusion — a link fully covered by an opaque overlay gets NO hint.
  C. Regression — a normal page still hints its links (hardening didn't over-filter).
Drives the GjoaInput actor's LinkHints:Show directly from chrome (no 'f' binding).
"""
import argparse, base64, json, socket, sys, time


class M:
    def __init__(self, port, host="127.0.0.1", timeout=90):
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
        self._frame()

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
    def navigate(self, url): return self.send("WebDriver:Navigate", {"url": url})

    def exe(self, script):
        r = self.send("WebDriver:ExecuteScript",
                      {"script": script, "args": [], "scriptTimeout": 30000, "newSandbox": False})
        return r.get("value") if isinstance(r, dict) else r

    def quit(self):
        try: self.send("Marionette:Quit", {"flags": ["eForceQuit"]})
        except SystemExit: pass


SHOW = ('gBrowser.selectedBrowser.browsingContext.currentWindowGlobal'
        '.getActor("GjoaInput").sendQuery("LinkHints:Show",{newTab:false}); return "sent";')
CANCEL = ('gBrowser.selectedBrowser.browsingContext.currentWindowGlobal'
          '.getActor("GjoaInput").sendQuery("LinkHints:Cancel"); return "sent";')
COUNT = "return document.querySelectorAll('[data-gjoa-hints] span').length;"

SHADOW_DOM = """
document.body.innerHTML = '<div id="host"></div>';
var sr = document.getElementById('host').attachShadow({mode:'closed'});
var a = document.createElement('a');
a.href='https://example.com/shadow'; a.textContent='shadow link';
a.style.cssText='display:block;width:140px;height:26px;position:fixed;left:30px;top:30px';
sr.appendChild(a);
return 'ok';
"""

OCCLUDED = """
document.body.innerHTML =
  '<a id="lk" href="https://example.com/under" style="position:fixed;left:20px;top:20px;width:140px;height:26px;display:block">under</a>'
  + '<div style="position:fixed;left:0;top:0;width:100%;height:100%;background:#000;z-index:99999"></div>';
return 'ok';
"""


def show_and_count(m):
    m.ctx("chrome"); m.exe(SHOW); time.sleep(0.7)
    m.ctx("content"); n = m.exe(COUNT)
    m.ctx("chrome"); m.exe(CANCEL); time.sleep(0.2)
    return n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=2828)
    ap.add_argument("--base-url", default="http://127.0.0.1:8976/hacker-news")
    a = ap.parse_args()
    m = M(a.port); m.newsession()
    m.ctx("content"); m.navigate(a.base_url); time.sleep(1.0)

    # C. regression — normal page
    base = show_and_count(m)
    # A. closed shadow piercing
    m.ctx("content"); m.exe(SHADOW_DOM); time.sleep(0.2)
    shadow = show_and_count(m)
    # B. occlusion
    m.ctx("content"); m.exe(OCCLUDED); time.sleep(0.2)
    occ = show_and_count(m)

    print(f"C regression (normal page): {base} hints  (expect > 5)", file=sys.stderr)
    print(f"A closed-shadow piercing:   {shadow} hints (expect >= 1)", file=sys.stderr)
    print(f"B occlusion (covered link): {occ} hints  (expect 0)", file=sys.stderr)
    ok = (base and base > 5) and (shadow and shadow >= 1) and (occ == 0)
    print("RESULT:", "PASS" if ok else
          f"C={'ok' if base and base>5 else 'FAIL'} A={'ok' if shadow and shadow>=1 else 'FAIL'} B={'ok' if occ==0 else 'FAIL'}",
          file=sys.stderr)
    m.quit()
    sys.exit(0 if ok else 2)


if __name__ == "__main__":
    main()
