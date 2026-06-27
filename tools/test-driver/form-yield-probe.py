#!/usr/bin/env python3
"""Direct proof that vim YIELDS to form fields: focus a real text input, type
'test' via real key events, and assert the characters land IN the input (value
== 'test') and NO picker opened. Then confirm vim is still live when NOT in a
field ('f' renders hints). Drives the same gjoa-dev binary `gjoa dev` runs.
"""
import argparse, base64, json, socket, sys, time

SPECIAL = {"Escape": chr(0xE00C)}


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
            if not c: raise SystemExit("socket closed")
            self.buf += c
        i = self.buf.index(b":"); n = int(self.buf[:i]); need = i + 1 + n
        while len(self.buf) < need:
            c = self.s.recv(65536)
            if not c: raise SystemExit("socket closed")
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
        return self.send("WebDriver:NewSession", {"capabilities": {"alwaysMatch": {}, "firstMatch": [{}]}})

    def ctx(self, c): self.send("Marionette:SetContext", {"value": c})
    def navigate(self, url): return self.send("WebDriver:Navigate", {"url": url})

    def exe(self, script):
        r = self.send("WebDriver:ExecuteScript",
                      {"script": script, "args": [], "scriptTimeout": 30000, "newSandbox": False})
        return r.get("value") if isinstance(r, dict) else r

    def keys(self, s):
        acts = []
        for ch in s:
            v = SPECIAL.get(ch, ch)
            acts += [{"type": "keyDown", "value": v}, {"type": "keyUp", "value": v}]
        self.send("WebDriver:PerformActions", {"actions": [{"type": "key", "id": "kb", "actions": acts}]})

    def quit(self):
        try: self.send("Marionette:Quit", {"flags": ["eForceQuit"]})
        except SystemExit: pass


FORM = "data:text/html,<body style='height:2000px'><input id=i style='position:fixed;top:0;left:0'></body>"
PICKER = "const p=document.getElementById('gjoa-picker'); return !!(p && !p.hidden);"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=2828)
    a = ap.parse_args()
    m = M(a.port); m.newsession()
    m.ctx("chrome")
    for _ in range(40):
        if m.exe("return !!(window.gBrowser && window.gjoaTest && window.gjoaTest.vim);"):
            break
        time.sleep(0.25)

    # focus a real text input on a content page
    m.ctx("content"); m.navigate(FORM); time.sleep(1.0)
    m.exe("var i=document.getElementById('i'); i.focus(); return document.activeElement===i;")
    time.sleep(0.4)

    # type 't','e','s','t' — 't' is a vim hotkey, so this is the misfire test
    m.keys("test"); time.sleep(0.6)
    val = m.exe("return (document.getElementById('i')||{}).value;")
    m.ctx("chrome"); picker_after_form = m.exe(PICKER)
    print(f"FORM-YIELD: input.value={val!r} (expect 'test')  pickerOpened={picker_after_form} (expect False)", file=sys.stderr)
    yielded = (val == "test") and (not picker_after_form)

    # now blur the field → vim must be LIVE again ('f' shows hints)
    m.ctx("content")
    m.exe("document.activeElement && document.activeElement.blur(); return 1;")
    m.ctx("chrome"); m.exe("try{gBrowser.selectedBrowser.focus();}catch(e){} return 1;")
    time.sleep(0.3)
    m.keys("f"); time.sleep(0.8)
    m.ctx("content")
    hints = m.exe("return document.querySelectorAll('[data-gjoa-hints] span').length;")
    print(f"VIM-LIVE: after blur, 'f' rendered {hints} hints (expect >0)", file=sys.stderr)

    ok = yielded and (hints and hints > 0)
    print("RESULT:", "PASS — vim yields to forms AND is live outside them" if ok else
          f"FAIL yield={yielded} hints={hints}", file=sys.stderr)
    m.quit(); sys.exit(0 if ok else 2)


if __name__ == "__main__":
    main()
