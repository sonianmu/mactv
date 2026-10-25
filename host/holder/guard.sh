#!/bin/bash
# MacTV guard (owner's launch agent tv.mactv.guard): watches the system log and stops the holder the moment
# the Mac creates a system-wide virtual display. That only happens when a Screen Sharing client sends
# SetDisplayConfiguration (0x1d), and it is what corrupted WindowServer for the owner (ghosting; mactv's pixels
# on the owner's screen; the physical display going black) until a reboot. The holder never sends it; this is
# the safety net if anything ever does. Trips are written to <runtimeDir>/guard.log.
RUNTIME=${MACTV_RUNTIME:-/Users/Shared/MacTV}
log stream --style compact --predicate 'process == "ScreensharingAgent" AND eventMessage CONTAINS "created virtual display"' |
while read -r line; do
  case "$line" in
    Filtering*) ;;  # log stream echoes its predicate first, keywords included
    *"created virtual display"*)
      echo "$(date '+%F %T') TRIPPED: $line" >> "$RUNTIME/guard.log"
      # Unloaded rather than killed, so launchd doesn't start it again; `mactv start` brings it back.
      launchctl bootout "gui/$(id -u)/tv.mactv.holder" 2>/dev/null
      pkill -f "MacTV/bin/holder.py"
      ;;
  esac
done
