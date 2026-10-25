# <Mac model> + <TV model>

Models and versions only. No IP or MAC addresses, no personal device names, no account names.

| | |
|---|---|
| Mac | model, chip, RAM, macOS version |
| TV | brand, model, market/region, Android version, RAM, UI resolution (`wm size`) |
| TV decoders | hevc / avc, largest size (from the receiver's HELLO or `dumpsys media.player`) |
| Network | Mac: Ethernet / Wi-Fi; TV: Ethernet / Wi-Fi; measured Mac→TV throughput |
| MacTV version | host version (`mactv status`), receiver version |

## Results (agent/playbook.md, phase 6)

| Check | Result | Notes |
|---|---|---|
| protocol tests | | |
| picture | | |
| 4K real | | |
| sound (TV yes, Mac speakers no, owner unaffected) | | |
| isolation | | |
| hidden apps (positive control) | | |
| remote (pointer, keys, back, menu, keyboard) | | |
| recovery (restart host, network pull) | | |
| self-repair | | |
| reboot | | |

## Profiles matched

Which `profiles/*/*.json` applied, and which of their quirks were present.

## Device-specific findings

Symptom → cause → fix, for anything that needed special handling. New quirks also go into a profile
(profiles/README.md) with a read-only check.
