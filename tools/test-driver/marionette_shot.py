#!/usr/bin/env python3
"""Minimal raw-socket Marionette client for render-waited screenshots.

Marionette is Firefox's privileged remote-control protocol. Wire format
(see ~/code/firefox/remote/marionette/packets.sys.mjs):

    <utf8-byte-length>:<json-payload>

Each JSON payload is a command [0, msgId, name, params] or a response
[1, msgId, error|null, result|null]. The server's first frame is an info
banner ({applicationType, marionetteProtocol}) which we read and discard.

We avoid geckodriver / marionette_driver (neither is installed here) — this
is a ~150-line dependency-free client that does exactly: NewSession, Navigate,
ExecuteAsyncScript (to poll for a rendered selector), TakeScreenshot.

Usage:
    marionette_shot.py --port 2829 --url about:gjoa \
        --wait-selector '#sec-dark-mode-color' --out /tmp/about-gjoa-rendered.png

Exit 0 on success (PNG written), nonzero on any failure.
"""
import argparse
import base64
import json
import socket
import sys
import time


class MarionetteError(RuntimeError):
    pass


class Marionette:
    def __init__(self, host="127.0.0.1", port=2828, connect_timeout=30.0):
        self.host = host
        self.port = port
        self.sock = None
        self.buf = b""
        self.next_id = 1
        self._connect(connect_timeout)
        self._read_banner()

    def _connect(self, timeout):
        deadline = time.time() + timeout
        last = None
        while time.time() < deadline:
            try:
                self.sock = socket.create_connection((self.host, self.port), timeout=10)
                self.sock.settimeout(60)
                return
            except OSError as e:
                last = e
                time.sleep(0.15)
        raise MarionetteError(f"could not connect to {self.host}:{self.port}: {last}")

    def _recv_frame(self):
        # A frame is <len>:<json>. Accumulate until we have the colon header
        # and then `len` bytes of body.
        while b":" not in self.buf:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise MarionetteError("socket closed while reading header")
            self.buf += chunk
        colon = self.buf.index(b":")
        length = int(self.buf[:colon])
        need = colon + 1 + length
        while len(self.buf) < need:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise MarionetteError("socket closed while reading body")
            self.buf += chunk
        payload = self.buf[colon + 1:need]
        self.buf = self.buf[need:]
        return json.loads(payload.decode("utf8"))

    def _read_banner(self):
        # First frame is the banner object, not a [type, id, ...] array.
        self._recv_frame()

    def send(self, name, params=None):
        mid = self.next_id
        self.next_id += 1
        cmd = json.dumps([0, mid, name, params or {}])
        framed = f"{len(cmd.encode('utf8'))}:{cmd}".encode("utf8")
        self.sock.sendall(framed)
        while True:
            msg = self._recv_frame()
            if isinstance(msg, list) and len(msg) == 4 and msg[0] == 1 and msg[1] == mid:
                _, _, err, result = msg
                if err:
                    raise MarionetteError(f"{name}: {err.get('error')}: {err.get('message')}")
                return result
            # Ignore late/unrelated frames.

    def new_session(self, caps=None):
        r = self.send("WebDriver:NewSession",
                      {"capabilities": {"alwaysMatch": caps or {}, "firstMatch": [{}]}})
        return r.get("sessionId")

    def set_context(self, ctx):
        self.send("Marionette:SetContext", {"value": ctx})

    def set_timeouts(self, **t):
        self.send("WebDriver:SetTimeouts", t)

    def navigate(self, url):
        self.send("WebDriver:Navigate", {"url": url})

    def execute_async(self, script, args=None, timeout_ms=30000):
        r = self.send("WebDriver:ExecuteAsyncScript",
                      {"script": script, "args": args or [],
                       "scriptTimeout": timeout_ms, "newSandbox": False})
        return r.get("value") if isinstance(r, dict) else r

    def screenshot_b64(self):
        # Viewport (above-the-fold), NOT full-page: it's what the user sees first AND what
        # the dark-mode actor measures (drawSnapshot of innerWidth x innerHeight). A full-
        # page capture of an infinite-scroll site (cnn ~17000px tall) downsamples to grey
        # mush and mis-scores a page whose visible area is correctly dark.
        r = self.send("WebDriver:TakeScreenshot", {"full": False, "hash": False})
        return r if isinstance(r, str) else r.get("value")

    def quit(self):
        try:
            self.send("Marionette:Quit", {"flags": ["eAttemptQuit"]})
        except Exception:
            pass

    def close(self):
        try:
            self.sock.close()
        except Exception:
            pass


# Privileged-page load: about:gjoa (and other chrome:// / about: pages) are
# privileged, so a content-context WebDriver:Navigate can't run script against
# them. Instead we load the URL into the *real* content tab from chrome context
# with a system principal, then poll the content document. (System access needs
# the binary launched with --remote-allow-system-access.)
CHROME_LOAD = r"""
const url = arguments[0];
const done = arguments[arguments.length - 1];
const win = Services.wm.getMostRecentWindow('navigator:browser');
win.gBrowser.selectedBrowser.loadURI(
  Services.io.newURI(url),
  { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
done(true);
"""

# Poll, in the *content* page, for a selector to appear AND have rendered
# child content (the about:gjoa registry render is async). Resolves when the
# target exists with measurable height, or times out. `selector` may be a CSS
# selector; `containsText` (optional) additionally requires that text to be
# present somewhere in the body — robust to ID drift between baked and source.
WAIT_SCRIPT = r"""
const [selector, navSelector, containsText, deadlineMs] = arguments;
const done = arguments[arguments.length - 1];
const start = Date.now();
function check() {
  const sec = selector ? document.querySelector(selector) : document.body;
  const nav = navSelector ? document.querySelector(navSelector) : null;
  const navReady = !navSelector || (nav && nav.querySelectorAll('a').length > 0);
  const textReady = !containsText ||
    (document.body && document.body.textContent.includes(containsText));
  const secReady = sec && sec.getBoundingClientRect().height > 20;
  if (secReady && navReady && textReady) {
    // Give two frames so layout/paint settles before the screenshot.
    requestAnimationFrame(() => requestAnimationFrame(() => done({
      ok: true,
      url: document.documentURI,
      secHeight: sec.getBoundingClientRect().height,
      navItems: nav ? nav.querySelectorAll('a').length : 0,
      title: (sec.querySelector ? (sec.querySelector('h1,h2,h3') || {}).textContent : '') || ''
    })));
    return;
  }
  if (Date.now() - start > deadlineMs) {
    done({ ok: false, url: document.documentURI, sawSec: !!sec,
           sawNav: !!nav, textReady, reason: 'timeout waiting for render' });
    return;
  }
  setTimeout(check, 100);
}
check();
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=2828)
    ap.add_argument("--url", required=True)
    ap.add_argument("--wait-selector", default=None,
                    help="content selector to wait for before screenshot")
    ap.add_argument("--nav-selector", default=None,
                    help="optional nav-rail selector to also require populated")
    ap.add_argument("--contains-text", default=None,
                    help="text that must be present in body before the shot")
    ap.add_argument("--out", required=True)
    ap.add_argument("--wait-ms", type=int, default=20000)
    ap.add_argument("--settle-ms", type=int, default=0,
                    help="If >0: skip selector polling; navigate, sleep this long "
                         "(let the real SPA fully render), then capture unconditionally.")
    ap.add_argument("--privileged", action="store_true",
                    help="load via chrome system-principal (for about:/chrome: pages)")
    ap.add_argument("--quit", action="store_true",
                    help="quit the browser after the shot")
    args = ap.parse_args()

    m = Marionette(args.host, args.port)
    try:
        m.new_session({"pageLoadStrategy": "normal"})
        m.set_timeouts(script=60000, pageLoad=45000)

        if args.privileged:
            # Load the privileged page into the real content tab from chrome.
            m.set_context("chrome")
            m.execute_async(CHROME_LOAD, [args.url], timeout_ms=15000)
            m.set_context("content")
        else:
            m.set_context("content")
            m.navigate(args.url)

        if args.settle_ms:
            # Faithful-render mode: let the real SPA fully paint, then capture
            # whatever is actually on screen (no fragile selector to time out on).
            time.sleep(args.settle_ms / 1000.0)
        elif args.wait_selector or args.contains_text:
            res = None
            last = None
            # Retry past the brief window where the old document is unloading.
            for _ in range(20):
                try:
                    res = m.execute_async(
                        WAIT_SCRIPT,
                        [args.wait_selector, args.nav_selector,
                         args.contains_text, args.wait_ms],
                        timeout_ms=args.wait_ms + 5000)
                    break
                except MarionetteError as e:
                    last = e
                    if "unloaded" in str(e) or "no such" in str(e).lower():
                        time.sleep(0.5)
                        continue
                    raise
            if res is None:
                raise last
            if not res.get("ok"):
                print(f"WAIT FAILED: {res}", file=sys.stderr)
                b64 = m.screenshot_b64()  # capture anyway, for inspection
                with open(args.out, "wb") as f:
                    f.write(base64.b64decode(b64))
                return 2
            print(f"rendered: url={res.get('url')} "
                  f"secHeight={res.get('secHeight'):.0f} "
                  f"navItems={res.get('navItems')} title={res.get('title')!r}")
        b64 = m.screenshot_b64()
        with open(args.out, "wb") as f:
            f.write(base64.b64decode(b64))
        print(f"screenshot -> {args.out}")
        return 0
    finally:
        if args.quit:
            m.quit()
        m.close()


if __name__ == "__main__":
    sys.exit(main())
