#!/usr/bin/env python3
"""Protocol tests: starts the host in test mode (test pattern and tone, no permissions, its own ports and state
directory) and talks to it as a receiver would. Runs on any Mac with the host built:

    (cd host && swift build -c release) && python3 tests/test_protocol.py

Nothing here touches a running installation: other ports, a temporary pairing store, no session input."""
import json, os, socket, subprocess, sys, tempfile, time, unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import reference_client as rc  # noqa: E402

BINARY = os.environ.get("MACTV_HOST_BIN", os.path.join(HERE, "..", "host", ".build", "release", "MacTVHost"))
PORT, ADMIN = 18810, 18813


class HostTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp(prefix="mactv-test-")
        cfg = {"port": PORT, "adminPort": ADMIN, "holderPort": 18811, "name": "Test Mac", "runtimeDir": cls.tmp,
               "fps": 30, "requirePairing": True, "allowLegacy": False}
        # One app described the way every app is (apps/<name>/app.json); the host must find and offer it.
        os.makedirs(os.path.join(cls.tmp, "apps", "demo"))
        with open(os.path.join(cls.tmp, "apps", "demo", "app.json"), "w") as f:
            json.dump({"title": "Demo Page", "url": "https://example.com/", "profile": "MacTV Demo"}, f)
        cls.cfg_path = os.path.join(cls.tmp, "config.json")
        with open(cls.cfg_path, "w") as f:
            json.dump(cfg, f)
        cls.log = open(os.path.join(cls.tmp, "host.log"), "w")
        cls.proc = subprocess.Popen([BINARY, "--test", "--foreground", "--config", cls.cfg_path,
                                     "--state-dir", os.path.join(cls.tmp, "state")],
                                    stdin=subprocess.DEVNULL, stdout=cls.log, stderr=subprocess.STDOUT)
        for _ in range(150):  # up to 15 s: a busy Mac can be slow to answer the first PING
            try:
                rc.ping("127.0.0.1", PORT)
                break
            except OSError:
                time.sleep(0.1)
        else:
            raise RuntimeError("host did not start; see " + cls.log.name)

    @classmethod
    def tearDownClass(cls):
        cls.proc.terminate()
        cls.proc.wait(5)
        cls.log.close()

    def token(self):
        pin = rc.admin(ADMIN, "pair 60")["pin"]
        return rc.pair("127.0.0.1", PORT, pin, "test tv")

    # apps

    def test_apps_come_from_their_descriptions(self):
        r = rc.Receiver("127.0.0.1", PORT, token=self.token())
        (_, _, payload), _ = r.until("welcome")
        w = json.loads(payload)
        self.assertEqual(w["apps"], ["demo"])
        self.assertEqual(w["titles"], {"demo": "Demo Page"})
        r.close()

    # discovery and pairing

    def test_ping(self):
        self.assertEqual(rc.ping("127.0.0.1", PORT), "MACTV PONG 1 Test Mac")

    def test_unpaired_hello_is_refused(self):
        r = rc.Receiver("127.0.0.1", PORT, token=None)
        kind, _, payload = r.next()
        self.assertEqual(kind, "bye")
        self.assertEqual(json.loads(payload)["error"], "pair-first")
        r.close()

    def test_unknown_token_is_refused(self):
        r = rc.Receiver("127.0.0.1", PORT, token="00" * 32)
        kind, _, payload = r.next()
        self.assertEqual((kind, json.loads(payload)["error"]), ("bye", "unknown-token"))
        r.close()

    def test_pairing_window(self):
        rc.admin(ADMIN, "pair 30")
        with self.assertRaisesRegex(RuntimeError, "wrong-pin"):
            rc.pair("127.0.0.1", PORT, "not-the-pin")
        pin = rc.admin(ADMIN, "pair 30")["pin"]
        token = rc.pair("127.0.0.1", PORT, pin, "tv one")
        self.assertEqual(len(token), 64)
        # A PIN works once.
        with self.assertRaisesRegex(RuntimeError, "no-window"):
            rc.pair("127.0.0.1", PORT, pin)

    def test_five_wrong_pins_close_the_window(self):
        pin = rc.admin(ADMIN, "pair 30")["pin"]
        for _ in range(5):
            with self.assertRaises(RuntimeError):
                rc.pair("127.0.0.1", PORT, "000000" if pin != "000000" else "111111")
        with self.assertRaisesRegex(RuntimeError, "no-window"):
            rc.pair("127.0.0.1", PORT, pin)

    # negotiation and the stream

    def stream(self, **caps):
        r = rc.Receiver("127.0.0.1", PORT, token=self.token(), **caps)
        kind, _, payload = r.next()
        self.assertEqual(kind, "welcome", payload)
        return r, json.loads(payload)

    def test_hevc_4k_wired(self):
        r, w = self.stream(codecs=("hevc", "avc"), max_size=(3840, 2160), link="ethernet")
        self.assertEqual((w["video"]["codec"], w["video"]["width"], w["video"]["height"]), ("hevc", 3840, 2160))
        self.assertEqual(w["audio"], {"rate": 48000, "channels": 2})
        (_, _, config), _ = r.until("config")
        self.assertEqual(rc.nal_types(config, hevc=True)[:3], [32, 33, 34])  # VPS, SPS, PPS
        (_, _, key), _ = r.until("key")
        self.assertTrue(any(t in (19, 20, 21) for t in rc.nal_types(key, hevc=True)))  # IDR/CRA
        (_, _, audio), _ = r.until("audio")
        self.assertEqual(len(audio) % 4, 0)
        r.close()

    def test_avc_only_on_wifi_stays_1080p(self):
        r, w = self.stream(codecs=("avc",), max_size=(3840, 2160), link="wifi")
        v = w["video"]
        self.assertEqual(v["codec"], "avc")
        self.assertLessEqual(v["width"], 1920)
        self.assertLessEqual(v["height"], 1080)
        self.assertEqual(v["bitrate"], 10_000_000)
        (_, _, config), _ = r.until("config")
        self.assertEqual(rc.nal_types(config, hevc=False)[:2], [7, 8])  # SPS, PPS
        r.close()

    def test_small_decoder_limits_size(self):
        r, w = self.stream(codecs=("hevc",), max_size=(1280, 720), link="ethernet")
        self.assertEqual((w["video"]["width"], w["video"]["height"]), (1280, 720))
        r.close()

    def test_status_packet_after_welcome(self):
        r, _ = self.stream()
        (_, _, status), _ = r.until("status")
        self.assertIn("app", json.loads(status))
        r.close()

    def test_keyframe_on_request(self):
        r, _ = self.stream(codecs=("avc",), max_size=(1920, 1080))
        r.until("key")
        r.send("keyframe")
        (_, _, key), seen = r.until("key", limit=2000)
        self.assertTrue(key)
        r.close()

    def test_ping_does_not_disturb_the_stream(self):
        r, _ = self.stream(codecs=("avc",), max_size=(1920, 1080))
        r.until("key")
        for _ in range(3):
            rc.ping("127.0.0.1", PORT)
        # Still receiving.
        for _ in range(20):
            r.next()
        r.close()

    def test_new_receiver_replaces_the_old(self):
        old, _ = self.stream(codecs=("avc",), max_size=(1920, 1080))
        old.until("key")
        new, _ = self.stream(codecs=("avc",), max_size=(1920, 1080))
        new.until("key")
        with self.assertRaises((EOFError, ConnectionResetError, socket.timeout, OSError)):
            for _ in range(5000):
                old.next()
        new.close()

    def test_legacy_receiver_refused_by_default(self):
        s = socket.create_connection(("127.0.0.1", PORT), timeout=5)
        time.sleep(2)  # say nothing: a v0 receiver
        self.assertEqual(s.recv(1), b"")
        s.close()

    # the admin port

    def test_admin_status(self):
        st = rc.admin(ADMIN, "status")
        self.assertTrue(st["testMode"])
        self.assertEqual(st["protocol"], 1)
        for key in ("receiver", "video", "picture", "sound", "pairing", "log"):
            self.assertIn(key, st)

    def test_unpair_revokes(self):
        token = self.token()
        rid = token[:8]
        self.assertGreaterEqual(rc.admin(ADMIN, "unpair " + rid)["removed"], 1)
        r = rc.Receiver("127.0.0.1", PORT, token=token)
        kind, _, payload = r.next()
        self.assertEqual((kind, json.loads(payload)["error"]), ("bye", "unknown-token"))
        r.close()

    def test_admin_is_loopback_only(self):
        # The admin port must not answer on any non-loopback address of this Mac.
        addrs = subprocess.run(["ipconfig", "getifaddr", "en0"], capture_output=True, text=True).stdout.split()
        addrs += subprocess.run(["ipconfig", "getifaddr", "en1"], capture_output=True, text=True).stdout.split()
        for a in addrs:
            with self.assertRaises(OSError):
                socket.create_connection((a, ADMIN), timeout=1).close()


if __name__ == "__main__":
    unittest.main(verbosity=2)
