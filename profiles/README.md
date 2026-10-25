# Device profiles

What is known about a kind of device, as data an agent can match and act on. The engine never reads these:
they are for the agent (and people) bringing MacTV up, so that a quirk found once is not rediscovered.

Start from `tv/generic-android-tv.json`, which applies to every Android TV, then look for a brand profile
whose `match` fits the TV (`adb shell getprop ro.product.brand`, `ro.product.model`,
`ro.build.version.release`). If none fits, follow the generic one and write a new profile from what you find.

## Format

```json
{
  "id": "brand-family",
  "kind": "tv",
  "match": {"brand": "regex", "model": "regex", "android": "regex"},   // all optional; omitted = any
  "facts": {"decoders": "...", "ui": "1920x1080", "notes": "..."},
  "quirks": [
    {
      "id": "short-name",
      "symptom": "what the person or the receiver sees",
      "cause": "why, as far as it is known (say 'unknown' if it is)",
      "check": "a read-only command that confirms it",
      "fix": "commands or steps; mark anything that changes the TV",
      "changesDevice": true,
      "verified": "where it was verified (device report file), or 'untested'"
    }
  ]
}
```

Rules: models and versions only, never addresses, serial numbers or account names. A quirk without a
`check` is a rumour; say so in `verified`.
