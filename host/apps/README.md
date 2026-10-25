# Apps

An app is a folder here with an `app.json`. The engine has no built-in apps: it finds these folders in
`<runtimeDir>/apps/` at start and offers each one to the TV (the TV's menu, `app <name>`).

| Folder | What it shows |
|---|---|
| `music/` | a full TV interface (`tvui.js`) laid over Apple Music's web player, plus a data service (`feed.py`) for a TV home screen |
| `youtube/` | YouTube's own TV interface, which it serves to TV browsers |
| `_template/` | copy to `<name>/`, rename `app.json.example` to `app.json`, edit |

To add one: copy `_template`, set `url` and a new `profile` and `debugPort`, `mactv install` (copies apps to
the runtime) and `mactv restart host`. Keys, the TV interface layer and page commands: docs/web-apps.md.
To offer only some apps: `"enabledApps": ["youtube"]` in config.json.
