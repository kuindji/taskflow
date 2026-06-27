#!/usr/bin/env bash
# Full release build: (codegen — added in later tasks) -> swift build -c release -> bundle.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # native/
cd "$HERE"

# Codegen + theme bake are wired here in Tasks 3-6:
( cd "$HERE/.." && bun native/scripts/codegen/generate.ts )
#   bun scripts/codegen/bake-themes.ts
# Backend staging is wired here in Task 8:
#   scripts/build-backend-sidecar.sh

swift build -c release
EXECUTABLE="$HERE/.build/release/Taskflow"
scripts/make-app-bundle.sh "$EXECUTABLE" "$HERE/.build/app"
echo "Done: $HERE/.build/app/Taskflow.app"
