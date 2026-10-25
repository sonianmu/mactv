# Web apps

The premise of MacTV: if it works in a desktop browser on a Mac, it can work on the TV. A web app is a page
the host opens in its own Chrome window when the TV sends `app <name>`.

## Declaring one

An app is a folder under `host/apps/` with an `app.json`; `mactv install` copies the folders to
`/Users/Shared/MacTV/apps/` and the host offers every one it finds (or only `enabledApps` from config.json).
The engine has no built-in apps. `host/apps/music/app.json`:

```json
{"title": "Apple Music", "url": "https://music.apple.com/", "profile": "MacTV Music", "scale": 2,
 "debugPort": 9223, "remote": true, "tvui": "tvui.js",
 "keys": {"next": "n", "previous": "p"}, "commands": {"play": "__tvuiPlay"}, "text": "__tvuiText",
 "service": "feed.py", "settings": {"feedPort": 8812, "language": "en-US"}}
```

| Key | Meaning |
|---|---|
| `title` | name in the TV's menu (sent in the Welcome's `titles`) |
| `url` | the page |
| `profile` | Chrome profile directory (under the session user's Application Support): sign-ins stay per app |
| `scale` | page zoom; the screen is across the room (2 is right for most) |
| `userAgent` | optional; YouTube serves its TV interface only to TV user agents |
| `debugPort` | DevTools on loopback, unique per app: needed for self-repair, `tvui`, `commands`, `text` |
| `remote` | the page is built for a remote: the TV sends keys instead of a pointer |
| `tvui` | a script in the app's folder laid over the page (a TV interface) |
| `keys` | remote keys the page wants as other keystrokes (`next`, `previous`) |
| `commands` | TV commands the page handles: verb → function on `window`, called with the command's words until it returns `'ok'` |
| `text` | function on `window` that takes text from the TV's keyboard (any language) |
| `service` | a helper program in the app's folder that the host keeps running |
| `settings` | free-form, for the app's own scripts; config.json `appSettings.<app>` overrides it |

A config.json `apps.<name>` entry adds an app or replaces one entirely (paths there are relative to `apps/`).
`mactv restart host` after any change. To start a new app: copy `host/apps/_template`.

## How the host runs them

- One **Chrome kiosk** window per app (no title bar, no menu bar), started with `--user-data-dir`, `--app`,
  `--force-device-scale-factor`, autoplay allowed, notifications and permission prompts denied, and three flags
  that matter off the console: `--disable-backgrounding-occluded-windows --disable-renderer-backgrounding
  --disable-background-timer-throttling` (macOS reports an off-console window as occluded; without them Chrome
  stops painting and keys seem to do nothing). Also `--use-mock-keychain --password-store=basic` (the session
  user's keychain is locked off the console).
- **One player at a time**: opening an app closes the others (SIGTERM: Chrome ignores a polite quit from
  another app), or both would play into the TV.
- Coming back to an app brings its window forward instead of opening another.
- **Self-repair** (`tools/cdp.py heal`) every 15 s while a TV watches: full screen that macOS stopped
  presenting (detected because the page's viewport is shorter than the screen; Chrome's own window state
  still says "fullscreen") is restored by going out of full screen and back in; a missing `tvui` is re-injected.

## A TV interface (tvui)

`host/apps/music/tvui.js` turns Apple's web player into a tvOS-style app: a centred tab bar (Home, Browse,
Library, Search), rows of large artwork, the library as kinds beside a grid, album pages, a frosted mini
player, a full-screen player with timed lyrics, favourite and "more" menus. It drives the page's own MusicKit,
so the account and catalogue are Apple's. Conventions any tvui follows:

- keys arrive as real keyboard events (arrows, Enter, Escape, Space, n/p); the page handles them;
- `window.__tvui = VERSION` guards against double injection; a newer version replaces an older one (reloads);
- optional hooks the host calls through DevTools, named in app.json: a page command (music:
  `"commands": {"play": "__tvuiPlay"}`, so `play albums 123 shuffle` calls `__tvuiPlay("albums", "123",
  "shuffle")` → `'ok'` or `'wait'`) and a text hook (`"text": "__tvuiText"`, called with the text and whether
  to submit);
- to ask the TV for its keyboard, prefix `document.title` with `⌨`; the host reports `keyboard: true`.

Apple Music notes: set `MusicKit.previewOnly = false` (else 30-second previews); play in the account's own
storefront (`/v1/me/storefront`), or library songs from another storefront fail to queue; the queue's own
items come back in English/pinyin, so names are fetched again with `l=zh-Hans-CN` (or your language).

## Data services

A service is a helper the host keeps running (an app's `service`, e.g. `music/feed.py`): it serves data a TV
home screen can render natively (the account's recently played albums, at `:8812/home.json?token=…`). This
is the other way to lend the Mac's power: not pixels, but work done for the TV and handed over as data.
