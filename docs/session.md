# The TV's own macOS session

The TV gets a separate, ordinary macOS user (default `mactv`). macOS only gives the **console** session a
real display and sound output; a second logged-in user (fast user switching) keeps running but its windows
cannot be captured and its sound is silenced. MacTV gets around this with Screen Sharing.

## How it works

The holder (`host/holder/holder.py`, in the owner's session) connects to the Mac's **own** Screen Sharing
over the home network address (loopback viewers are refused) and logs in **as the session user**:

1. `RFB 003.889`, security type 30 (Apple Remote Desktop): Diffie-Hellman, then the credentials (user 64
   bytes + password 64 bytes) encrypted with AES-128-ECB under MD5 of the shared secret.
2. ClientInit `0xC1`: shared, extended ServerInit, **session select**. The server appends a block naming the
   console user.
3. Session select, command 2: `>HHIH (200, 2, 0, 0x0200)` + 64-byte host name + the same 128-byte credential
   block: "connect me to my own session, on a private framebuffer". If the user is not logged in, macOS creates
   an off-console session for it.
4. ViewerInfo (message 0x21, 66 bytes of capability flags, as Apple's viewer sends them), SetMode control,
   pixel format, encodings (raw + DesktopSize), AutoPasteboard, AutoFrameBufferUpdate for the full screen.
5. When the DesktopSize arrives the session's display is up ("new display … in virtual frame buffer" in the
   system log). The holder shrinks server pushes to a 1×1 region: the connection only has to stay open.

The host, running **inside** that session, captures its display with ScreenCaptureKit. The owner's console
is untouched: verified by watching the console user stay the owner and the owner's desktop stay live.

Input goes the same way back: the host sends `k`/`p`/`s` lines to the holder's loopback relay, which turns
them into RFB KeyEvent, PointerEvent and Apple's scroll event (0x17, kind 11; the RFB wheel buttons do
nothing on macOS). No Accessibility permission is involved.

This was worked out by capturing Apple's own viewer (see also the zDesk project's notes on Apple's
"889" protocol, github.com/andrewtheguy/zdesk, docs/apple-vnc-889.md).

## Hard rules

1. **Never send SetDisplayConfiguration (0x1d).** It makes the session's agent create a *system-wide*
   SkyLight virtual display that joins the owner's display arrangement. Creating and destroying it a few
   times corrupted WindowServer on the test Mac: window trails, doubled text, the session's pixels on the
   owner's screen, finally the physical display going black. Only a reboot fixed it. The plain session select
   above gives a *private* framebuffer instead ("in virtual frame buffer", no "created virtual display" in
   the log). `guard.sh` watches the log and stops the holder if the bad kind ever appears.
   Check after any experiment: `log show --last 10m --predicate 'eventMessage CONTAINS "created virtual display"'`
   must print nothing.
2. **Never kill `screensharingd` or a `ScreensharingAgent`** while a session display is up. It left stale
   state ("display index not found"), viewers in a reconnect loop and audio services spinning; only a reboot
   cleaned it up. End connections cleanly instead (stop the holder).
3. **Turn Screen Sharing on in System Settings**, not with `launchctl`: enabled any other way it lacks its
   privacy permissions and every frame is black ("screenCaptureFlag 0").
4. **Do not use High Performance mode** for this: it streams the whole Mac's sound mix (owner included) and
   mutes the Mac's speakers.
5. **The session user's password is a key to that session.** A Screen Sharing login as that user without a
   private framebuffer shows the *console* (the owner's screen) without any approval prompt. Keep the
   password in the keychain only, and the user a Standard (non-admin) account.

## Requirements and limits

- Screen Sharing on, and the session user allowed in it (System Settings → General → Sharing → Screen
  Sharing → ⓘ). Administrators are allowed implicitly; a Standard user must be added.
- The owner must be logged in for the holder (a launch agent) to run: after a reboot, MacTV starts once the
  owner logs in, unless automatic login is enabled (a security trade-off left to the owner).
- Tested on macOS 26/27 on Apple silicon. This protocol is undocumented; a macOS update may change it. If the
  holder logs `session open` but the host sees no display, or frames stay black, start with the log lines
  above and docs/troubleshooting.md.

## One-time setup inside the session

Some things can only be done from inside the session user's own desktop: approving Screen Recording for
MacTV Host, signing in to Chrome profiles (Apple Music, YouTube), dismissing first-run sheets. Two ways in:

- **Fast user switching** at the Mac: log in as the session user on the console, do the setup, log out
  (or switch back). The holder reconnects afterwards.
- **Through the TV itself** once the picture works: pointer mode reaches everything.

Useful settings for the session user (from inside it, or `sudo -u mactv defaults write …`): Dock autohide,
`AppleKeyboardUIMode 2` (keyboard reaches all controls), screen saver and screen lock off
(`sysadminctl -screenLock off` as that user), notifications are hidden from the picture anyway.
