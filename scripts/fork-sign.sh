#!/bin/bash
# Signs an app bundle with this Mac's fork signing identity, creating the identity on first use.
# An ad-hoc signature changes with every build, so the Keychain and macOS privacy settings treat
# each build as a new app and ask again. A fixed certificate keeps the signature's requirement
# stable, so one "Always Allow" covers later builds too.
#   scripts/fork-sign.sh "/Applications/T3 Code (Fork).app"
set -euo pipefail

app="${1:?usage: $0 <app bundle>}"
dir="$HOME/.config/t3code-fork-signing"
keychain="$dir/signing.keychain-db"
name="T3 Code Fork Signing"

if [ ! -f "$keychain" ]; then
  mkdir -p "$dir"
  chmod 700 "$dir"
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  cat >"$tmp/cert.cnf" <<EOF
[req]
distinguished_name = dn
x509_extensions = ext
prompt = no
[dn]
CN = $name
[ext]
basicConstraints = critical,CA:false
keyUsage = critical,digitalSignature
extendedKeyUsage = critical,codeSigning
EOF
  openssl req -x509 -newkey rsa:2048 -nodes -days 10950 -config "$tmp/cert.cnf" \
    -keyout "$tmp/key.pem" -out "$tmp/cert.pem" 2>/dev/null
  openssl pkcs12 -export -inkey "$tmp/key.pem" -in "$tmp/cert.pem" -name "$name" \
    -out "$tmp/identity.p12" -passout pass:fork
  # A separate keychain, because the mac runner's sandbox cannot read the login keychain.
  security create-keychain -p "" "$keychain"
  security set-keychain-settings "$keychain"
  security unlock-keychain -p "" "$keychain"
  security import "$tmp/identity.p12" -k "$keychain" -P fork -T /usr/bin/codesign >/dev/null
  security set-key-partition-list -S apple-tool:,apple: -s -k "" "$keychain" >/dev/null
fi

security unlock-keychain -p "" "$keychain"
codesign --force --deep --keychain "$keychain" --sign "$name" "$app"
