# Troubleshooting

Start with `mactv doctor` on the Mac: it walks the chain and names the broken link. The TV's disconnect screen
says which side failed. Then find the symptom below.

## Symptom → cause → check → fix

| Symptom | Likely cause | Check | Fix |
|---|---|---|---|
| TV: "Looking for your Mac" forever | Mac off the home network (phone hotspot, full-tunnel VPN), or another subnet | `mactv doctor` network line | connect the Mac to the home network (Ethernet best); or enter the Mac's address on the TV (menu → Settings) |
| TV: "can't be found" right after a VPN switch | the VPN took the LAN routes | holder/host logs | the host refuses VPN interfaces and the holder pins its socket to the LAN interface; reconnect the Mac to the LAN |
| TV: "answers but not streaming" | host not running in the session | `mactv doctor` host lines, `mactv logs host` | Screen Recording not granted in the session (setup-mac step 5); `mactv restart host` |
| holder log: `authentication failed` | wrong password, or the user not allowed in Screen Sharing | `mactv preflight` | delete keychain item "MacTV session", `mactv install`; allow the user in Screen Sharing |
| holder: `session open` but host: "no display" / black frames | Screen Sharing enabled with launchctl (no capture permission) | `log show --last 5m --predicate 'process == "screensharingd"' \| grep -i capture` | toggle Screen Sharing off/on in System Settings |
| Owner's screen shows ghosting, doubled text, or goes black | a system-wide virtual display was created (0x1d) | `log show --last 30m --predicate 'eventMessage CONTAINS "created virtual display"'`; `mactv logs guard` | reboot the Mac. Find what sent SetDisplayConfiguration (never the holder); docs/session.md rule 1 |
| Viewers reconnect in a loop, "display index not found" | screensharingd/agent was killed | system log | reboot; never kill those processes |
| No sound, picture fine | browser audio stuck muted after taps were torn down; or FairPlay content | `mactv status` → sound; `silentRebuilds` | reopen the app on the TV (quits and restarts its Chrome); use web players, not Apple's apps |
| Sound is a loud hiss | tapping processes without audio | host log "audio tap on N processes" with a large N | fixed in the host (only playing processes are tapped); update |
| Menu bar and title bar visible on the TV | window dropped out of full screen | `python3 /Users/Shared/MacTV/tools/cdp.py heal` (CDP_PORT for the app) | heals by itself within 15 s; check the host log for "heal" |
| Notification banners on the TV | hidden-app filter off or app restarted | `mactv status` → picture.hiddenPids | `mactv filter on`; renews by itself within 30 s |
| Picture freezes while the page keeps going | Chrome stopped painting an "occluded" window | host's Chrome flags | the three `--disable-background…` flags (docs/web-apps.md) |
| Remote keys do nothing in a page | Chrome not painting (above), or the page wants a pointer | try pointer mode (menu) | as above |
| Stutter / smearing after a burst | network behind | `mactv status` → receiver.framesDropped, bitrate | the bitrate adapts; use Ethernet; lower `bitrate4KWired` |
| Picture soft or over-sharp | TV scaling the 1080p UI layer, or its picture processing | is it really 4K? (`mactv status` video size) | receiver uses a SurfaceView at stream size; try the TV's Game/PC picture mode |
| TV: "decoder busy" | the TV's middleware holds the only decoder | docs/tv-notes.md for your brand | e.g. Hisense: reset the last input source and reboot |
| Every video app on the TV fails after a reboot | same decoder lock | as above | as above |
| `adb connect`: "No route to host" (macOS) | Local Network privacy blocks adb | — | allow the terminal under Local Network, or use a Python ADB client |
| After `mactv install`, "can run in the background" notice | macOS noticed the new launch agents | — | normal, once; it is hidden from the TV anyway |
| Test host started from a script never listens | it inherited a strange stdin | — | fixed: the host reopens stdin on /dev/null |

## Collecting evidence

- Mac: `mactv status`, `mactv logs host`, `mactv logs holder`, `log show --last 10m --predicate 'process == "screensharingd" OR process == "ScreensharingAgent"'`.
- TV: `adb shell cat /sdcard/Android/data/tv.mactv.receiver/files/mactv-debug.txt`, a raw screenshot.
- Remove addresses, names and tokens before sharing (docs/security.md).
