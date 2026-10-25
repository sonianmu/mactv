# AGENTS.md

You are an agent with a shell on someone's Mac, and they want their TV to use it. This file is your entry
point: what the project is for, the rules, and what to read in which order. Machine-readable version of
the same map: `agent/manifest.json`.

## What this is, in five lines

1. **Goal:** lend a strong computer's spare power to a weak screen. Here: a Mac lends a desktop to an Android TV.
2. **Not mirroring:** the TV gets its **own** macOS session (a separate user), so the owner keeps using the Mac.
3. **Six layers**, each answering one question: desk (where the TV's desktop lives) → eyes (capture only
   that desktop's picture and sound) → link (find, trust, agree, stream) → hands (remote back to the desktop)
   → apps (what runs there) → care (it repairs itself). docs/concepts.md explains why each handshake exists.
4. **The engine is written and tested.** Your job is to install, configure, adapt to these devices, and
   verify. Installations differ only in data: `config.json`, `host/apps/*/app.json`, `profiles/*/*.json`.
5. **Fix things where everyone benefits:** a device quirk goes into a profile, a general bug into the engine
   with a test. Never fork the engine for one living room.

## Hard rules

1. **Never send Screen Sharing's SetDisplayConfiguration (0x1d)** and never write code that could. It
   corrupts the owner's WindowServer until a reboot. After any session experiment,
   `log show --last 10m --predicate 'eventMessage CONTAINS "created virtual display"'` must be empty.
2. **Never kill `screensharingd` or `ScreensharingAgent`.** End connections cleanly (`mactv stop`).
3. **Ask first** before: creating a user, enabling Screen Sharing, any `sudo`, installing or uninstalling on
   the TV, rebooting anything, changing TV settings, signing in to accounts.
4. **Someone may be watching the TV.** Before touching it:
   `adb shell dumpsys activity activities | grep mResumedActivity`. A video app in front → ask.
5. **Secrets stay secret.** The session password lives only in the owner's keychain (`mactv install` asks).
   Never write passwords, tokens, IP or MAC addresses, serials or account names into files, commits, issues
   or reports. Reports name models, not addresses.
6. **Reversible by default.** Prefer what `mactv uninstall` and the TV's own settings can undo. On the TV,
   disable rather than uninstall.
7. **Verify, don't assume.** A step is done when its check passes, not when its command returned. Report
   failures with the output.

## Read in this order

| # | File | Why |
|---|---|---|
| 1 | [docs/concepts.md](docs/concepts.md) | the purpose of every layer and handshake; the experimental method |
| 2 | [agent/playbook.md](agent/playbook.md) | the eight phases with their gates and the verification table |
| 3 | [agent/adapt.md](agent/adapt.md) | when the devices differ: find the layer, fix it in the right place |
| 4 | [profiles/](profiles/README.md) | known quirks per kind of TV and Mac, with checks and fixes |
| 5 | as you reach them | docs/setup-mac.md, docs/setup-tv.md, docs/web-apps.md, docs/troubleshooting.md |
| 6 | only if changing the wire | docs/protocol.md, docs/receiver-contract.md, tests/ |

The page `site/public/index.html` (source in `site/src/`) is the same story for people, with diagrams.

## Map of the repository

| Path | What | Layer |
|---|---|---|
| `host/holder/` | session keeper (`holder.py`) and its guard (`guard.sh`) | 1 |
| `host/Sources/MacTVHost/` | the engine (Swift): capture, encode, sound, protocol, control, self-repair | 2–4, 6 |
| `host/apps/` | apps, one folder each with an `app.json`; `music` (TV interface + data service), `youtube`, `_template` | 5 |
| `host/bin/mactv` | preflight, install, doctor, status, pair, logs, restart | 6 |
| `host/config/config.example.json` | every installation setting | — |
| `tv/receiver/` | the Android receiver | 3–4 |
| `tests/` | Python reference receiver and protocol tests (no TV, no permissions) | 3 |
| `profiles/` | device knowledge as data | — |
| `agent/` | playbook, adaptation guide, manifest | — |
| `docs/` | concepts, protocol, receiver contract, session, capture and sound, web apps, setup, security, troubleshooting | — |
| `examples/devices/` | device reports | — |
| `site/` | the explainer page | — |
