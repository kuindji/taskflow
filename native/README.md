# Taskflow (native macOS)

Production SwiftUI app (Phase 2+ of the native rewrite). macOS 13+, SwiftPM, Swift 6.

## Build & run (debug)
    swift build && ./.build/debug/Taskflow

## Build the .app bundle (release)
    scripts/build-app.sh        # codegen -> backend -> swift build -c release -> Taskflow.app

## Regenerate codegen (run from repo root)
    bun native/scripts/codegen/generate.ts       # @taskflow/shared types -> Sources/Taskflow/Generated
    bun native/scripts/codegen/bake-themes.ts     # bundled themes -> Sources/Taskflow/Resources/themes

Generated Swift and resolved theme JSON are committed and reproducible.
