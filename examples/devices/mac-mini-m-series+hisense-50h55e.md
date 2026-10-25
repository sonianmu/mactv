# Mac mini (Apple silicon) + Hisense 50H55E

| | |
|---|---|
| Mac | Mac mini, Apple silicon, 16 GB, macOS 27 |
| TV | Hisense 50H55E, China market, VIDAA 6 on Android 9, 1.2 GB RAM, UI 1920×1080, 4K panel |
| TV decoders | hevc and avc in hardware (MStar), one decoder at a time; 3840×2160 |
| Network | Mac Ethernet or Wi-Fi; TV Ethernet ≈ 750 Mbps to the Mac; TV 2.4 GHz Wi-Fi ≈ 19 Mbps (too slow for 4K) |
| Software | the original protocol-0 streamer and receiver this project grew from |

## Results

| Check | Result | Notes |
|---|---|---|
| picture | yes | 3840×2160 HEVC at 40–50 Mbps, 60 fps; 1-px line test chart readable on the TV |
| sound | yes | only the session's sound, muted on the Mac; owner's sound unaffected |
| isolation | yes | owner's console session untouched while the TV is used |
| remote | yes | pointer and key modes, Chinese text through the TV's IME into Apple Music search |
| recovery | yes | launchd restarts; the TV reconnects; host restarts with the TV reconnecting in ~2 s |
| self-repair | yes | a window that lost full screen was restored within 17 s with nobody touching anything |
| protocol v1 / new receiver | pending | passes the protocol tests on the Mac; not yet run on this TV |

## Device-specific findings

- **Decoder locked after reboot**: the last input source (tuner/HDMI) is reopened at boot and the middleware
  keeps the only decoder. `adb shell setprop persist.sys.last_source 2562` and reboot. See docs/tv-notes.md.
- Installing any APK makes the stock home app pop up: check nobody is watching first.
- Notification banners from the session appeared on the TV until the host hid Notification Center from the capture.
