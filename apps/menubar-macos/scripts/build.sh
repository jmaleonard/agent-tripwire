#!/usr/bin/env bash
# Build Tripwire Menubar.app from the Swift sources.
#
# Output: dist/Tripwire Menubar.app — a runnable, unsigned .app bundle.
# Signing / notarization for distribution happens elsewhere (later).
set -euo pipefail

cd "$(dirname "$0")/.."

CONFIG="${CONFIG:-release}"
APP_NAME="Tripwire Menubar"
APP_DIR="dist/${APP_NAME}.app"
CONTENTS="${APP_DIR}/Contents"

# --disable-sandbox lets the build succeed inside other sandboxes
# (notably Homebrew's, where sandbox-exec from SwiftPM is denied).
echo ">>> swift build -c ${CONFIG}"
swift build -c "$CONFIG" --disable-sandbox

BIN=".build/${CONFIG}/TripwireMenubar"
if [ ! -f "$BIN" ]; then
  echo "ERROR: expected binary not found at $BIN" >&2
  exit 1
fi

echo ">>> Wrapping into $APP_DIR"
rm -rf "$APP_DIR"
mkdir -p "${CONTENTS}/MacOS" "${CONTENTS}/Resources"
cp "$BIN" "${CONTENTS}/MacOS/TripwireMenubar"
cp Resources/Info.plist "${CONTENTS}/Info.plist"
chmod +x "${CONTENTS}/MacOS/TripwireMenubar"

# A locally-built app isn't quarantined by default, but be safe.
xattr -dr com.apple.quarantine "$APP_DIR" 2>/dev/null || true

# Ad-hoc codesign so macOS will issue notification permission to the bundle.
# Without a signature, UNUserNotificationCenter rejects requestAuthorization
# on an unsigned binary. The `-` sign identity is ad-hoc (no Developer ID
# needed) but gives the bundle a verifiable signature so LaunchServices
# treats it as a real app.
echo ">>> ad-hoc codesigning"
codesign --force --deep --sign - "$APP_DIR" 2>&1 | tail -2 || true

echo ">>> Built: $APP_DIR"
echo "    Run:   open \"$APP_DIR\""
echo "    Stop:  pkill -f TripwireMenubar"
