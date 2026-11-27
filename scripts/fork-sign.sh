#!/bin/bash
# Signs an app bundle with a stable signing identity for this Mac's fork builds.
# Prefers an Apple-issued identity (Developer ID Application or Apple Development) because it
# carries a real TeamIdentifier, keeping macOS Keychain partition_id stable across rebuilds.
# Falls back to a local self-signed identity in a dedicated keychain if no Apple identity exists.
#   scripts/fork-sign.sh "/Applications/T3 Code (Fork).app"
set -euo pipefail

app="${1:?usage: $0 <app bundle>}"
dir="$HOME/.config/t3code-fork-signing"
keychain="$dir/signing.keychain-db"
name="T3 Code Fork Signing"

if [ -n "${T3CODE_FORK_SIGN_IDENTITY:-}" ]; then
  codesign --force --deep --sign "$T3CODE_FORK_SIGN_IDENTITY" "$app"
  exit 0
fi

find_apple_identity() {
  local target_keychain="${1:-}"
  local identities
  if [ -n "$target_keychain" ]; then
    security unlock-keychain -p "" "$target_keychain" 2>/dev/null || true
    identities="$(security find-identity -v -p codesigning "$target_keychain" 2>/dev/null || true)"
  else
    identities="$(security find-identity -v -p codesigning 2>/dev/null || true)"
  fi
  local hash=""
  for prefix in "Developer ID Application:" "Apple Development:"; do
    hash="$(printf '%s\n' "$identities" | awk -v p="$prefix" 'index($0, p) { print $2; exit }')"
    if [ -n "$hash" ]; then
      printf '%s\n' "$hash"
      return 0
    fi
  done
  return 1
}

if [ -f "$keychain" ] && apple_id="$(find_apple_identity "$keychain")"; then
  codesign --force --deep --keychain "$keychain" --sign "$apple_id" "$app"
  exit 0
fi

if apple_id="$(find_apple_identity)"; then
  codesign --force --deep --sign "$apple_id" "$app"
  exit 0
fi

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
