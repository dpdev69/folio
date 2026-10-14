#!/usr/bin/env bash
# Build the Folio macOS app and dmg.
#
# Unsigned by default (linker-signed only). Signing is a
# drop-in: export APPLE_SIGNING_IDENTITY (or APPLE_CERTIFICATE and
# APPLE_CERTIFICATE_PASSWORD in CI) and Tauri signs the app and the bundled
# opencode sidecar with the hardened runtime and Entitlements.plist.
# Notarization runs when APPLE_ID, APPLE_PASSWORD and APPLE_TEAM_ID are set,
# or APPLE_API_ISSUER, APPLE_API_KEY and APPLE_API_KEY_PATH.
#
# FOLIO_TARGET overrides the target triple (default aarch64-apple-darwin).
# FOLIO_DMG_PLAIN=1 skips only the Finder styling of the dmg window (icon
# positions and window size). Use it on a headless machine or when Finder
# automation is not allowed: the dmg step otherwise stops with "AppleEvent
# timed out (-1712)". It sets CI=true for the tauri build command alone.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

target="${FOLIO_TARGET:-aarch64-apple-darwin}"
case "$target" in
  aarch64-apple-darwin) arch="aarch64" ;;
  x86_64-apple-darwin) arch="x64" ;;
  *) echo "Unsupported FOLIO_TARGET: $target" >&2; exit 1 ;;
esac

if [ ! -d node_modules ]; then
  npm ci
fi

npm run fetch-press -- --target "$target"
if [ "${FOLIO_DMG_PLAIN:-}" = 1 ]; then
  # Tauri's dmg bundler skips the Finder AppleScript step when CI is set.
  CI=true npx tauri build --bundles app,dmg --target "$target"
else
  npx tauri build --bundles app,dmg --target "$target"
fi

version="$(node -p "require('./src-tauri/tauri.conf.json').version")"
bundle="$root/src-tauri/target/$target/release/bundle"
app="$bundle/macos/Folio.app"
dmg="$bundle/dmg/Folio_${version}_${arch}.dmg"

if [ ! -d "$app" ] || [ ! -f "$dmg" ]; then
  echo "Expected outputs are missing:" >&2
  [ -d "$app" ] || echo "  app: $app" >&2
  [ -f "$dmg" ] || echo "  dmg: $dmg" >&2
  echo "If the dmg step timed out on Finder, run again with FOLIO_DMG_PLAIN=1." >&2
  exit 1
fi

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
    echo "Notarized: no. Set APPLE_ID, APPLE_PASSWORD and APPLE_TEAM_ID, or the APPLE_API_* variables, and run this script again."
  fi
  echo
  echo "Verify:"
  echo "  codesign --verify --deep --strict --verbose=2 \"$app\""
  echo "  spctl --assess --type execute --verbose \"$app\""
  if [ "$notarized" = 1 ]; then
    echo "  xcrun stapler validate \"$dmg\""
  fi
else
  cat <<CMDS
Signed: no. The app is unsigned (linker-signed only), so Gatekeeper will warn on other Macs.

The supported path is to set APPLE_SIGNING_IDENTITY plus the notarization
variables (APPLE_ID, APPLE_PASSWORD, APPLE_TEAM_ID, or APPLE_API_ISSUER,
APPLE_API_KEY, APPLE_API_KEY_PATH) and run this script again. Tauri then signs
the sidecar and the app, notarizes, and staples.

To do the same by hand, a release engineer runs the following. The dmg must be
rebuilt from the signed app, because the dmg built above holds the unsigned one.

  IDENTITY="Developer ID Application: Your Name (TEAMID)"
  ENT=src-tauri/Entitlements.plist
  APP="$app"
  DMG="$dmg"

  # 1. Sign the sidecar, then the app.
  codesign --force --options runtime --timestamp --entitlements "\$ENT" \\
    --sign "\$IDENTITY" "\$APP/Contents/MacOS/opencode-cli"
  codesign --force --options runtime --timestamp --entitlements "\$ENT" \\
    --sign "\$IDENTITY" "\$APP"
  codesign --verify --deep --strict --verbose=2 "\$APP"

  # 2. Notarize the app from a zip, then staple the app.
  ditto -c -k --keepParent "\$APP" /tmp/Folio-notarize.zip
  xcrun notarytool submit /tmp/Folio-notarize.zip \\
    --apple-id "\$APPLE_ID" --password "\$APPLE_PASSWORD" --team-id "\$APPLE_TEAM_ID" --wait
  xcrun stapler staple "\$APP"

  # 3. Rebuild the dmg from the stapled app, sign it, notarize it, staple it.
  STAGE="\$(mktemp -d)"
  cp -R "\$APP" "\$STAGE/"
  ln -s /Applications "\$STAGE/Applications"
  rm -f "\$DMG"
  hdiutil create -volname Folio -srcfolder "\$STAGE" -ov -format UDZO "\$DMG"
  codesign --force --timestamp --sign "\$IDENTITY" "\$DMG"
  xcrun notarytool submit "\$DMG" \\
    --apple-id "\$APPLE_ID" --password "\$APPLE_PASSWORD" --team-id "\$APPLE_TEAM_ID" --wait
  xcrun stapler staple "\$DMG"
CMDS
fi
