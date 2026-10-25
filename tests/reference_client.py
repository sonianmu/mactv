#!/usr/bin/env python3
"""A MacTV receiver in plain Python: the executable reading of docs/protocol.md, used by the tests and handy
by hand ("pretend to be the TV"). No dependencies beyond the standard library.

usage:
  reference_client.py ping   [--host H] [--port P]
  reference_client.py pair PIN [--name NAME]              stores the token in --token-file
  reference_client.py watch  [--seconds N] [--send "app music;key down"] [--save out.h265]
                             [--codecs hevc,avc] [--max 3840x2160] [--link ethernet|wifi]
  reference_client.py admin "status"                      a command on the host's loopback admin port
Defaults: host 127.0.0.1, port 8810, admin port 8813, token file ~/.config/mactv/token.

Careful: `watch` is a real receiver. Against a live host it takes the TV's place until it disconnects.
"""
import argparse, json, os, socket, struct, sys, time

PACKETS = {1: "video", 2: "audio", 3: "key", 4: "config", 5: "status", 6: "welcome", 7: "bye"}


def line_request(host, port, line, timeout=5):
    """One request line, one answer line (PING, PAIR)."""
    with socket.create_connection((host, port), timeout=timeout) as s:
        s.sendall((line + "\n").encode())
        buf = b""
        while not buf.endswith(b"\n"):
            d = s.recv(4096)
            if not d:
                break
            buf += d
        return buf.decode().strip()


def ping(host, port):
    return line_request(host, port, "MACTV PING")


def pair(host, port, pin, name="reference client"):
    """The token, or raises with the host's reason."""
    answer = line_request(host, port, f"MACTV PAIR {pin} {name}")
    parts = answer.split()
    if len(parts) == 3 and parts[1] == "PAIRED":
        return parts[2]
    raise RuntimeError(answer)


def admin(port, command, timeout=10):
    with socket.create_connection(("127.0.0.1", port), timeout=timeout) as s:
        s.sendall((command + "\n").encode())
        buf = b""
        while True:
            d = s.recv(65536)
            if not d:
                break
            buf += d
    return json.loads(buf)


class Receiver:
    """A connected receiver: HELLO sent, packets read with next()."""

    def __init__(self, host, port, token=None, codecs=("hevc", "avc"), max_size=(3840, 2160), link="ethernet",
                 name="reference client", timeout=10):
        self.s = socket.create_connection((host, port), timeout=timeout)
        hello = {"proto": 1, "token": token, "device": {"name": name, "model": "python", "sdk": 0},
                 "video": {"codecs": list(codecs), "maxWidth": max_size[0], "maxHeight": max_size[1]}, "link": link}
        if token is None:
            del hello["token"]
        self.s.sendall(("MACTV HELLO " + json.dumps(hello) + "\n").encode())
        self.buf = b""

    def _read(self, n):
        while len(self.buf) < n:
            d = self.s.recv(1 << 20)
            if not d:
                raise EOFError("closed by the host")
            self.buf += d
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    def next(self):
        """(type name, pts, payload)."""
        t, pts, n = struct.unpack(">BQI", self._read(13))
        return PACKETS.get(t, str(t)), pts, self._read(n)

    def send(self, line):
        self.s.sendall((line + "\n").encode())

    def until(self, kind, limit=500):
        """Reads until a packet of this kind; returns it and what came before."""
        seen = []
        for _ in range(limit):
            p = self.next()
            if p[0] == kind:
                return p, seen
            seen.append(p)
        raise TimeoutError(f"no {kind} packet in {limit}")

    def close(self):
        try:
            self.s.close()
        except OSError:
            pass


def nal_types(annexb, hevc):
    """NAL unit types in an Annex B buffer."""
    out, i = [], 0
    while True:
        j = annexb.find(b"\x00\x00\x00\x01", i)
        if j < 0 or j + 4 >= len(annexb):
            return out
        h = annexb[j + 4]
        out.append((h >> 1) & 0x3F if hevc else h & 0x1F)
        i = j + 4


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("command", choices=["ping", "pair", "watch", "admin"])
    ap.add_argument("arg", nargs="?")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8810)
    ap.add_argument("--admin-port", type=int, default=8813)
    ap.add_argument("--token-file", default=os.path.expanduser("~/.config/mactv/token"))
    ap.add_argument("--name", default="reference client")
    ap.add_argument("--seconds", type=float, default=5)
    ap.add_argument("--send", default="")
    ap.add_argument("--save")
    ap.add_argument("--codecs", default="hevc,avc")
    ap.add_argument("--max", default="3840x2160")
    ap.add_argument("--link", default="ethernet")
    a = ap.parse_args()
    if a.command == "ping":
        print(ping(a.host, a.port))
    elif a.command == "pair":
        token = pair(a.host, a.port, a.arg, a.name)
        os.makedirs(os.path.dirname(a.token_file), exist_ok=True)
        with open(a.token_file, "w") as f:
            f.write(token)
        os.chmod(a.token_file, 0o600)
        print("paired; token saved to", a.token_file)
    elif a.command == "admin":
        print(json.dumps(admin(a.admin_port, a.arg or "status"), indent=1, ensure_ascii=False))
    else:
        token = open(a.token_file).read().strip() if os.path.exists(a.token_file) else None
        w, h = (int(x) for x in a.max.split("x"))
        r = Receiver(a.host, a.port, token, a.codecs.split(","), (w, h), a.link, a.name)
        out = open(a.save, "wb") if a.save else None
        counts, end, sent = {}, time.time() + a.seconds, False
        while time.time() < end:
            kind, pts, payload = r.next()
            counts[kind] = counts.get(kind, 0) + 1
            if kind in ("welcome", "status", "bye"):
                print(kind, payload.decode())
                if kind == "bye":
                    break
            if kind == "welcome" and a.send and not sent:
                for cmd in a.send.split(";"):
                    cmd = cmd.strip()
                    if cmd.startswith("wait "):
                        time.sleep(float(cmd[5:]))
                    elif cmd:
                        r.send(cmd)
                sent = True
            if out and kind in ("config", "key", "video"):
                out.write(payload)
        r.close()
        print("packets:", counts)


if __name__ == "__main__":
    main()
