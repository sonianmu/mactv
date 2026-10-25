# Concepts: what MacTV is for, and why each part exists

Read this before the protocol or the code. Every handshake in this repository answers one question from the
list below; if you know the question, the bytes stop looking arbitrary.

## 1. Where we stand

**The thesis.** Most homes have one strong computer that idles most of the day and several weak screens: an
old TV, a tablet that no longer gets updates. The weak screen's problem is not its panel or its decoder;
it is everything above them: a slow CPU, an abandoned browser, missing apps. **Lend it the strong computer.**

**This repository is the first concrete case of that thesis:** a Mac lends a desktop to an Android TV.

| It is | It is not |
|---|---|
| a **second, isolated desktop** on the Mac that belongs to the TV, with its own sound and its own input | screen mirroring (AirPlay, Miracast, casting): those share *the owner's* screen |
| two-way: the TV sends keys, pointer, text and intents ("open YouTube", "play this album"); the Mac tells the TV what is in front and whether it wants a keyboard | a one-way video stream |
| a **runtime** with a stable wire protocol, a host engine, a reference receiver, self-repair and a doctor | a set of scripts for one living room |
| general over **apps** (any web page, declared in a file), over **TVs** (any Android TV that decodes H.264, profiles for quirks) and, through the protocol, over **displays** (anything that can decode a stream and send lines back) | general over host operating systems: the host is macOS, by design (§4.1) |

Game streaming hosts (Moonlight/Sunshine, Steam Link) are the closest relatives: they solved low-latency
encode, transport and decode, and MacTV does the same at its core. What they usually stream is the host's
*own* desktop or a game; what MacTV adds is the part above the stream: a desktop that is **not** the owner's,
sound from **only** that desktop, and app-level meaning in both directions.

**What is not solved yet**, honestly: deciding *how much* of the Mac to lend and when (compute allocation:
today the TV simply gets a session and whatever it runs); more than one TV at a time; encryption of the
stream (home networks only); hosts other than macOS.

## 2. The shape: six questions, six layers

```
           ┌─────────────────────────────── the Mac ───────────────────────────────┐        ┌── the TV ──┐
 1 Desk    │ a separate macOS user, kept alive off the console (holder)             │        │            │
 2 Eyes    │ capture only that desk's picture and sound                             │        │            │
 3 Link    │ find ─ trust ─ agree ─ stream ─────────────────────────────────────────┼──────▶ │ decode     │
 4 Hands   │ ◀── keys, pointer, text, intents ───────────────────────────────────────┼─────── │ remote     │
 5 Apps    │ what runs on the desk: web pages described by app.json, data services  │        │            │
 6 Care    │ launchd, heal, guard, doctor; the TV says which link broke             │        │            │
           └────────────────────────────────────────────────────────────────────────┘        └────────────┘
```

| # | Question | Answer in this repo | Code |
|---|---|---|---|
| 1 | Where does the TV's desktop live, without taking the owner's? | its own macOS user, rendered on a private framebuffer via Screen Sharing's session select | `host/holder/holder.py` |
| 2 | How do we see and hear *only* that desktop? | ScreenCaptureKit on the session's display, minus hidden apps; a CoreAudio process tap on that session's playing processes, muted on the Mac | `Video.swift`, `Audio.swift` |
| 3 | How does the TV find the Mac, prove it is welcome, and get a stream it can decode? | protocol v1: PING → PAIR → HELLO/Welcome → packets | `Protocol.swift`, `Transport.swift`, `docs/protocol.md` |
| 4 | How does the remote act on the desktop? | lines from the TV; keys and pointer go in as Screen Sharing input (no Accessibility permission); intents go to the page | `Control.swift` |
| 5 | What is worth lending? | anything that runs in a desktop browser: apps are folders with an `app.json`; optional TV interface layer; data services | `host/apps/`, `docs/web-apps.md` |
| 6 | How does it stay up without anyone looking after it? | every component restarts; known drifts are detected and repaired; the TV reports the broken link | `docs/architecture.md` §Self-repair |

Each layer only talks to its neighbours, so each can be replaced: another receiver only needs layer 3;
another app only touches layer 5; a TV quirk lives in a profile, never in the engine.

## 3. Why each handshake exists

### Layer 1: the desk

| Step | Why it exists | What we learned the hard way |
|---|---|---|
| a separate macOS user | the owner keeps their screen, sound and input; the TV gets a display to itself | fast user switching alone is not enough: a background session's windows can't be captured and its sound is silenced |
| RFB 003.889 + Apple auth (type 30) | Screen Sharing is the only built-in way to make macOS render a second GUI session without a physical display | loopback viewers are refused; the holder connects to the Mac's own LAN address |
| ClientInit 0xC1 + session select (command 2) | asks for *my own* session on a private framebuffer instead of watching the console | — |
| ViewerInfo (66 bytes, copied from Apple's viewer) | the holder says exactly what Apple's own viewer says; we have not tested which of its flags the session path needs, so it is sent unchanged | the bytes are capability flags only, no names or addresses |
| **never** SetDisplayConfiguration (0x1d) | — | it creates a system-wide virtual display that corrupts the owner's WindowServer until a reboot. `guard.sh` stops the holder if it ever appears |

### Layer 2: the eyes

| Step | Why | Lesson |
|---|---|---|
| capture the session's display, excluding hidden apps | notification banners are the session's, not the TV's business | Notification Center can't be stopped (SIP restarts it); hiding its windows from capture works |
| tap only processes that are *playing* (`IsRunningOutput`) | a tap on silent processes adds full-scale noise | measured: mean |Δ| ≈ 21000 is noise, ≈ 2800 is music |
| mute the tap on the Mac | the Mac's speakers stay the owner's | — |
| keep the tap through pauses; rebuild after "sound, then 10 s of silence" | tearing a tap down can leave the browser's audio muted for good | — |
| web players, not Apple's apps | FairPlay output is black to capture and silent to taps; Widevine in Chrome is not | — |

### Layer 3: the link (docs/protocol.md)

| Message | Purpose | Why this shape |
|---|---|---|
| `MACTV PING` → `PONG 1 <name>` | find the Mac without disturbing a TV that is already watching | a /24 sweep, because macOS drops broadcasts from apps without Local Network permission |
| `MACTV PAIR <pin>` → token | trust is granted once, by the owner, on the Mac (`mactv pair`) | a TV on the home network is not automatically trusted; 5 wrong PINs close the window |
| `MACTV HELLO {caps, link, token}` → `welcome` | the TV says what it can decode and how it is connected; the Mac chooses a stream it *can* play | TVs differ: HEVC or only H.264, 4K or 1080p, Ethernet or slow Wi-Fi |
| packets `config` → `key` → `video` | the decoder needs parameter sets before every key frame | some TV decoders ignore codec-specific data, so they also ride in front of key frames |
| a frame every ~0.1 s even when still | TV decoders hold pictures back until more arrive; also the liveness signal | 3 s of nothing means the Mac is gone |
| drop plain frames, never key frames; adapt bitrate | a stalled network must not turn into seconds of lag | backlog > 0.25 s → bitrate × ¾; 10 s calm → back up |
| `status` packet | the TV needs to know whether to send keys or a pointer, and when to open its keyboard | pages built for a remote want arrows; others want a pointer |
| loopback admin port | tools on the Mac (`mactv status`, `pair`) must never take the TV's place | a debug client on the TV port once kicked the TV off |

### Layer 4: the hands

| Choice | Why |
|---|---|
| input through the holder's Screen Sharing connection | no Accessibility permission, and it lands in the right session |
| the TV draws its own pointer | the session's cursor is left out of the capture; the TV draws a pointer exactly where the remote put it, without waiting for a frame |
| text to the page directly when it can take it | keystrokes can't carry Chinese and other IME text |
| intents (`app`, page commands) instead of only keys | "open YouTube" is one line, not a sequence of clicks that breaks when a layout changes |

### Layer 5: the apps

An app is a folder: `app.json` (URL, Chrome profile, zoom, remote or pointer, optional keys, page commands, TV
interface script, helper service). The engine has no built-in app. Two kinds of lending:

- **pixels**: the page renders on the Mac, the TV shows it (YouTube's TV site; Apple Music's web player with a
  TV interface laid over it);
- **data**: a helper on the Mac does the work and hands the TV a small JSON document that the TV renders
  natively (`music/feed.py`: recently played albums for a TV home screen). Cheaper, sharper, and the start
  of a different kind of lending.

Lessons: Chrome stops painting windows macOS reports as occluded (true for everything off the console) unless
three `--disable-background…` flags are set; Chrome's kiosk window can lose its full-screen presentation while
still *reporting* full screen, so the page's viewport is checked instead; only one player may run at a time
or both sounds reach the TV.

### Layer 6: care

Every process is restarted by launchd; the host detects and repairs known drifts (full screen lost, TV
interface missing, hidden app restarted, silent tap, network backlog); `guard.sh` stops the one dangerous
failure; `mactv doctor` walks the chain and names the broken link; the TV's disconnect screen says *which*
side failed ("stalled", "no screen", "no Mac"). The table is in docs/architecture.md.

## 4. What is general, and where things go

| Kind of change | Where it goes | Never |
|---|---|---|
| ports, bitrates, picture limits, session user, which apps | `config.json` | in code |
| a new web app | `host/apps/<name>/app.json` (+ optional `tvui.js`, service) | in `Control.swift` |
| a TV brand's quirk (decoder lock, vendor app manager, key codes) | `profiles/tv/<brand>.json` and docs/tv-notes.md | in the receiver, unless it is a workaround every TV benefits from |
| a new kind of display (Fire TV, a browser, a Pi) | a new receiver that implements docs/receiver-contract.md, tested with `tests/` | in the host |
| a general bug | the engine, with a test in `tests/` | per installation |

### 4.1 Why the host is macOS only

Layer 1 and layer 2 are where the Mac-specific value is: a second GUI session without a monitor, capture of
that session alone, a per-process audio tap. Layers 3–6 are portable; a Linux or Windows host would need its
own answers to questions 1 and 2 and could reuse the protocol, the receiver and the tests unchanged.

## 5. How we know things (experimental method)

The parts above were found, not designed up front. The method, which agents adapting MacTV should keep:

1. **Smallest reproduction first.** One command, one observation. A theory is not a finding.
2. **Measure at the boundary**, not inside: what the TV actually received (raw screenshot, the receiver's
   debug file), what went over the wire (`tests/reference_client.py`), what the system logged
   (`log show` predicates in docs/troubleshooting.md).
3. **Positive controls.** To prove something is hidden, show it appears when hiding is off (`mactv filter off`).
   To prove 4K is real, read a 1-pixel line pattern on the TV.
4. **Don't trust what a component says about itself.** Chrome said "full screen" while the viewport was
   short; a successful `pm disable` came undone at boot. Check the effect.
5. **Numbers over adjectives.** Mbps measured, mean |Δ| of PCM, frames dropped, seconds to recover.
6. **Fix in the right layer, with a test.** Then write the lesson down where the next agent will look
   (this file, tv-notes, a profile).
7. **People first.** Someone may be watching the TV. Look before touching it.
