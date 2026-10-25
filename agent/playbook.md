# Playbook: bringing MacTV up on someone's Mac and TV

Eight phases. Each ends with a **gate**: a check that must pass before the next phase. You install,
configure, adapt and verify; you do not rewrite the engine per installation (agent/adapt.md says where
changes go). The hard rules in AGENTS.md apply throughout.

## 1. Survey (read-only)

Collect, and write into a new `examples/devices/<mac>-<tv>.md` from `TEMPLATE.md` (models only):

- Mac: `sw_vers`, `uname -m`, `host/bin/mactv preflight`; wired or Wi-Fi.
- TV: `adb shell getprop ro.product.brand`, `ro.product.model`, `ro.build.version.release`; hardware decoders
  (`adb shell dumpsys media.player`, or let the receiver report them later); `adb shell wm size`.
- Network: same subnet? Either side on Wi-Fi?

Match profiles: `profiles/tv/generic-android-tv.json` always, plus any `profiles/tv/*.json` whose `match`
fits; `profiles/mac/*.json` likewise. Run each quirk's `check`. Anything that matches goes into the report
and the plan. No profile for this brand: you will write one in phase 7.

Decide with the person:
- **4K or 1080p.** 4K needs HEVC on the TV and, in practice, Ethernet (~40 Mbps). On Wi-Fi expect 1080p.
- **Which apps** (`host/apps/`; others: docs/web-apps.md). Set `enabledApps` in the config accordingly.

Gate: preflight has no ✗ the person won't fix. If macOS < 14.2 or the TV isn't Android, stop and say so
(another display: docs/receiver-contract.md).

## 2. Mac prerequisites (the person does these)

docs/setup-mac.md steps 2–3: a Standard session user (default `mactv`), Screen Sharing turned on **from
System Settings** with that user allowed.

Gate: `host/bin/mactv preflight` all ✓.

## 3. Install

```bash
host/scripts/make-signing-identity.sh      # optional; ask: it adds a certificate to the login keychain
host/bin/mactv install                     # asks for the session password once, then sudo once
```

If an older MacTV installation is running (other launch agents on the same ports), stop it first and say so.

Gate: `mactv logs holder` shows `session open`; `mactv doctor` shows the holder and guard under launchd.
The host may not run yet: it needs phase 4.

## 4. Inside the session (the person does these)

docs/setup-mac.md step 5: allow Screen Recording for MacTV Host in the session; sign in to each enabled app's
Chrome profile; optional comfort settings. You can't click for them; guide them.

Gate: `mactv doctor` all ✓ except "no TV connected"; `mactv status` → `picture.capturing: true`.

## 5. The TV (the person accepts prompts)

Check nobody is watching. docs/setup-tv.md: developer options, `adb connect`, build `tv/` (JDK 17 + Android
SDK 34), install the receiver, open it, `mactv pair`, the person types the PIN. Apply the matched profiles'
fixes that the person agreed to.

Gate: the TV shows the session's desktop; `mactv status` → `receiver.connected: true` with the expected codec
and size; `framesDropped` stays small over a minute.

## 6. Verify end to end

Record every row in the device report:

| Check | How | Pass |
|---|---|---|
| protocol | `(cd host && swift build -c release) && python3 tests/test_protocol.py` | all OK |
| picture | raw TV screenshot (profiles/tv/generic-android-tv.json `screenshot-cut`), or ask the person | session visible, not black |
| 4K real | `mactv status` video size; a 1-pixel line pattern on the Mac, read on the TV | lines distinct |
| sound | play something from the TV | heard on the TV, **not** on the Mac's speakers; the owner's own sound unaffected |
| isolation | while the TV is used, look at the owner's desktop and sound | untouched |
| remote | pointer mode, key mode, back, menu, keyboard (a non-Latin word in a search box) | all reach the Mac |
| hidden apps | `mactv filter off`, trigger a notification in the session, then `mactv filter on` | banner visible only while off (positive control) |
| recovery | `mactv restart host`; then pull the TV's network for 10 s | the TV says which link broke and reconnects by itself |
| self-repair | `mactv status` → `lastHeal`; break full screen on purpose (docs/web-apps.md) | restored within 15 s |
| reboot | (person) reboot the Mac, log in | `mactv doctor` green without any command |

## 7. Adapt

Anything that differed: agent/adapt.md. Write new quirks into a profile (with a `check`), general bugs into
the engine with a test.

Gate: every difference is explained, fixed in its layer, and written down.

## 8. Hand back

- A short summary for the person: what works, what doesn't, what they must remember (e.g. "choosing HDMI in
  the Source panel breaks the decoder until …").
- The device report and any new or updated profile.
- Nothing personal in any file you created:
  `grep -rnE '([0-9]{1,3}\.){3}[0-9]{1,3}|([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}' examples/ docs/ profiles/`
  shows only documentation placeholders.
