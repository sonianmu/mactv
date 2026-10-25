# Setting up the TV

Any **Android TV / Google TV** set or box with a hardware HEVC or H.264 decoder (Android 7+). Samsung (Tizen),
LG (webOS) and Fire TV are not covered (Fire TV may install the receiver; untested). Steps marked **(person)**
need someone with the remote.

## 1. Developer access (person)

Settings → Device Preferences → About → press OK on **Build** seven times → back → Developer options →
**USB debugging** on, and **Network/ADB debugging** if the TV shows it. Keep the TV on.

## 2. Connect

From the Mac (Android platform tools; `adb` from the Android SDK or Homebrew):

```bash
adb connect <tv address>:5555      # the TV asks "Allow USB debugging?" (person: accept, tick "always")
adb devices
```

On recent macOS `adb connect` can fail with "No route to host" although the port is open: macOS Local Network
privacy blocks the binary. Allow your terminal in System Settings → Privacy & Security → Local Network, or use
a Python ADB client (`adb-shell`).

## 3. Build and install the receiver

```bash
cd tv
./gradlew assembleRelease          # needs JDK 17 and the Android SDK (platform 34); see the root README
adb install -r receiver/build/outputs/apk/release/receiver-release.apk
```

If `adb install` hangs (Android 14 waits for an on-screen confirmation), push and install from the shell:
`adb push … /data/local/tmp/r.apk && adb shell pm install -r /data/local/tmp/r.apk`. Some China-market TVs
refuse every sideload (`INSTALL_FAILED_VERIFICATION_FAILURE`); MacTV can't run there.

**Before installing, look at what the TV is doing** (`adb shell dumpsys activity activities | grep mResumedActivity`):
on some TVs every install makes the stock home screen pop up, which interrupts whoever is watching.

## 4. Pair (person)

Open **MacTV** on the TV. It finds the Mac by itself (or menu key → Settings → Mac address). On the Mac run
`mactv pair` and type the six-digit PIN on the TV. Done: the picture appears.

## 5. Use

| Remote | |
|---|---|
| arrows / OK | pointer mode: move and click; key mode or remote-built pages: keys |
| back | back a page on the Mac; hold to leave |
| menu (or info/guide) | the menu: desktop, the Mac's apps, keyboard, fill window, pointer/key mode, settings |
| play/pause, ffwd, rewind | playback |
| channel up/down | scroll |

A launcher can open a page directly: start `tv.mactv.receiver/.ReceiverActivity` with the extra `app`
(e.g. `music`) or `play` (`albums <id> [shuffle]`), with flags NEW_TASK | CLEAR_TOP (0x14000000), so the
extra is delivered even when the receiver is already running.

## TV-specific notes

See docs/tv-notes.md before changing anything on the TV itself (debloating, sources): one brand's decoder,
for instance, stays locked to live TV after a reboot unless the input source is reset.
