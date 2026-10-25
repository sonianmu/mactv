# Receiver contract: what any display must do

The host does not know what a TV is. It serves anything that keeps this contract, so a new kind of display
(Fire TV, Google TV, a set-top box, a Raspberry Pi, a browser tab, an old tablet) needs a new receiver, not a
new host. `tv/receiver` (Android) and `tests/reference_client.py` (Python, ~150 lines) are two receivers that
keep it; read the Python one first, it is the shortest complete statement.

## Must

| # | Duty | Why (docs/concepts.md §3) | Checked by |
|---|---|---|---|
| 1 | Connect to TCP 8810 and send exactly one first line: `MACTV HELLO <json>` | the first line decides what a connection is | `test_unpaired_hello_is_refused` |
| 2 | Report what it can **really** decode in hardware, best first, with the largest size, and its link | the host picks a stream it can play | `test_avc_only_on_wifi_stays_1080p`, `test_small_decoder_limits_size` |
| 3 | Present a token from PAIR; when it gets a `bye` with error `pair-first` or `unknown-token`, offer pairing | the owner grants trust once | `test_pairing_window` |
| 4 | Read packets `u8 type, u64 pts, u32 length, payload` (big-endian) and ignore types it does not know | room for later versions | — |
| 5 | Configure the decoder from the `welcome` (codec, width, height) and the `config` packet; feed `key`/`video` in order | Annex B, no B-frames | `test_hevc_4k_wired` |
| 6 | Put the parameter sets from the last `config` in front of each key frame it feeds | some decoders ignore codec-specific data | — |
| 7 | Treat **3 s without any packet** as "the Mac is gone" and reconnect with backoff | the host sends a frame at least every ~0.1 s | `test_ping_does_not_disturb_the_stream` |
| 8 | Send `keyframe` when it dropped frames or reset its decoder | resync without waiting 2 s | `test_keyframe_on_request` |
| 9 | Play `audio` packets as PCM s16le at the welcome's rate and channels | — | `test_hevc_4k_wired` (audio present) |

## Should

| Duty | Why |
|---|---|
| discover with `MACTV PING` to every address of its /24 (64 in flight, 400 ms timeout), remember the last good address, allow typing one | broadcasts don't reach macOS apps without Local Network permission; DHCP moves the Mac |
| pair with `MACTV PAIR <pin> <name>` and keep the token in private storage | the token is a credential |
| honour `status`: `remote: true` → send `key …`; otherwise offer a pointer (`move`, `click`, `scroll`); `keyboard: true` → open the platform's text input and send `text <base64> [enter]` | pages differ |
| show the welcome's `apps` (with `titles`) in a menu and send `app <name>` / `app desktop` | intents beat clicks |
| say which link broke: no Mac answers / Mac answers but no picture / picture stalled | the person can act on it |
| keep the welcome's `wake` (hardware address) and send Wake-on-LAN before discovery | the Mac may sleep |
| render the stream at its own size on a video plane, not a 1080p UI layer | TVs scale the UI layer |

## Must not

- connect to the admin port (8813, loopback only anyway) or reuse a connection for PING after HELLO;
- send commands before the `welcome`;
- assume 4K, HEVC, a pointer or a keyboard.

## Testing a new receiver without a TV

Run the host in test mode (any Mac, no permissions): `host/.build/release/MacTVHost --test --foreground
--port 18810 --admin-port 18813 --state-dir /tmp/mactv-test`, pair with `printf 'pair 60\n' | nc 127.0.0.1
18813`, and point the receiver at the Mac. A moving test pattern and a 440 Hz tone mean layers 3–5 work.
