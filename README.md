# MacTV

**Share your Mac with your TV.** MacTV gives an Android TV its own desktop on your Mac: a separate macOS
session, rendered on the Mac, sent to the TV with its own sound, and driven by the TV's remote. It is not
screen mirroring: the Mac and the TV share one computer at the same time, and neither gets in the other's way.

**Website: https://mactv-6k2.pages.dev** · [中文说明](README.zh-CN.md) · [Concepts: why each part exists](docs/concepts.md) · [Explainer page](site/public/index.html) ·
[For agents: AGENTS.md](AGENTS.md) · [Protocol](docs/protocol.md)

## Where it stands

Most homes have one strong computer that is idle most of the day, and several weak screens: an old TV, or a
tablet that no longer gets updates. Their panels and video decoders are fine; what holds them back is
everything above that. MacTV is the first concrete case of lending the strong machine to the weak screen:
**a Mac lends a desktop to a TV.**

| MacTV is | MacTV is not |
|---|---|
| a second, **isolated** desktop that belongs to the TV, with its own sound and input | mirroring or casting the owner's screen |
| **two-way**: keys, pointer, text and intents ("open YouTube") from the TV; what is in front and "I need a keyboard" from the Mac | a one-way video stream |
| a **runtime**: wire protocol, host engine, reference receivers, self-repair, doctor, tests | a set of scripts for one living room |
| general over **apps** (one `app.json` each), **TVs** (any Android TV; quirks live in profiles) and **displays** (anything that keeps the [receiver contract](docs/receiver-contract.md)) | general over host OSes: the host is macOS (why: [concepts §4.1](docs/concepts.md#41-why-the-host-is-macos-only)) |

Not solved yet: deciding how much of the Mac to lend and when; more than one TV at a time; encrypting the
stream (it is meant for home networks only).

## How it works: six layers, six questions

| Layer | Question | Answer |
|---|---|---|
| 1 Desk | Where does the TV's desktop live, without taking the owner's? | a separate macOS user, kept alive off the console through Screen Sharing's session select |
| 2 Eyes | How do we see and hear only that desktop? | ScreenCaptureKit on that session's display; a CoreAudio tap on that session's playing processes, muted on the Mac |
| 3 Link | How does the TV find the Mac, prove it is welcome, and get a stream it can decode? | PING → PAIR (PIN) → HELLO (capabilities) / Welcome (chosen stream) → packets, with adaptive bitrate |
| 4 Hands | How does the remote act on the desktop? | keys and pointer as Screen Sharing input; text and intents straight to the page |
| 5 Apps | What is worth lending? | anything that runs in a desktop browser, each app a folder with an `app.json`; plus data services |
| 6 Care | How does it stay up on its own? | launchd, drift repair, a guard, `mactv doctor`; the TV says which link broke |

[docs/concepts.md](docs/concepts.md) explains each handshake and the experiments behind it.

Included apps: **Apple Music** (a full TV interface laid over Apple's web player, designed for the remote) and
**YouTube** (its own TV interface).

## Quick start

The easiest way: open a coding agent in this repository and paste [PROMPT.md](PROMPT.md). The agent follows
[AGENTS.md](AGENTS.md) and asks you to do the few things only you can do.

To do it by hand:

1. Mac (macOS 14.2+, Apple silicon, Chrome, `xcode-select --install`): create a Standard user `mactv`, turn
   on Screen Sharing in System Settings and allow that user. → [docs/setup-mac.md](docs/setup-mac.md)
2. Run `host/bin/mactv install`. Then, once inside the session, allow Screen Recording for MacTV Host and sign
   in to the apps. Finish with `host/bin/mactv doctor`.
3. TV: turn on USB/network debugging in developer options. Build `tv/` and install the receiver with
   `adb install`, then open it. Run `mactv pair` and type the PIN on the TV. → [docs/setup-tv.md](docs/setup-tv.md)

Build requirements: Swift (command line tools) for the host. For the receiver, JDK 17 and the Android SDK
(platform 34): `cd tv && ./gradlew assembleRelease`, with `sdk.dir` set in `tv/local.properties`.

## Test without a TV

```bash
cd host && swift build -c release && cd ..
python3 tests/test_protocol.py                       # host in test mode: test pattern and tone, no permissions needed
python3 tests/reference_client.py --help             # a complete receiver in Python
```

## Status

The original pipeline (4K60 HEVC, per-session sound, Apple Music and YouTube, self-repair) was built and used
daily on a Mac mini (Apple silicon) with a Hisense 50H55E (Android 9), wired. This repository is that work
made general: protocol v1 (handshake, pairing, negotiation, adaptive bitrate), app descriptions, profiles,
and a standalone receiver. These pass the protocol tests on the Mac and are awaiting runs on real devices.
Please send device reports: [examples/devices](examples/devices).

Limits:
- The session mechanism relies on undocumented Screen Sharing behaviour and may break with a macOS update
  ([docs/session.md](docs/session.md)).
- The stream is unencrypted, so use it on a home network only.
- One TV at a time.
- Android TVs only (other displays need a receiver).

## Licence

MIT. Apple Music, YouTube, Screen Sharing and the other names belong to their owners. This project is not
affiliated with them; it uses their public web players the way a signed-in user would.
