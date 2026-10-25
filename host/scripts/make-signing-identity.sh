#!/bin/bash
# Creates a self-signed code-signing certificate "MacTV Local Signing" in your login keychain, so that the
# host keeps its Screen Recording permission across rebuilds (scripts/build.sh uses it automatically).
# Local only: it signs your own build on your own Mac and is trusted by nothing else. macOS may ask for your
# login keychain password. Remove it any time in Keychain Access.
set -euo pipefail
NAME="MacTV Local Signing"
if security find-certificate -c "$NAME" >/dev/null 2>&1; then echo "already there: $NAME"; exit 0; fi
KEYCHAIN="${1:-$HOME/Library/Keychains/login.keychain-db}"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
cat > "$T/cfg" <<CFG
[req]
distinguished_name = dn
x509_extensions = ext
prompt = no
[dn]
CN = $NAME
[ext]
keyUsage = critical, digitalSignature
extendedKeyUsage = critical, codeSigning
basicConstraints = critical, CA:false
CFG
openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -keyout "$T/key.pem" -out "$T/cert.pem" -config "$T/cfg" 2>/dev/null
P=$(openssl rand -hex 16)
# -legacy where supported: macOS's importer reads the older PKCS#12 encryption.
openssl pkcs12 -export -legacy -inkey "$T/key.pem" -in "$T/cert.pem" -out "$T/id.p12" -passout "pass:$P" 2>/dev/null \
  || openssl pkcs12 -export -inkey "$T/key.pem" -in "$T/cert.pem" -out "$T/id.p12" -passout "pass:$P"
security import "$T/id.p12" -k "$KEYCHAIN" -P "$P" -T /usr/bin/codesign
echo "created: $NAME (in $KEYCHAIN)"
