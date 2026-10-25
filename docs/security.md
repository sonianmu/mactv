# Security and privacy

MacTV gives a device on your network a computer session. Treat it that way.

| What | Where it lives | Notes |
|---|---|---|
| session user's password | the **owner's login keychain**, service "MacTV session" | read by the holder at start; never in a file, the config or the repository |
| TV pairing tokens | session user's `~/Library/Application Support/MacTV/paired.json`, mode 600 | 256-bit random; `mactv unpair` revokes |
| Apple Music tokens (feed) | session user's `~/Library/Application Support/MacTV/music-tokens.json`, mode 600 | read from the signed-in web player |
| web sign-ins | the session user's Chrome profiles | per app |
| Wake-on-LAN address | the TV's app data | sent by the host in the Welcome; never configured |

## Exposure

- **8810 (TV port)**: on the home network. Without a valid token a client gets `bye` and nothing else; PING
  only reveals that a MacTV host and its name are there. Keep `requirePairing: true` (default). Protocol 0
  (no authentication) is off unless `allowLegacy` is set.
- **8812 (music feed)**: home network, requires a paired token.
- **8813 admin, 8811 input relay, DevTools ports**: loopback only. Anyone with a shell on the Mac can reach
  them; that person could already do more.
- **The stream is not encrypted.** Someone able to capture your home network's traffic could watch it. This is
  a home-LAN design; don't expose these ports to the internet or to a network you don't trust.
- **Pairing**: a PIN is six digits, valid once, for a window you open (default 120 s); five wrong guesses close
  the window.

## The session user

- Make it a **Standard** account (not an administrator) with a long random password.
- Its password logs in to Screen Sharing. A Screen Sharing login as that user *without* the private
  framebuffer shows the **console**: the owner's screen, with no approval prompt. That is why the password
  stays in the keychain only.
- Whatever you sign in to inside that session (Apple ID in the web player, YouTube) is usable from the TV.

## Things never to put in issues, logs you share, or commits

IP and MAC addresses, the Mac's or TV's personal names, the session password, tokens, `paired.json`,
`music-tokens.json`, packet captures (`.pcap`), screenshots of signed-in pages. `.gitignore` covers the files.
