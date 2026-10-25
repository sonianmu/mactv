# Setting up the Mac

Run everything as the Mac's owner (an administrator). Steps marked **(person)** need someone at the Mac.

## 1. Check the Mac

```bash
git clone <this repository> && cd <repository>
host/bin/mactv preflight
```

Needs macOS 14.2+, Apple silicon (Intel untested), the Xcode command line tools (`xcode-select --install`:
Swift, python3, git), Google Chrome in /Applications, and the Mac on the home network. **Wired Ethernet is
strongly recommended** for 4K: Wi-Fi to Wi-Fi measured ~19 Mbps on one home network, far below 4K's ~40 Mbps.

## 2. Create the session user (person)

System Settings → Users & Groups → Add User: a **Standard** user, e.g. full name "MacTV", account name
`mactv`, a long random password (keep it; `mactv install` stores it in your keychain). Or in Terminal:

```bash
sudo sysadminctl -addUser mactv -fullName "MacTV" -password -   # prompts for the password
```

Another account name works too: set `"sessionUser"` in `/Users/Shared/MacTV/config.json` before installing.

## 3. Turn on Screen Sharing (person)

System Settings → General → Sharing → **Screen Sharing** on → ⓘ → "Allow access for": add the session user.
Use this switch, not `launchctl`: enabled any other way, Screen Sharing lacks its capture permission and every
frame is black.

## 4. Install

```bash
host/scripts/make-signing-identity.sh   # optional, once: keeps Screen Recording across rebuilds
host/bin/mactv install
```

This builds `MacTVHost.app`, copies the runtime to `/Users/Shared/MacTV` (config, app, holder, guard, tools,
apps), asks for the session user's password once (stored in **your login keychain**, service "MacTV session"),
installs your launch agents (`tv.mactv.holder`, `tv.mactv.guard`) and, with sudo, the session user's
(`tv.mactv.host`, started with that session through `open -W`). The holder then logs in and the session
starts off-screen; the host starts with it.

## 5. First-time setup inside the session (person)

Fast-user-switch to the session user at the Mac (menu bar → user name → MacTV), then:

1. Wait for the "MacTV Host would like to record this screen" prompt (or open System Settings → Privacy &
   Security → Screen & System Audio Recording) and **allow MacTV Host**.
2. Open each web app once and sign in: run `open -a "Google Chrome" --args --user-data-dir="$HOME/Library/Application Support/MacTV Music" https://music.apple.com`
   (and the YouTube profile likewise), sign in, quit.
3. Optional comfort: Dock autohide, screen lock off, screen saver never.

Log out (or switch back to your own user). The holder reconnects within seconds.

## 6. Check

```bash
host/bin/mactv doctor
```

Every line should be green except "no TV connected" until a TV is paired. `mactv logs host -f` follows the
host. Then set up the TV (docs/setup-tv.md) and pair it:

```bash
host/bin/mactv pair
```

## Everyday

| | |
|---|---|
| `mactv doctor` | which link is broken, and what to do |
| `mactv status` | the host's full report (JSON) |
| `mactv restart host` | e.g. after `mactv install` with a new build |
| `mactv stop` / `start` | take MacTV off and on (the guard trips also need `start`) |
| `mactv devices` / `unpair <id\|all>` | paired TVs |
| `mactv uninstall` | remove the launch agents (runtime, config, user and keychain item stay) |

## Undo everything

`mactv uninstall`; delete `/Users/Shared/MacTV`; delete the keychain item "MacTV session"; turn Screen
Sharing off if you don't use it; delete the session user (System Settings → Users & Groups).
