#!/usr/bin/env bash
# Build the Folio macOS app and dmg.
#
# Unsigned by default (Tauri applies an ad-hoc signature). Signing is a
# drop-in: export APPLE_SIGNING_IDENTITY (or APPLE_CERTIFICATE and
# APPLE_CERTIFICATE_PASSWORD in CI) and Tauri signs the app and the bundled
# opencode sidecar with the hardened runtime and Entitlements.plist.
# Notarization runs when APPLE_ID, APPLE_PASSWORD and APPLE_TEAM_ID are set,
# or APPLE_API_ISSUER, APPLE_API_KEY and APPLE_API_KEY_PATH.
#
# FOLIO_TARGET overrides the target triple (default aarch64-apple-darwin).
# FOLIO_DMG_PLAIN=1 skips the Finder styling of the dmg window (icon positions).
# Use it on a headless machine or when Finder automation is not allowed: the
# dmg then times out with "AppleEvent timed out (-1712)" without it.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

target="${FOLIO_TARGET:-aarch64-apple-darwin}"
case "$target" in
  aarch64-apple-darwin) arch="aarch64" ;;
  x86_64-apple-darwin) arch="x64" ;;
  *) echo "Unsupported FOLIO_TARGET: $target" >&2; exit 1 ;;
esac

if [ "${FOLIO_DMG_PLAIN:-}" = 1 ]; then
  # Tauri's dmg bundler skips the Finder AppleScript step when CI is set.
  export CI=true
fi

if [ ! -d node_modules ]; then
  npm ci
fi

npm run fetch-press -- --target "$target"
npx tauri build --bundles app,dmg --target "$target"

version="$(node -p "require('./src-tauri/tauri.conf.json').version")"
bundle="$root/src-tauri/target/$target/release/bundle"
app="$bundle/macos/Folio.app"
dmg="$bundle/dmg/Folio_${version}_${arch}.dmg"

echo
echo "Built Folio $version for $target"
echo "  app: $app"
echo "  dmg: $dmg"

signed=0
if [ -n "${APPLE_SIGNING_IDENTITY:-}" ] || [ -n "${APPLE_CERTIFICATE:-}" ]; then
  signed=1
fi

notarized=0
if [ -n "${APPLE_ID:-}" ] && [ -n "${APPLE_PASSWORD:-}" ] && [ -n "${APPLE_TEAM_ID:-}" ]; then
  notarized=1
elif [ -n "${APPLE_API_ISSUER:-}" ] && [ -n "${APPLE_API_KEY:-}" ] && [ -n "${APPLE_API_KEY_PATH:-}" ]; then
  notarized=1
fi

if [ "$signed" = 1 ]; then
  echo "Signed: yes (Tauri signed the app and the opencode sidecar)."
  if [ "$notarized" = 1 ]; then
    echo "Notarized: yes (Tauri submitted the build and stapled the ticket)."
  else
    echo "Notarized: no. Set APPLE_ID, APPLE_PASSWORD and APPLE_TEAM_ID, or the APPLE_API_* variables, and build again."
  fi
else
  echo "Signed: no. Tauri applied an ad-hoc signature, so Gatekeeper will warn on other Macs."
  echo
  echo "To sign and notarize by hand, a release engineer runs:"
  cat <<CMDS

  IDENTITY="Developer ID Application: Your Name (TEAMID)"
  codesign --force --options runtime --timestamp \\
    --entitlements src-tauri/Entitlements.plist \\
    --sign "\$IDENTITY" "$app/Contents/MacOS/opencode-cli"
  codesign --force --options runtime --timestamp \\
    --entitlements src-tauri/Entitlements.plist \\
    --sign "\$IDENTITY" "$app"
  codesign --verify --deep --strict --verbose=2 "$app"
  xcrun notarytool submit "$dmg" \\
    --apple-id "\$APPLE_ID" --password "\$APPLE_PASSWORD" --team-id "\$APPLE_TEAM_ID" --wait
  xcrun stapler staple "$dmg"

Rebuild the dmg after signing the app, or set APPLE_SIGNING_IDENTITY and run this script again.
CMDS
fi
