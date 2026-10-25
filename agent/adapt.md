# Adapting MacTV to devices it has not met

The engine is meant to be general; installations differ only in data. When something does not work on a new
pair of devices, the work is to find **which layer** the difference lives in and put the fix where every
later installation benefits. docs/concepts.md §2 has the layers.

## 1. Locate the layer

Follow the chain from the bottom; stop at the first link that fails.

| Symptom | Layer | First look |
|---|---|---|
| `mactv logs holder` has no `session open` | 1 desk | docs/session.md, profiles/mac |
| session open, but `picture.capturing` false or black frames | 2 eyes | Screen Recording in the session; profiles/mac `screen-sharing-enabled-by-launchctl` |
| no sound, or sound on the Mac's speakers | 2 eyes | docs/capture-and-audio.md; `mactv status` → sound |
| TV: "Looking for your Mac" | 3 link | network (same subnet, VPN), port 8810 listening |
| TV: "answers but not streaming" / bye | 3 link | host running? paired? `mactv logs host` |
| picture arrives but the TV shows nothing or "decoder busy" | 3 link (receiver side) | profiles/tv; `mactv status` → negotiated codec and size vs what the TV can do |
| stutter, smearing | 3 link | link speed, `framesDropped`, bitrate |
| keys or pointer do nothing | 4 hands | is the page painting? pointer vs key mode; holder relay listening |
| a page misbehaves (title bar, no TV interface, wrong user agent) | 5 apps | its `app.json`, docs/web-apps.md |
| it works, then breaks after a while or a reboot | 6 care | `lastHeal`, launchd, profile quirks with "after reboot" |

## 2. Reproduce small, measure at the boundary

One command, one observation (docs/concepts.md §5). Use the receiver's debug file, a raw screenshot, the host
log, the Python reference receiver (`tests/reference_client.py`) against the same host to separate "the host
sends the wrong thing" from "the TV can't take it".

## 3. Put the fix in the right place

```
Is it a value (size, bitrate, port, user, which apps)?          → config.json
Is it about one site or page?                                    → host/apps/<name>/app.json (+ tvui.js)
Is it about one brand/model of TV or one kind of Mac?            → profiles/<kind>/<id>.json (+ docs/tv-notes.md)
  ... and the receiver needs to behave differently for it?       → the receiver, behind a capability check,
                                                                   never a brand check, if at all possible
Is it a kind of display that is not Android?                     → a new receiver (docs/receiver-contract.md)
Otherwise it is a general bug                                    → the engine + a test in tests/
```

A profile quirk needs a `check` (read-only) and a `fix`, and `changesDevice` set honestly. If the cause is
unknown, say "unknown"; a quirk with a symptom, a check and a working fix is useful without a theory.

## 4. Common adaptations

| Situation | What to do |
|---|---|
| TV has H.264 only | nothing: negotiation picks H.264 at ≤ 1080p. Verify with `mactv status` |
| TV on Wi-Fi | nothing by default (`wifiMax1080`); if it stutters, lower `bitrateWifi` |
| TV reports 4K but stutters on Ethernet | measure link speed; lower `bitrate4KWired`; check `framesDropped` |
| TV decoder lies about its limit | set `maxWidth`/`maxHeight` in config, and record a profile quirk |
| a vendor launcher steals focus or kills the receiver | profile quirk; prefer the TV's own settings over disabling packages |
| a remote key arrives with an unusual key code | add the code in `ReceiverActivity.onKeyDown` (general: harmless for other TVs) and note it in the profile |
| a new site | copy `host/apps/_template`; for remote-built sites set `remote: true` and maybe a TV `userAgent`; `mactv install` then `mactv restart host` |
| a site needs a TV interface | write `tvui.js` with the conventions in docs/web-apps.md |
| a different session user name | `sessionUser` in config, before `mactv install` |

## 5. Write it down

Device report (examples/devices), profile (profiles/), and, if the lesson is general, docs/concepts.md or
docs/troubleshooting.md. The next agent should not have to find it again.
