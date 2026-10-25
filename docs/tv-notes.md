# TV notes

Brand- and model-specific findings. Add yours (examples/devices/TEMPLATE.md) when you meet something new.

## General Android TV

- **Hardware decoder only.** TVs often have no software decoder fast enough (or none at all for AVC). If
  MediaCodec starts but never hands out an input buffer, something else holds the decoder: the receiver says
  "decoder busy" after 3 s.
- **SurfaceView for 4K.** The UI layer of many TVs is fixed at 1080p; only the video plane is 4K. Fix the
  surface buffer size at the stream size or the TV scales down and back up.
- **No logcat.** Some TVs drop third-party log lines; the receiver writes
  `Android/data/tv.mactv.receiver/files/mactv-debug.txt` instead (`adb shell cat /sdcard/Android/data/tv.mactv.receiver/files/mactv-debug.txt`).
- **Screenshots**: `adb shell screencap -p` can be cut off on slow TVs; save a raw frame
  (`screencap /data/local/tmp/f.raw`), pull it and convert it on the computer. A screenshot of the video plane
  is sometimes all black; take another.
- **Installing interrupts.** On some TVs the stock home app re-launches itself after every `pm install`.
  Check that nobody is watching first.
- **`am start` without CLEAR_TOP** only brings an existing task forward ("Activity not started, its current
  task has been brought to the front") and delivers no extras. Use `-f 0x14000000` when testing deep links.

## Hisense 50H55E (China, VIDAA 6 on Android 9, MStar/MTK, 1.2 GB RAM, 1920×1080 UI)

- **The single video decoder stays with live TV after a reboot** if the last input source was the tuner or
  an HDMI port: the TV middleware (`hstvos`) reopens that source at boot and never releases the decoder ("TV
  un-release", "GRM Resource Conflict" in logcat). Everything else (the TV's own player, streaming apps) fails
  too. Fix: `adb shell setprop persist.sys.last_source 2562` (the "Android" source) and reboot. Choosing TV or
  HDMI in the Source panel breaks it again until the next fix.
- The middleware also keeps the decoder while the *home app's package* is in front; a receiver in its own
  package gets it.
- The vendor's app manager (`com.hisense.vidaaassistant`) disables third-party boot receivers by component
  name; `pm disable-user` of system apps is partly undone at boot.
- `com.jamdeo.tv.vod` hosts the input-source panel: don't disable it.
- Volume set from the shell is overridden by the TV service; `media volume --stream 3 --set N` works.
- Wired Ethernet measured ~750 Mbps to the Mac; its 2.4 GHz Wi-Fi ~19 Mbps.
- Apple's Android TV app does not play here (Widevine L3, WebView 66): Apple content goes through the Mac.
