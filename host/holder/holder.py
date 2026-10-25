#!/usr/bin/env python3
"""MacTV holder: keeps the dedicated session (user `sessionUser`, default "mactv") drawing, and relays key and
pointer events into it. Runs in the OWNER's session (launchd agent tv.mactv.holder).

How: it logs in to this Mac's own Screen Sharing as the session user and asks, with Apple's session-select
extension, for that user's own session on a private virtual framebuffer. macOS then keeps that session alive
off the console, with a display the host inside it can capture, while the owner keeps using the Mac. Server
pushes are cut down to a 1x1 region, so the connection stays open without moving pictures. docs/session.md has
the protocol and how it was worked out.

NEVER send SetDisplayConfiguration (message 0x1d): it makes a system-wide virtual display that joins the
owner's display arrangement; doing that repeatedly corrupted WindowServer (ghosting, the session's pixels on
the owner's screen, the physical display going black) until a reboot. guard.sh stops the holder if that
display ever appears.

Input relay: TCP 127.0.0.1:<holderPort> (loopback only), lines from the host:
  k <keysym hex> <1|0>        key down/up (X keysyms; Command is Alt_L 0xffe9, Option is Meta_L 0xffe7)
  p <x> <y> <buttons>         pointer in framebuffer pixels (twice the display's points)
  s <dx> <dy> <x> <y>         scroll in points at a pointer position (Apple's scroll event; RFB wheel buttons
                              do nothing on macOS)

Password: MACTV_PW, else the owner's login keychain (service "MacTV session", account = session user), which
`mactv install` fills. Reconnects whenever the session drops.
"""
import hashlib, json, os, secrets, socket, struct, subprocess, sys, threading, time

CONFIG = os.environ.get("MACTV_CONFIG", "/Users/Shared/MacTV/config.json")
try:
    with open(CONFIG) as f:
        CFG = json.load(f)
except (OSError, ValueError):
    CFG = {}
USER = CFG.get("sessionUser", "mactv")
INPUT_PORT = int(CFG.get("holderPort", 8811))
KEYCHAIN_SERVICE = "MacTV session"

# ViewerInfo (message 0x21), as Apple's Screen Sharing viewer sends it after session select: capability flags
# only, no names or addresses. Recorded from the viewer; the server wants it before it sets up the session.
VIEWER_INFO = bytes.fromhex(
    "2100003e0001000000020000000500000003000000000000"
    "000f0000000600000001b000080390000000000040000000"
    "000000000000000000000000000000000000")
assert len(VIEWER_INFO) == 66

lock = threading.Lock()
conn = None  # the live Screen Sharing socket


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def password():
    if os.environ.get("MACTV_PW"):
        return os.environ["MACTV_PW"]
    r = subprocess.run(["security", "find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", USER, "-w"],
                       capture_output=True, text=True)
    if r.returncode != 0 or not r.stdout.strip():
        sys.exit("no password for %s: run `mactv install` (or set MACTV_PW)" % USER)
    return r.stdout.rstrip("\n")


def private(addr):
    """RFC 1918 home-network address."""
    try:
        a, b = (int(x) for x in addr.split(".")[:2])
    except ValueError:
        return False
    return a == 10 or (a == 172 and 16 <= b <= 31) or (a == 192 and b == 168)


def lan():
    """(interface, address) of the home network. Screen Sharing turns loopback viewers away, DHCP moves the
    address and interface names swap across reboots, so it is looked up on every attempt. (None, "") while the
    Mac is off any home network (a phone hotspot uses a private range too, which is fine: it is local)."""
    if os.environ.get("MACTV_HOST"):
        return None, os.environ["MACTV_HOST"]
    for i in range(10):
        ifname = "en%d" % i
        a = subprocess.run(["ipconfig", "getifaddr", ifname], capture_output=True, text=True).stdout.strip()
        if a and private(a):
            return ifname, a
    return None, ""


IP_BOUND_IF = 25  # <netinet/in.h>: pin a socket to one interface, so a full-tunnel VPN can't take it


def bound_socket(ifname):
    s = socket.socket()
    if ifname:
        s.setsockopt(socket.IPPROTO_IP, IP_BOUND_IF, socket.if_nametoindex(ifname))
    return s


def recvn(s, n):
    buf = b""
    while len(buf) < n:
        chunk = s.recv(n - len(buf))
        if not chunk:
            raise EOFError("closed")
        buf += chunk
    return buf


def aes128_ecb(key, data):
    return subprocess.run(["openssl", "enc", "-aes-128-ecb", "-nopad", "-K", key.hex()],
                          input=data, capture_output=True, check=True).stdout


def auto_framebuffer(w, h):
    """Apple's AutoFrameBufferUpdate (0x09): the server pushes changes in this region by itself."""
    return struct.pack(">BxHIHHHH", 0x09, 1, 0, 0, 0, w, h)


def open_session(pw):
    ifname, host = lan()
    if not host:
        raise RuntimeError("not on a home network")
    s = bound_socket(ifname)
    s.settimeout(30)
    s.connect((host, 5900))
    recvn(s, 12)
    s.sendall(b"RFB 003.889\n")
    if 30 not in recvn(s, recvn(s, 1)[0]):
        raise RuntimeError("Screen Sharing offers no Apple authentication (type 30); is it on?")
    s.sendall(bytes([30]))
    # Type 30: Diffie-Hellman, then the credentials under AES-128-ECB keyed with MD5 of the shared secret.
    gen, klen = struct.unpack(">HH", recvn(s, 4))
    prime = int.from_bytes(recvn(s, klen), "big")
    server_pub = int.from_bytes(recvn(s, klen), "big")
    priv = int.from_bytes(secrets.token_bytes(klen), "big") % prime
    key = hashlib.md5(pow(server_pub, priv, prime).to_bytes(klen, "big")).digest()
    cred = bytearray(secrets.token_bytes(128))
    u, p = USER.encode()[:63], pw.encode()[:63]
    cred[0:len(u)], cred[len(u)] = u, 0
    cred[64:64 + len(p)], cred[64 + len(p)] = p, 0
    enc = aes128_ecb(key, bytes(cred))
    s.sendall(enc + pow(gen, priv, prime).to_bytes(klen, "big"))
    if struct.unpack(">I", recvn(s, 4))[0]:
        raise RuntimeError("authentication failed (wrong password, or %s not allowed in Screen Sharing)" % USER)

    s.sendall(b"\xc1")  # ClientInit: shared, extended ServerInit, session select
    w, h = struct.unpack(">HH", recvn(s, 4))
    recvn(s, 16)
    recvn(s, struct.unpack(">I", recvn(s, 4))[0])
    recvn(s, struct.unpack(">H", recvn(s, 2))[0])  # session block (who is on the console)
    # Session select, command 2: the authenticating user's own session, on a private framebuffer.
    me = socket.gethostname().encode()[:63]
    s.sendall(struct.pack(">HHIH", 200, 2, 0, 0x0200) + me.ljust(64, b"\0") + enc)
    recvn(s, struct.unpack(">H", recvn(s, 2))[0])

    s.sendall(VIEWER_INFO)
    s.sendall(b"\x0a\x00\x00\x01")  # SetMode: control
    s.sendall(struct.pack(">BxxxBBBBHHHBBBxxx", 0, 32, 24, 0, 1, 255, 255, 255, 16, 8, 0))  # pixel format
    s.sendall(struct.pack(">BxHii", 2, 2, 0, -223))  # encodings: raw + DesktopSize
    s.sendall(bytes([0x15, 0, 0, 1, 0, 0, 0, 0]))  # AutoPasteboard on
    s.sendall(auto_framebuffer(w, h))
    return s, w, h


def serve(s):
    """Reads the server until the connection ends; once the session's display is up, pushes shrink to 1x1."""
    s.settimeout(30)
    virtual = False
    opened = time.time()
    while True:
        t = recvn(s, 1)[0]
        if t == 0:
            for _ in range(struct.unpack(">xH", recvn(s, 3))[0]):
                x, y, rw, rh, e = struct.unpack(">HHHHi", recvn(s, 12))
                if e == 0:
                    recvn(s, rw * rh * 4)
                elif e == -223:
                    # A new size long after opening means the session moved (the owner fast-user-switched into
                    # it and back): input would no longer reach its screen, so start over.
                    if time.time() - opened > 20:
                        raise RuntimeError("session display changed to %dx%d; reconnecting" % (rw, rh))
                    if not virtual:
                        log("session display: %dx%d" % (rw, rh))
                    virtual = True
                    with lock:
                        s.sendall(auto_framebuffer(1, 1))
                else:
                    raise RuntimeError("unexpected encoding %d" % e)
        elif t == 0x14:  # heartbeat
            recvn(s, struct.unpack(">xH", recvn(s, 3))[0])
        elif t == 2:  # bell
            pass
        elif t == 3:  # cut text
            recvn(s, 3)
            recvn(s, struct.unpack(">I", recvn(s, 4))[0])
        elif t == 0x1f:  # pasteboard: 16-byte header with the compressed size at 12..16
            hdr = recvn(s, 15)
            recvn(s, struct.unpack(">I", hdr[11:15])[0])
        else:
            raise RuntimeError("unhandled server message 0x%02x" % t)


def scroll(dx, dy, x, y):
    """Apple's scroll-wheel event (0x17, kind 11). dx, dy in points, positive right and down; x, y in pixels."""
    axes = [-dx, -dy, 0]  # the Mac counts up and left as positive
    body = struct.pack(">HH", 1, 11)
    body += b"".join(struct.pack(">h", int(a / 10)) for a in axes)          # lines (10 points each)
    body += b"".join(struct.pack(">i", int(a * 65536 / 10)) for a in axes)  # lines, 16.16 fixed point
    body += b"".join(struct.pack(">i", a) for a in axes)                    # points
    body += bytes(12) + struct.pack(">IHH", 0x02, x, y)                     # phases, continuous, position
    return struct.pack(">BxH", 0x17, len(body)) + body


def relay(c):
    for line in c.makefile("r"):
        parts = line.split()
        try:
            if parts[0] == "k":
                msg = struct.pack(">BBxxI", 4, int(parts[2]), int(parts[1], 16))
            elif parts[0] == "p":
                msg = struct.pack(">BBHH", 5, int(parts[3]), int(parts[1]), int(parts[2]))
            elif parts[0] == "s":
                msg = scroll(int(parts[1]), int(parts[2]), int(parts[3]), int(parts[4]))
            else:
                continue
        except (IndexError, ValueError):
            continue
        with lock:
            if conn is not None:
                try:
                    conn.sendall(msg)
                except OSError:
                    pass
    c.close()


def input_server():
    ls = socket.socket()
    ls.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    ls.bind(("127.0.0.1", INPUT_PORT))
    ls.listen(4)
    while True:
        c, _ = ls.accept()
        threading.Thread(target=relay, args=(c,), daemon=True).start()


def main():
    global conn
    pw = password()
    threading.Thread(target=input_server, daemon=True).start()
    log("holder for", USER, "relay on 127.0.0.1:%d" % INPUT_PORT)
    while True:
        s = None
        try:
            s, w, h = open_session(pw)
            with lock:
                conn = s
            log("session open")
            serve(s)
        except Exception as e:  # keep holding whatever went wrong; Screen Sharing restarts are routine
            log("session ended:", type(e).__name__, e)
        with lock:
            conn = None
        if s:
            try:
                s.close()
            except OSError:
                pass
        time.sleep(5)


if __name__ == "__main__":
    main()
