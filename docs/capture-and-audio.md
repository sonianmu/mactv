# Picture and sound

## Picture

- **Capture**: ScreenCaptureKit, the session's only display, NV12 (video range), BT.709, scaled by the capture
  to the negotiated size, at most `fps`, cursor not drawn (the TV draws its pointer). The host needs **Screen
  Recording** permission *in the session user's session*; the first capture attempt asks there.
- **Hidden apps**: `config.hiddenApps` (default Notification Center) are left out of the capture with a
  content filter, so system banners in the session never reach the TV. (Stopping Notification Center in the
  session is not allowed with SIP on.) Apps are matched by process; the filter is renewed when one restarts.
  `mactv filter off|on` shows/hides them to check.
- **Encoder**: VideoToolbox, HEVC Main or H.264 High, real-time, low-latency rate control, no frame
  reordering, key frame at least every 2 s, colour tagged BT.709 (untagged HEVC was read as BT.2020 by a TV:
  warm and dull). Burst limit about 2× the average over one second.
- **Still screens**: ScreenCaptureKit sends nothing while nothing changes, but TV decoders hold the last
  pictures back until more frames arrive. The last picture is re-encoded every ~0.1 s (a few bytes each).
- **Size**: the session's framebuffer is twice its point size (1920×1080 pt → 3840×2160 px). A 4K stream
  needs HEVC and a wired network in practice (≈40 Mbps); Wi-Fi gets 1080p.
- **Sharpness**: on a TV whose UI layer is 1080p, only a SurfaceView reaches the 4K video plane; the receiver
  also fixes the surface's buffer size at 3840×2160, otherwise the TV scales the picture down and back up
  ("sharp yet blurry"). If the picture looks over-sharpened, it is usually the TV's own picture processing
  (try its Game/PC picture mode).

## Sound

The host taps the sound of its own user's processes with a CoreAudio **process tap**
(`CATapDescription(stereoMixdownOfProcesses:)`, `muteBehavior = .muted`) on a private aggregate device, and
sends s16le 48 kHz stereo. The owner's processes are never tapped or muted. macOS 14.2+; no permission prompt
was needed in testing.

Rules, each learned from a failure:

1. **Tap only processes that are putting sound out** (`kAudioProcessPropertyIsRunningOutput == 1`). Mixing in
   the user's other processes (most without any audio object) produced a full-scale flat hiss instead of the mix.
2. **Never tear the tap down because playback paused.** With `.muted`, destroying and re-creating taps left
   the browser's audio process muted for good: every later tap captured pure silence until the browser was
   restarted. When the list of playing processes goes empty, keep the tap; rebuild only for a *different
   non-empty* set.
3. **A tap can go silent while its process still plays** (the browser restarted its audio service). Rebuild
   only after sound was heard and then 10 s of silence, and keep such rebuilds rare (`mactv doctor` flags many).
4. **FairPlay output is silence to a tap** (Apple's Music and TV apps): use web players (Widevine) instead.
5. **Chrome's out-of-process audio service** made coreaudiod treat the sound as not present in an off-console
   session (volume 0.0). Keep audio in the renderer (don't enable `AudioServiceOutOfProcess`).
6. When analysing captured PCM: it is **little-endian**. Tell noise from music by the mean absolute
   difference between neighbouring samples (white noise ≈ 21000, music ≈ 2800), not by the peak.

On the TV: the receiver plays through an AudioTrack (media usage) and drops the oldest sound when more than a
quarter second piles up, so picture and sound stay together.
