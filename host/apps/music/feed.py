#!/usr/bin/env python3
"""Apple Music data for a TV home screen, served on the home network (default port 8812). Started and
restarted by the host (it is this app's "service" in app.json), as the session user.

GET /home.json?token=<pairing token> -> {"items": [{id, kind, name, artist, art, bg, text}], "at": seconds}
  The account's recently played albums and playlists, newest first. `art` is an artwork URL template with
  {w} and {h}, on Apple's CDN, which the TV fetches itself. Without a valid token: 401 (unless the host's
  config has requirePairing false).

It calls the Apple Music API with the web player's own tokens, read once from the Music page through its
DevTools port (tools/cdp.py) and kept in the session user's ~/Library/Application Support/MacTV/music-tokens.json
(mode 600), so the feed keeps working while the page is closed. A 401/403 from Apple drops them; they are read
again the next time the page is up. Port and catalogue language come from app.json "settings"."""
import json, os, pwd, subprocess, sys, threading, time, urllib.error, urllib.parse, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

CONFIG = os.environ.get("MACTV_CONFIG", "/Users/Shared/MacTV/config.json")
try:
    with open(CONFIG) as f:
        CFG = json.load(f)
except (OSError, ValueError):
    CFG = {}
RUNTIME = CFG.get("runtimeDir", "/Users/Shared/MacTV")
try:
    with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "app.json")) as f:
        APP = json.load(f)
except (OSError, ValueError):
    APP = {}
# config.json "appSettings": {"music": {...}} overrides the app's own settings without editing app.json.
SETTINGS = dict(APP.get("settings", {}), **CFG.get("appSettings", {}).get("music", {}))
PORT = int(SETTINGS.get("feedPort", 8812))
REQUIRE_TOKEN = CFG.get("requirePairing", True)
LANG = SETTINGS.get("language", "en-US")
CDP_PORT = str(APP.get("debugPort", 9223))
# The user's own home, not $HOME: sudo -u keeps the caller's.
STATE = os.path.join(pwd.getpwuid(os.getuid()).pw_dir, "Library/Application Support/MacTV")
STORE = os.path.join(STATE, "music-tokens.json")
PAIRED = os.path.join(STATE, "paired.json")
TTL = 60  # a TV asks about once a minute while its home screen shows; Apple is asked at most as often
lock = threading.Lock()
cache = {"at": 0, "body": None}


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def paired(token):
    try:
        with open(PAIRED) as f:
            return token in json.load(f)
    except (OSError, ValueError):
        return False


def tokens():
    try:
        with open(STORE) as f:
            t = json.load(f)
            if t.get("dev") and t.get("user"):
                return t
    except (OSError, ValueError):
        pass
    js = "JSON.stringify({dev: MusicKit.getInstance().developerToken, user: MusicKit.getInstance().musicUserToken})"
    try:
        out = subprocess.run([sys.executable, os.path.join(RUNTIME, "tools", "cdp.py"), "eval", js], capture_output=True,
                             text=True, timeout=15, env=dict(os.environ, CDP_PORT=CDP_PORT)).stdout
        t = json.loads(json.loads(out))
    except Exception:
        return None
    if not (t.get("dev") and t.get("user")):
        return None
    os.makedirs(STATE, exist_ok=True)
    fd = os.open(STORE, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump(t, f)
    log("music tokens saved")
    return t


def api(t, path, **q):
    q.setdefault("l", LANG)
    req = urllib.request.Request("https://api.music.apple.com" + path + "?" + urllib.parse.urlencode(q), headers={
        "Authorization": "Bearer " + t["dev"], "Media-User-Token": t["user"],
        "Origin": "https://music.apple.com", "Referer": "https://music.apple.com/"})
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.load(r)


def build():
    t = tokens()
    if not t:
        return None
    items, seen = [], set()
    try:
        for page in (0, 10):
            for d in api(t, "/v1/me/recent/played", limit=10, offset=page).get("data", []):
                a = d.get("attributes", {})
                art = a.get("artwork") or {}
                if not art.get("url") or d["id"] in seen:
                    continue
                seen.add(d["id"])
                items.append({"id": d["id"], "kind": d["type"], "name": a.get("name", ""),
                              "artist": a.get("artistName") or a.get("curatorName") or "",
                              "art": art["url"], "bg": art.get("bgColor", "222222"), "text": art.get("textColor1", "ffffff")})
    except urllib.error.HTTPError as e:
        if e.code in (401, 403):
            try:
                os.remove(STORE)
            except OSError:
                pass
        log("api", e.code)
        return None
    except Exception as e:
        log("api", e)
        return None
    return json.dumps({"items": items, "at": int(time.time())}, ensure_ascii=False).encode()


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        url = urllib.parse.urlparse(self.path)
        if url.path != "/home.json":
            self.send_error(404)
            return
        token = urllib.parse.parse_qs(url.query).get("token", [None])[0]
        if REQUIRE_TOKEN and not paired(token):
            self.send_error(401, "pair this TV first")
            return
        with lock:
            if not cache["body"] or time.time() - cache["at"] > TTL:
                body = build()
                if body:
                    cache.update(at=time.time(), body=body)
            body = cache["body"]
        if not body:
            self.send_error(503, "Apple Music is not signed in yet")
            return
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):
        pass


def private(addr):
    try:
        a, b = (int(x) for x in addr.split(".")[:2])
    except ValueError:
        return False
    return a == 10 or (a == 172 and 16 <= b <= 31) or (a == 192 and b == 168)


def lan_address():
    for i in range(10):
        a = subprocess.run(["ipconfig", "getifaddr", "en%d" % i], capture_output=True, text=True).stdout.strip()
        if a and private(a):
            return a
    return ""


if __name__ == "__main__":
    while True:
        addr = lan_address()
        if addr:
            try:
                log("music feed on port", PORT)
                ThreadingHTTPServer((addr, PORT), Handler).serve_forever()
            except OSError as e:
                log("listen:", e)
        time.sleep(10)
