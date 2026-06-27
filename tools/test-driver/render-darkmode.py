#!/usr/bin/env python3
"""Render real pages for the dark-mode eval: connect to an already-booted browser
(gjoa or the Firefox+DarkReader control) over marionette, navigate each URL, and
screenshot the viewport at top + scrolled-down (so the vision pass sees more than
the fold). Reusable for both arms — same URLs, same window size.
"""
import argparse, base64, json, socket, sys, time

class M:
    def __init__(self, port, host="127.0.0.1", timeout=90):
        self.buf=b""; self.id=1; dl=time.time()+timeout; last=None
        while time.time()<dl:
            try: self.s=socket.create_connection((host,port),timeout=5); self.s.settimeout(180); break
            except OSError as e: last=e; time.sleep(0.3)
        else: raise SystemExit(f"connect {host}:{port}: {last}")
        self._frame()
    def _frame(self):
        while b":" not in self.buf:
            c=self.s.recv(65536)
            if not c: raise SystemExit("closed")
            self.buf+=c
        i=self.buf.index(b":"); n=int(self.buf[:i]); need=i+1+n
        while len(self.buf)<need:
            c=self.s.recv(65536)
            if not c: raise SystemExit("closed")
            self.buf+=c
        p=self.buf[i+1:need]; self.buf=self.buf[need:]; return json.loads(p.decode())
    def send(self,name,params):
        mid=self.id; self.id+=1; msg=json.dumps([0,mid,name,params]).encode()
        self.s.sendall(f"{len(msg)}:".encode()+msg)
        while True:
            r=self._frame()
            if isinstance(r,list) and r[0]==1 and r[1]==mid:
                if r[2]: raise SystemExit(f"{name}: {r[2]}")
                return r[3]
    def newsession(self): return self.send("WebDriver:NewSession",{"capabilities":{"alwaysMatch":{},"firstMatch":[{}]}})
    def ctx(self,c): self.send("Marionette:SetContext",{"value":c})
    def rect(self,w,h):
        try: self.send("WebDriver:SetWindowRect",{"width":w,"height":h,"x":0,"y":0})
        except SystemExit: pass
    def navigate(self,url):
        try: return self.send("WebDriver:Navigate",{"url":url})
        except SystemExit as e: return f"NAV {e}"
    def exe(self,s,t=20000):
        try:
            r=self.send("WebDriver:ExecuteScript",{"script":s,"args":[],"scriptTimeout":t,"newSandbox":False})
            return r.get("value") if isinstance(r,dict) else r
        except SystemExit: return None
    def shot(self,path):
        self.ctx("chrome")
        r=self.send("WebDriver:TakeScreenshot",{"full":False})
        data=r.get("value") if isinstance(r,dict) else r
        open(path,"wb").write(base64.b64decode(data))
    def quit(self):
        try: self.send("Marionette:Quit",{"flags":["eForceQuit"]})
        except SystemExit: pass

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--port",type=int,required=True)
    ap.add_argument("--prefix",required=True)   # gjoa | ctrl
    ap.add_argument("--outdir",default="/tmp/dmeval")
    ap.add_argument("--urls",required=True)      # comma-sep
    ap.add_argument("--settle",type=float,default=6.0)
    a=ap.parse_args()
    m=M(a.port); m.newsession(); m.ctx("chrome")
    for _ in range(80):
        if m.exe("return !!window.gBrowser;"): break
        time.sleep(0.25)
    m.rect(1600,1000)
    for url in [u.strip() for u in a.urls.split(",") if u.strip()]:
        slug="".join(c if c.isalnum() else "_" for c in url.replace("https://","").replace("www.",""))[:32]
        m.ctx("content"); m.navigate(url); time.sleep(a.settle)
        try: m.exe("window.scrollTo(0,0); return 1;")
        except Exception: pass
        time.sleep(0.6)
        m.shot(f"{a.outdir}/{a.prefix}-{slug}-1top.png")
        m.ctx("content")
        try: m.exe("window.scrollTo(0, Math.min(1100, (document.body?document.body.scrollHeight:1100))); return 1;")
        except Exception: pass
        time.sleep(1.2)
        m.shot(f"{a.outdir}/{a.prefix}-{slug}-2mid.png")
        print(f"  {a.prefix}: {slug}", file=sys.stderr)
    m.quit()

if __name__=="__main__": main()
