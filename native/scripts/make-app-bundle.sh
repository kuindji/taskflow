#!/usr/bin/env bash
# Wrap a SwiftPM-built executable into a launchable macOS .app bundle.
# Usage: make-app-bundle.sh <executable-path> <output-dir>
set -euo pipefail

EXECUTABLE="${1:?path to built Taskflow executable required}"
OUTDIR="${2:?output directory required}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # native/

APP="$OUTDIR/Taskflow.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

cp "$EXECUTABLE" "$APP/Contents/MacOS/Taskflow"
cp "$HERE/Info.plist" "$APP/Contents/Info.plist"

# Copy SwiftPM resource bundles (themes, etc.) next to the executable.
EXEC_DIR="$(dirname "$EXECUTABLE")"
for bundle in "$EXEC_DIR"/*.bundle; do
    [ -e "$bundle" ] && cp -R "$bundle" "$APP/Contents/MacOS/"
done

# Stage the backend sidecar if present (populated by build-app.sh in Task 8).
if [ -d "$HERE/Sources/Taskflow/Resources/backend" ]; then
    cp -R "$HERE/Sources/Taskflow/Resources/backend" "$APP/Contents/Resources/backend"
fi

# Ad-hoc sign so Gatekeeper lets it launch locally.
codesign --force --deep --sign - "$APP" >/dev/null 2>&1 || true

echo "Built $APP"
