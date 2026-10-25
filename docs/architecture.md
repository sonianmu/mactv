# Architecture

## The idea

An old or weak TV borrows a Mac's spare power. Not by mirroring the owner's screen: the TV gets **its own
macOS session**, rendered and run on the Mac, shown and controlled on the TV. Anything that works in a
desktop browser on a Mac can therefore work on the TV, and it can be re-dressed for a remote (the Apple
Music app here is a full TV interface laid over Apple's web player). The reasons behind each part are in
docs/concepts.md; this file is the map.

Compared with screen mirroring:

| | Mirroring | MacTV |
|---|---|---|
| What the TV shows | the owner's screen | a separate session (user `mactv`); the owner keeps working |
| Sound | the whole Mac | only that session's processes, muted on the Mac itself |
| Direction | picture one way | both ways: keys, pointer, text and "open/play X" from the TV; front app and keyboard requests from the Mac |
| Layers | pixels | pixels, plus data services a TV can render natively (the music feed) |
| Failure | reconnect by hand | both ends retry, the host repairs drift, the TV says which link broke |

## Pieces

```
 Owner's session                       Session user's session (mactv)             Android TV
 ┌────────────────────────┐            ┌───────────────────────────────┐         ┌───────────────────────┐
 │ holder.py  ── RFB 5900 ─┼──────────▶ │ private framebuffer (display)  │         │ MacTV receiver        │
 │   relay 127.0.0.1:8811 ◀┼─ loopback ─┤ MacTVHost.app                 │◀─ 8810 ─┤  discovery (PING)     │
 │ guard.sh (log watcher)  │            │   capture  · encoder · audio  │         │  pairing (PIN)        │
 │ mactv CLI ── 8813 ──────┼─ loopback ─▶   transport · control · heal  │         │  HEVC/H.264 decode    │
 └────────────────────────┘            │   app services (music feed) ──┼─ 8812 ─▶│  audio · cursor · menu│
                                       │ Chrome (kiosk) per web app     │         └───────────────────────┘
                                       │   DevTools 9223/9224 loopback  │              ◀─ Wake-on-LAN
                                       └───────────────────────────────┘
```

| Piece | Runs as | Code | Job |
|---|---|---|---|
| holder | owner (launch agent `tv.mactv.holder`) | `host/holder/holder.py` | logs in to Screen Sharing as the session user with Apple's session select; keeps the session's private framebuffer alive; relays input into it |
| guard | owner (`tv.mactv.guard`) | `host/holder/guard.sh` | stops the holder if a system-wide virtual display ever appears (docs/session.md) |
| host | session user (`tv.mactv.host`, starts with the session) | `host/Sources/MacTVHost` | capture, encode, audio, protocol, commands, web apps, self-repair, helper services |
| mactv CLI | owner | `host/bin/mactv` | preflight, install, doctor, pair, logs, restart |
| apps | session user | `host/apps/<name>/app.json` | pages in Chrome kiosk windows; optional TV interface, page commands and a helper service per app |
| receiver | Android TV | `tv/receiver` | discovery, pairing, decode, sound, remote |

## Inside the host

```
Source (ScreenSource | TestSource) ──NV12──▶ VideoEncoder ──Annex B──▶ Transport ──▶ TV
SoundSource (SessionAudio | TestTone) ──s16──────────────────────────▶ Transport
Transport ──commands──▶ Control ──keys/pointer──▶ Injector ──▶ holder ──▶ session
                         Control ──CDP──▶ tools/cdp.py ──▶ Chrome (open, heal, tvui)
BitrateController ◀── backlog ── Transport           Admin (loopback) ◀── mactv CLI
Services (each app's helper)                         Pairing (tokens)
```

- `Config.swift`: every installation-specific value, from `config.json`, plus the apps found in
  `<runtimeDir>/apps/*/app.json`. Nothing personal and nothing site-specific is compiled in.
- `Protocol.swift`: HELLO, Welcome, packet types, negotiation (pure, testable).
- `Transport.swift`: sorts connections by first line, keeps one receiver, backpressure.
- `Video.swift`: sources, encoder (rebuilt per negotiation), adaptive bitrate.
- `Audio.swift`: per-session process tap (docs/capture-and-audio.md), test tone.
- `Control.swift`: commands, keys mapped per app (from app.json), page commands, Chrome windows, fill, heal, status.
- `Admin.swift`, `Pairing.swift`, `Services.swift`, `Log.swift`, `main.swift`.

`--test` swaps the screen and the session's sound for a test pattern and a tone, so the whole pipeline
(encoder, protocol, a receiver) runs on any Mac, in any session, without permissions. The protocol tests use it.

## Self-repair (what fixes itself)

| Drift | Noticed by | Repair |
|---|---|---|
| a process exits or crashes | launchd | restarted within 15 s |
| helper service exits | host | restarted after 5 s |
| session display replaced (Screen Sharing reconfigured, fast user switch) | capture stops | capture restarts, key frame, heal |
| window drops out of full screen (title bar and menu bar on the TV) | page viewport shorter than the screen (Chrome itself still says "full screen") | out of full screen and back in, via DevTools |
| TV interface missing from its page | `window.__tvui` absent | re-injected |
| hidden app (Notification Center) restarted | its process id changed | capture filter renewed |
| sound tap silent while processes play | sound heard, then 10 s of silence | tap rebuilt |
| network behind | send backlog | bitrate down, back up when calm |
| TV fell behind | its queue | it asks for a key frame |
| host restarted while a page was up | — | the page in front is recognised by its Chrome profile |

Checks run after opening a page, after the display is reconfigured, and every 15 s while a TV is connected.

## Why these choices

- **A separate user session**, not the owner's: isolation (the owner's screen, sound and input are never
  touched) and a display the TV can have to itself. The price is Screen Sharing's private session select
  (docs/session.md), the one undocumented dependency.
- **Chrome web players**, not the Mac's own apps: Apple's TV and Music apps use FairPlay, whose output a
  process tap receives as silence and capture as black. Chrome decrypts with Widevine, which taps and
  captures normally.
- **The TV decodes in hardware** (HEVC/H.264 via MediaCodec) onto a SurfaceView, which goes to the TV's own
  video plane at full resolution; the TV's UI layer is often fixed at 1080p.
- **The TV draws the pointer**: the session's own cursor is not where the TV's pointer is.
