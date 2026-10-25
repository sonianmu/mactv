#!/bin/bash
# Builds MacTVHost.app into host/.build/MacTVHost.app and signs it.
#
# Signing matters: macOS ties the Screen Recording permission to the app's signature. Ad-hoc signing ("-")
# changes with every build, so the permission would have to be granted again inside the session after each
# rebuild. With a stable identity it survives rebuilds. The identity used, in order:
#   $MACTV_SIGN_IDENTITY, then a certificate named "MacTV Local Signing" (scripts/make-signing-identity.sh
#   creates one), then ad-hoc with a warning.
set -euo pipefail
cd "$(dirname "$0")/.."
swift build -c release
APP=.build/MacTVHost.app
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"
cp .build/release/MacTVHost "$APP/Contents/MacOS/MacTVHost"
cp Resources/Info.plist "$APP/Contents/Info.plist"
ID="${MACTV_SIGN_IDENTITY:-}"
if [ -z "$ID" ] && security find-certificate -c "MacTV Local Signing" >/dev/null 2>&1; then ID="MacTV Local Signing"; fi
if [ -n "$ID" ]; then
  codesign --force --sign "$ID" --identifier tv.mactv.host "$APP"
else
  echo "warning: ad-hoc signature; Screen Recording must be granted again after every rebuild (see scripts/make-signing-identity.sh)" >&2
  codesign --force --sign - --identifier tv.mactv.host "$APP"
fi
codesign --verify "$APP" && echo "built $APP"
