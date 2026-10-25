# MacTV wire protocol, version 1

The contract between the host (on the Mac, `host/Sources/MacTVHost`) and a receiver (on the TV,
`tv/receiver`). `tests/reference_client.py` is an executable reading of this document and
`tests/test_protocol.py` checks the host against it. Change all three together.

## Ports

| Port | Bound to | Who talks | Purpose |
|---|---|---|---|
| 8810 | all interfaces except VPN tunnels | TV → host | discovery, pairing, stream and commands (this document) |
| 8813 | loopback only | tools on the Mac → host | admin: `mactv status`, `mactv pair`, … |
| 8811 | loopback only | host → holder | key and pointer events into the session |
| 8812 | home network | TV → an app's data service | optional; the music app's feed for a TV home screen (`host/apps/music/feed.py`, its `settings.feedPort`) |
| 9223, 9224, … | loopback only | host → Chrome | DevTools of the web apps (each app's `debugPort`) |
| 5900 | macOS | holder → Screen Sharing | keeps the session alive (docs/session.md) |

All ports are configurable (`config.json`).

## The first line decides what a connection is

Every connection to 8810 starts with one line from the client (UTF-8, ending in `\n`):

```
MACTV PING
MACTV PAIR <pin> <device name>
MACTV HELLO <json>
```

### PING: discovery

The host answers `MACTV PONG <protocol version> <Mac name>` and closes. A PING never affects a receiver
that is already watching. A TV finds its Mac by sending PING to every address of its /24 (64 at a time,
400 ms timeout); broadcast discovery is not used because macOS drops broadcasts from apps without Local
Network access.

### PAIR: getting a token

The owner runs `mactv pair` on the Mac, which opens a pairing window (default 120 s) and shows a six-digit
PIN. The TV sends it:

```
→ MACTV PAIR 123456 Living room TV
← MACTV PAIRED 3f9c…(64 hex digits)
```

or `MACTV DENIED <reason>`: `no-window` (no window open, or the PIN was already used), `wrong-pin`. Five
wrong PINs close the window. A PIN works once. The token is the TV's credential from then on; the host
keeps tokens in the session user's `~/Library/Application Support/MacTV/paired.json` (mode 600), and
`mactv devices` / `mactv unpair <id|all>` manage them.

### HELLO: becoming the receiver

```
MACTV HELLO {"proto":1,"token":"…","device":{"name":"Living room TV","model":"Brand Model","sdk":28},
             "video":{"codecs":["hevc","avc"],"maxWidth":3840,"maxHeight":2160},"link":"ethernet"}
```

| Field | Meaning |
|---|---|
| `token` | from PAIR; required unless the host's `requirePairing` is false |
| `video.codecs` | hardware decoders, best first: `hevc`, `avc` |
| `video.maxWidth`, `maxHeight` | the largest picture the best decoder takes |
| `link` | `ethernet`, `wifi` or `unknown` |

Missing fields mean "assume the least" (H.264, 1080p).

If the token is missing or unknown the host sends one `bye` packet (`{"error":"pair-first"}` or
`{"error":"unknown-token"}`) and closes. Otherwise the host sends a `welcome` packet and starts streaming.
A new receiver replaces the previous one (the TV reconnecting after a network blip is the usual case).

### No line: protocol 0

A client that says nothing for 1.5 s is a protocol-0 receiver (the first, unauthenticated version). It is
accepted only with `allowLegacy: true` and gets 4K HEVC without a welcome. Off by default.

## Negotiation

The host picks:

- **codec**: HEVC if the TV has it, else H.264;
- **size**: the session's shape scaled to fit the TV's limit and the config's `maxWidth`×`maxHeight`;
  H.264 and (with `wifiMax1080`) Wi-Fi are held to 1080p;
- **bitrate**: `bitrateWifi` on Wi-Fi, else `bitrate4KWired` above 1080p and `bitrate1080Wired` at or below.

The bitrate then adapts: when more than a quarter second of video is waiting to be sent it drops by a
quarter (not below `minBitrate`); after 10 s without backlog it climbs back by a tenth, up to the target.

## Packets (host → TV)

```
u8 type | u64 pts (microseconds since the host started) | u32 length | payload      (big-endian)
```

| type | name | payload |
|---|---|---|
| 1 | video | a frame, Annex B |
| 2 | audio | PCM s16le, interleaved; rate and channels from the welcome (48000, 2) |
| 3 | key | a key frame, Annex B |
| 4 | config | parameter sets (HEVC: VPS, SPS, PPS; H.264: SPS, PPS), Annex B, sent before every key frame |
| 5 | status | JSON `{"front":"<bundle id>","app":"<app name>","remote":bool,"keyboard":bool}`; `app` is an app name, or `web`, `desktop`, `other` |
| 6 | welcome | JSON, below |
| 7 | bye | JSON `{"error":"…"}`, then the host closes |

Welcome:

```json
{"proto":1, "host":"Living room Mac",
 "video":{"codec":"hevc","width":3840,"height":2160,"fps":60,"bitrate":40000000},
 "audio":{"rate":48000,"channels":2},
 "wake":"aa:bb:cc:dd:ee:ff",
 "apps":["music","youtube"],
 "titles":{"music":"Apple Music","youtube":"YouTube"}}
```

`wake` is the Mac's hardware address on the interface the TV reached, for Wake-on-LAN later (so it is never
typed in). `apps` are the pages the TV can open (its menu), `titles` their menu names (from each app's
`app.json`; a missing title means "show the name").

Rules the receiver relies on:

- the host sends at least one video packet every ~0.1 s, even when the screen is still (TV decoders hold
  pictures back until more frames arrive), so **3 s without data means the Mac is gone**;
- a key frame always follows a `config` packet; parameter sets also ride in front of key frames in the
  receiver, because some TV decoders ignore codec-specific data;
- while the network falls behind the host drops plain frames, never key frames, and resumes at the next
  key frame; frames are never reordered (no B-frames);
- `status` is sent after the welcome and whenever it changes. `remote: true` means the page in front is
  built for a remote: send keys, not a pointer. `keyboard: true` means it wants text: open the TV's own
  input method.

## Commands (TV → host)

One per line, after HELLO:

| Command | Effect |
|---|---|
| `keyframe` | send a key frame now (the TV dropped frames) |
| `key up\|down\|left\|right\|select\|back\|playpause\|next\|previous` | a remote key, mapped for the app in front |
| `app desktop\|<app>` | show the desktop, or open/bring forward a web app from the config (one player at a time) |
| `<verb> <words…>` | a page command declared in an app's `app.json` `commands`, e.g. the music app's `play <kind> <id> [shuffle]`; handled by the app in front if it declares the verb, else by the first that does |
| `text <base64 UTF-8> [enter]` | text from the TV's keyboard (pages with a TV interface take it directly, so any language works) |
| `move <x> <y>` | pointer to (x, y) in the session's display points (1920×1080 for a 16:9 session) |
| `click` | left click at the pointer |
| `scroll <steps>` | wheel steps, positive is down, ±20 at most |
| `fill` | make the front window fill the screen |

## The admin port (loopback, tools only)

One line in, one JSON object out: `status`, `pair [seconds]`, `devices`, `unpair <id|all>`, `keyframe`,
`heal`, `filter on|off`, `restart`. `host/bin/mactv` wraps them. Because tools use this port, they never
take the TV's place on 8810.
