#!/usr/bin/env python3
"""Tiny Chrome DevTools client for a MacTV page (CDP_PORT, default 9223, loopback only): evaluate JS, inject a
file, repair the window. Used by the host (Control.swift); no dependencies beyond the standard library.
usage: cdp.py eval '<js>'      prints the result (awaits promises)
       cdp.py heal [tvui.js]    repairs what drifts: a window that lost full screen, a Music page without its
                                TV interface (given the script). Prints ok, or what it fixed.
       cdp.py inject file.js  evaluates the file now and on every future load of the page
       cdp.py nav <url>       load another page in the Music window (test patterns)"""
import base64, json, os, socket, struct, sys, time, urllib.request

PORT = int(os.environ.get("CDP_PORT", "9223"))

def page_target():
    """The page on this port: each MacTV app has its own Chrome profile and port, so it is the one real page
    (not a DevTools or extension page)."""
    pages = [t for t in json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json")) if t["type"] == "page"]
    for t in pages:
        if t["url"].startswith(("http://", "https://", "file:")):
            return t
    raise SystemExit("no page on port %d" % PORT)

def page_ws():
    return page_target()["webSocketDebuggerUrl"]

class WS:
    def __init__(self, url):
        hostport, path = url[5:].split("/", 1)
        host, port = hostport.split(":")
        self.s = socket.create_connection((host, int(port)))
        key = base64.b64encode(os.urandom(16)).decode()
        self.s.sendall((f"GET /{path} HTTP/1.1\r\nHost: {hostport}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                        f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\nOrigin: http://127.0.0.1\r\n\r\n").encode())
        buf = b""
        while b"\r\n\r\n" not in buf: buf += self.s.recv(4096)
        if b" 101 " not in buf.split(b"\r\n")[0]: raise SystemExit(buf.decode(errors="replace"))
        self.rest = buf.split(b"\r\n\r\n", 1)[1]
        self.n = 0
    def send(self, obj):
        data = json.dumps(obj).encode(); mask = os.urandom(4)
        hdr = bytes([0x81]); l = len(data)
        hdr += bytes([0x80 | l]) if l < 126 else (bytes([0x80 | 126]) + struct.pack(">H", l) if l < 65536 else bytes([0x80 | 127]) + struct.pack(">Q", l))
        self.s.sendall(hdr + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))
    def _read(self, n):
        while len(self.rest) < n:
            d = self.s.recv(65536)
            if not d: raise EOFError
            self.rest += d
        r, self.rest = self.rest[:n], self.rest[n:]; return r
    def recv(self):
        out = b""
        while True:
            b1, b2 = self._read(2); l = b2 & 0x7F
            if l == 126: l = struct.unpack(">H", self._read(2))[0]
            elif l == 127: l = struct.unpack(">Q", self._read(8))[0]
            out += self._read(l)
            if b1 & 0x80: return json.loads(out)
    def call(self, method, **params):
        self.n += 1; my = self.n
        self.send({"id": my, "method": method, "params": params})
        while True:
            m = self.recv()
            if m.get("id") == my: return m

def value(ws, js):
    return ws.call("Runtime.evaluate", expression=js, returnByValue=True).get("result", {}).get("result", {}).get("value")

def fills_screen(ws):
    """The page has the whole screen: in Chrome's kiosk full screen the viewport is as tall as the screen; when
    macOS drops the full-screen presentation (seen after the session's display was reconfigured) the window
    keeps its size but grows a title bar under the menu bar, and the viewport comes up short. Chrome itself
    still reports the window as full screen then, so the page is what is asked."""
    iw, ih, sw, sh = json.loads(value(ws, "JSON.stringify([innerWidth, innerHeight, screen.width, screen.height])"))
    return ih >= sh - 2 and iw >= sw - 2

def heal(ws, tvui):
    done = []
    if not fills_screen(ws):
        # Out of full screen and back in again redraws the presentation; asking for full screen alone does
        # nothing, as Chrome believes it is there already.
        browser = WS(json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/version"))["webSocketDebuggerUrl"])
        wid = browser.call("Browser.getWindowForTarget", targetId=page_target()["id"])["result"]["windowId"]
        for state in ("normal", "fullscreen"):
            browser.call("Browser.setWindowBounds", windowId=wid, bounds={"windowState": state})
            time.sleep(1.5)
        done.append("full screen restored" if fills_screen(ws) else "full screen NOT restored")
    if tvui and not value(ws, "window.__tvui || 0"):
        ws.call("Runtime.evaluate", expression=open(tvui).read())
        done.append("tv interface re-injected")
    return done

ws = WS(page_ws())
if sys.argv[1] == "heal":
    print("; ".join(heal(ws, sys.argv[2] if len(sys.argv) > 2 else None)) or "ok")
elif sys.argv[1] == "eval":
    r = ws.call("Runtime.evaluate", expression=sys.argv[2], awaitPromise=True, returnByValue=True)
    res = r.get("result", {})
    v = res.get("result", {}).get("value", res)
    out = json.dumps(v, ensure_ascii=False, indent=1)
    print(out if os.environ.get("CDP_FULL") else out[:6000])
elif sys.argv[1] == "nav":
    print(ws.call("Page.navigate", url=sys.argv[2]).get("result"))
elif sys.argv[1] == "inject":
    src = open(sys.argv[2]).read()
    ws.call("Page.enable")
    print(ws.call("Page.addScriptToEvaluateOnNewDocument", source=src).get("result"))
    print(ws.call("Runtime.evaluate", expression=src).get("result", {}).get("exceptionDetails", "ok"))
