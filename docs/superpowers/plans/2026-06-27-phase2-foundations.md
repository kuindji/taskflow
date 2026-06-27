# Phase 2 — Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the production native macOS app's foundations — a SwiftPM app target that builds to a launchable `.app`, bundles + spawns the Bun backend sidecar, codegens Swift types/themes from `@taskflow/shared`, talks to the backend over a production WS client, and renders a themed `ui/` primitives kit.

**Architecture:** A new SwiftPM executable package at repo-root `native/` (the permanent home of the production app; `experiments/native-spike/` and `experiments/native-slice/` stay intact as Phase 0/1 evidence). Build-time `bun` scripts read `packages/shared` and emit Swift (`Generated/*.swift`) + resolved theme JSON (`Resources/themes/*.json`); nothing in `packages/shared` or `packages/backend` is modified (decisions D2/D3). The app launches, spawns the compiled backend as a child process, discovers its port via the existing port-file handshake, and connects over `ws://localhost:<port>` exactly as Electron does today. The reusable transport/store from `native-slice` is productionized in place.

**Tech Stack:** Swift 6 (language mode v6) + SwiftUI/AppKit, SwiftPM (no `.xcodeproj`); `bun` + the TypeScript compiler API for codegen; `libghostty-spm` (terminal, Phase 4) and `CodeEditSourceEditor` (editor, Phase 4) pinned but not yet wired; the existing Bun backend as a sidecar binary.

## Global Constraints

These apply to **every task**; each task's requirements implicitly include them.

- **Platform:** macOS 13+. macOS-only (D1) — no Windows paths.
- **Build system:** SwiftPM only. No `.xcodeproj`. The `.app` is produced by a shell script that wraps the `swift build -c release` product. Everything must be buildable headlessly from the CLI (AI-agent-driven execution).
- **Swift language mode:** `swift-tools-version:6.0`; the app target opts into `.swiftLanguageMode(.v6)` with full strict concurrency. Dependencies keep their own (5.x) mode.
- **App home:** repo-root `native/`. Package name / executable product / target: **`Taskflow`**; test target **`TaskflowTests`**. App bundle: **`Taskflow.app`**. Do **not** touch `experiments/native-spike/` or `experiments/native-slice/`.
- **Dependency pins (exact, carried from Phase 1 — these versions are load-bearing):**
  - `libghostty-spm` — exact `1.2.7`
  - `CodeEditSourceEditor` — exact `0.12.0`
  - `CodeEditTextView` — exact `0.10.1` (transitive; pinned to keep `0.12.0` resolving)
- **No backend/shared edits.** Codegen and theme-bake only **read** `packages/shared`; the sidecar only **runs** the compiled `packages/backend`.
- **Codegen output is committed** (generated Swift + resolved theme JSON live in git, marked generated) and is **reproducible** by re-running the scripts. The build orchestrator runs codegen before `swift build`.
- **Codegen breadth:** emit the **entire** `@taskflow/shared` type surface (all 13 type files incl. discriminated unions), the full `MSG` catalog, and all 14 bundled themes.
- **TS/JS rules (for the `bun` codegen scripts):** use `bun`, never `npm`/`yarn`. No `as any` — pursue proper types (the TS compiler API is fully typed). Don't disable eslint rules. Don't `export` symbols that aren't consumed.
- **Commits:** do **not** add a `Co-Authored-By` trailer. Conventional-commit style messages. Frequent commits (one per task minimum).
- **Taskflow logging (this task runs in a Taskflow task context):** after each task's commit, run `taskflow-cli log commit "<msg>" --hash <hash>` and `taskflow-cli log file "<path>"` for the key edited files (paths relative to the worktree root).

## File Structure

```
native/
  Package.swift                         # Task 1 — Swift 6, exact pins
  .gitignore                            # Task 1
  README.md                             # Task 1 — how to build/run/regenerate
  Info.plist                            # Task 2 — bundle template
  Sources/Taskflow/
    main.swift  (or App.swift)          # Task 1 — @main SwiftUI App, empty window
    App/
      TaskflowApp.swift                 # Task 1/10 — App + root scene
      AppEnvironment.swift              # Task 8/10 — backend URL, wiring
    Generated/                          # codegen output (committed, marked generated)
      MessageType.swift                 # Task 3
      Models/*.swift                    # Task 4/5 — one file per shared type file
    Transport/
      WSCodec.swift                     # Task 7 (ported from slice)
      WSClient.swift                    # Task 7 (productionized)
    Sidecar/
      SidecarManager.swift              # Task 8
      SidecarSupport.swift              # Task 8 — pure, testable helpers
    Theme/
      ResolvedThemeFile.swift           # Task 6 — Codable matching baked JSON
      AppTheme.swift                    # Task 6 — typed token accessors + Color
      ThemeStore.swift                  # Task 6 — loads bundled resolved themes
      GhosttyThemeConfig.swift          # Task 6 — xterm -> ghostty config pairs
    UI/Primitives/                      # Task 9
      AppButton.swift / AppToggle.swift / AppBadge.swift / ...
      PrimitivesGallery.swift           # Task 9
    Resources/
      themes/*.json                     # Task 6 — 14 resolved theme files (committed)
      backend/                          # Task 8 — staged compiled sidecar (gitignored)
  scripts/
    codegen/
      generate.ts                       # Task 3-5 — TS compiler API -> Swift
      bake-themes.ts                    # Task 6 — deriveTheme -> resolved JSON
      lib/                              # Task 3-5 — transform helpers
      generate.test.ts                  # Task 3-5 — bun test
    make-app-bundle.sh                  # Task 2 — wrap product into Taskflow.app
    build-app.sh                        # Task 2/8 — codegen -> backend -> swift build -> bundle
  Tests/TaskflowTests/
    *.swift                             # Tasks 4-9 — Swift unit tests
  evidence/                             # Task 10 — screenshots
```

## Right-sizing note

Ten tasks. Tasks 3–5 build one codegen engine incrementally (catalog → structs → unions) but split because each is independently reviewable and testable. Tasks 1–2 finish unit 2.1; Tasks 3–6 are unit 2.3; Task 7 is unit 2.4; Task 8 is unit 2.2; Task 9 is unit 2.5; Task 10 is the Phase-2 acceptance/integration gate.

---

### Task 1: Scaffold the SwiftPM app (Swift 6, pinned deps, empty window)

**Files:**
- Create: `native/Package.swift`
- Create: `native/Sources/Taskflow/App/TaskflowApp.swift`
- Create: `native/.gitignore`
- Create: `native/README.md`

**Interfaces:**
- Consumes: nothing.
- Produces: a buildable package named `Taskflow` with executable target `Taskflow` and test target `TaskflowTests`; a `@main struct TaskflowApp: App` rendering an empty titled window.

- [ ] **Step 1: Write `native/Package.swift`**

```swift
// swift-tools-version:6.0
import PackageDescription

let package = Package(
    name: "Taskflow",
    platforms: [.macOS(.v13)],
    dependencies: [
        // Terminal (Phase 4). Community fork shipping prebuilt GhosttyKit.xcframework +
        // the HOST_MANAGED .inMemory backend patch. Pinned EXACT — this version is load-bearing.
        .package(url: "https://github.com/Lakr233/libghostty-spm.git", exact: "1.2.7"),
        // Native code editor (Phase 4). Pre-production; 0.12.0 is the last tag that builds under
        // `swift build` (0.13.0+ hit an upstream CodeEditSymbols Bundle.module xcassets bug).
        .package(url: "https://github.com/CodeEditApp/CodeEditSourceEditor.git", exact: "0.12.0"),
        // Force the exact CodeEditTextView 0.12.0 was built against (0.11.0+ changed an API).
        .package(url: "https://github.com/CodeEditApp/CodeEditTextView.git", exact: "0.10.1"),
    ],
    targets: [
        .executableTarget(
            name: "Taskflow",
            dependencies: [
                .product(name: "GhosttyTerminal", package: "libghostty-spm"),
                .product(name: "CodeEditSourceEditor", package: "CodeEditSourceEditor"),
            ],
            path: "Sources/Taskflow",
            resources: [.copy("Resources/themes")],
            swiftSettings: [.swiftLanguageMode(.v6)]
        ),
        .testTarget(
            name: "TaskflowTests",
            dependencies: ["Taskflow"],
            path: "Tests/TaskflowTests",
            swiftSettings: [.swiftLanguageMode(.v6)]
        ),
    ]
)
```

> Note: `resources: [.copy("Resources/themes")]` references a folder created in Task 6. Until then it must exist or SwiftPM errors. Create an empty placeholder now (next step).

- [ ] **Step 2: Create the resources placeholder and `.gitignore`**

Create `native/Sources/Taskflow/Resources/themes/.gitkeep` (empty file) so the `.copy` resource resolves before Task 6 fills it.

`native/.gitignore`:
```
.build/
*.xcodeproj
DerivedData/
Sources/Taskflow/Resources/backend/
.DS_Store
```

- [ ] **Step 3: Write the app entry — `native/Sources/Taskflow/App/TaskflowApp.swift`**

```swift
import SwiftUI

@main
struct TaskflowApp: App {
    var body: some Scene {
        WindowGroup("Taskflow") {
            ContentView()
                .frame(minWidth: 900, minHeight: 600)
        }
        .windowStyle(.titleBar)
    }
}

struct ContentView: View {
    var body: some View {
        Text("Taskflow (native) — foundations")
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
```

> Lifecycle carry-forward from Phase 1: SwiftUI owns the lifecycle via `@main` + `App`. Do **not** call `NSApplication.shared` before `App.main()` — that broke `NSHostingView` autoresizing in the slice. Set activation policy from `init()` if/when needed, never imperatively before the app starts.

- [ ] **Step 4: Build**

Run: `cd native && swift build`
Expected: `Build complete!` (first run resolves the 3 pinned packages; no version-resolution errors).

- [ ] **Step 5: Launch and verify the window**

Run: `cd native && swift build && ./.build/debug/Taskflow &` then capture a screenshot with `screencapture -x native/evidence/01-empty-window.png` (create `native/evidence/` first).
Expected: a titled "Taskflow" window appears showing the foundations placeholder, correctly filling the frame (content not pinned to the bottom — confirms the lifecycle gotcha is avoided). Kill the process afterward.

- [ ] **Step 6: Write `native/README.md`**

```markdown
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
```

- [ ] **Step 7: Commit**

```bash
cd native && git add Package.swift .gitignore README.md Sources Tests 2>/dev/null; \
cd .. && git add native && \
git commit -m "feat(native): scaffold SwiftPM app target (Swift 6, pinned deps, empty window)"
```
Then: `taskflow-cli log commit "scaffold native SwiftPM app" --hash $(git rev-parse HEAD)` and `taskflow-cli log file "native/Package.swift"`.

---

### Task 2: App-bundle packaging script (`.app` from the SwiftPM product)

**Files:**
- Create: `native/Info.plist`
- Create: `native/scripts/make-app-bundle.sh`
- Create: `native/scripts/build-app.sh`

**Interfaces:**
- Consumes: the `Taskflow` executable from `swift build -c release`.
- Produces: `scripts/make-app-bundle.sh <path-to-executable> <output-dir>` → `<output-dir>/Taskflow.app` (launchable, ad-hoc signed). `scripts/build-app.sh` orchestrates the full release build (extended in Task 8 to also build + stage the backend).

- [ ] **Step 1: Write `native/Info.plist` (bundle template)**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleName</key><string>Taskflow</string>
    <key>CFBundleDisplayName</key><string>Taskflow</string>
    <key>CFBundleIdentifier</key><string>com.taskflow.native</string>
    <key>CFBundleVersion</key><string>1</string>
    <key>CFBundleShortVersionString</key><string>0.1.0</string>
    <key>CFBundlePackageType</key><string>APPL</string>
    <key>CFBundleExecutable</key><string>Taskflow</string>
    <key>LSMinimumSystemVersion</key><string>13.0</string>
    <key>NSHighResolutionCapable</key><true/>
    <key>NSPrincipalClass</key><string>NSApplication</string>
</dict>
</plist>
```

- [ ] **Step 2: Write `native/scripts/make-app-bundle.sh`**

```bash
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
```

Make it executable: `chmod +x native/scripts/make-app-bundle.sh`.

- [ ] **Step 3: Write `native/scripts/build-app.sh` (orchestrator, v1)**

```bash
#!/usr/bin/env bash
# Full release build: (codegen — added in later tasks) -> swift build -c release -> bundle.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # native/
cd "$HERE"

# Codegen + theme bake are wired here in Tasks 3-6:
#   bun scripts/codegen/generate.ts
#   bun scripts/codegen/bake-themes.ts
# Backend staging is wired here in Task 8:
#   scripts/build-backend-sidecar.sh

swift build -c release
EXECUTABLE="$HERE/.build/release/Taskflow"
scripts/make-app-bundle.sh "$EXECUTABLE" "$HERE/.build/app"
echo "Done: $HERE/.build/app/Taskflow.app"
```

Make it executable: `chmod +x native/scripts/build-app.sh`.

- [ ] **Step 4: Run the bundle build**

Run: `cd native && ./scripts/build-app.sh`
Expected: ends with `Done: .../native/.build/app/Taskflow.app`.

- [ ] **Step 5: Launch the bundle and verify**

Run: `open native/.build/app/Taskflow.app` then `screencapture -x native/evidence/02-app-bundle.png`.
Expected: the same "Taskflow" window launches from the `.app` bundle (proving 2.1's "archive produces a launchable `.app`"). Quit it afterward.

- [ ] **Step 6: Commit**

```bash
git add native/Info.plist native/scripts && \
git commit -m "feat(native): package SwiftPM product into a launchable Taskflow.app"
```
Then log the commit + `native/scripts/make-app-bundle.sh` via taskflow-cli.

---

### Task 3: Codegen engine core — scaffolding + `MSG` catalog → `MessageType` enum (TDD)

**Files:**
- Create: `native/scripts/codegen/lib/swift.ts` (Swift-emit helpers)
- Create: `native/scripts/codegen/lib/messages.ts` (MSG extraction)
- Create: `native/scripts/codegen/generate.ts` (entry)
- Create: `native/scripts/codegen/generate.test.ts` (bun test)
- Create (generated): `native/Sources/Taskflow/Generated/MessageType.swift`
- Create: `native/Tests/TaskflowTests/MessageTypeTests.swift`

**Interfaces:**
- Consumes: `packages/shared/src/constants.ts` (the `MSG` const object) via the TypeScript compiler API.
- Produces:
  - `lib/swift.ts`: `swiftHeader(): string`, `pascalCase(s: string): string`, `camelCase(s: string): string`, `swiftEnum(name: string, cases: {name: string; raw: string}[]): string`.
  - `lib/messages.ts`: `extractMessageCases(sourceText: string): {name: string; raw: string}[]`.
  - Generated Swift: `enum MessageType: String, Codable, Sendable, CaseIterable { case taskList = "task:list"; ... }`.

- [ ] **Step 1: Verify `typescript` is resolvable for `bun`**

Run (from repo root): `bun -e "import ts from 'typescript'; console.log(ts.version)"`
Expected: prints a 5.x version (the TS compiler API is available via `packages/shared`'s devDependency / root). If it fails, add `typescript` as a devDependency where the script runs: `bun add -d typescript` at repo root.

- [ ] **Step 2: Write the failing test — `native/scripts/codegen/generate.test.ts`**

```ts
import { expect, test } from "bun:test";
import { extractMessageCases } from "./lib/messages";
import { swiftEnum, pascalCase, camelCase } from "./lib/swift";

const SAMPLE = `
export const MSG = {
    TASK_LIST: "task:list",
    TASK_CREATED: "task:created",
    SYSTEM_INFO: "system:info",
} as const;
`;

test("extractMessageCases reads MSG string-literal values", () => {
    const cases = extractMessageCases(SAMPLE);
    expect(cases).toEqual([
        { name: "taskList", raw: "task:list" },
        { name: "taskCreated", raw: "task:created" },
        { name: "systemInfo", raw: "system:info" },
    ]);
});

test("camelCase maps a colon/snake wire type to a Swift case name", () => {
    expect(camelCase("task:list")).toBe("taskList");
    expect(pascalCase("flow-run-updated")).toBe("FlowRunUpdated");
});

test("swiftEnum renders a String-backed enum", () => {
    const out = swiftEnum("MessageType", [{ name: "taskList", raw: "task:list" }]);
    expect(out).toContain("enum MessageType: String, Codable, Sendable, CaseIterable {");
    expect(out).toContain(`case taskList = "task:list"`);
});
```

- [ ] **Step 3: Run the test — verify it fails**

Run: `cd native/scripts/codegen && bun test`
Expected: FAIL — `Cannot find module './lib/messages'` (and `./lib/swift`).

- [ ] **Step 4: Implement `native/scripts/codegen/lib/swift.ts`**

```ts
export function swiftHeader(): string {
    return [
        "// Generated by native/scripts/codegen — DO NOT EDIT BY HAND.",
        "// Source of truth: packages/shared. Regenerate via `bun native/scripts/codegen/generate.ts`.",
        "",
    ].join("\n");
}

export function pascalCase(s: string): string {
    return s
        .split(/[:_\-\s]+/)
        .filter(Boolean)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join("");
}

export function camelCase(s: string): string {
    const p = pascalCase(s);
    return p.charAt(0).toLowerCase() + p.slice(1);
}

export function swiftEnum(name: string, cases: { name: string; raw: string }[]): string {
    const lines = cases.map((c) => `    case ${c.name} = "${c.raw}"`);
    return [
        `enum ${name}: String, Codable, Sendable, CaseIterable {`,
        ...lines,
        "}",
        "",
    ].join("\n");
}
```

- [ ] **Step 5: Implement `native/scripts/codegen/lib/messages.ts`**

```ts
import ts from "typescript";
import { camelCase } from "./swift";

// Walk a TS source for `export const MSG = { KEY: "wire:type", ... } as const`
// and return Swift case descriptors keyed by the wire string (deduped, first-wins).
export function extractMessageCases(sourceText: string): { name: string; raw: string }[] {
    const sf = ts.createSourceFile("constants.ts", sourceText, ts.ScriptTarget.Latest, true);
    const cases: { name: string; raw: string }[] = [];
    const seen = new Set<string>();

    const visit = (node: ts.Node): void => {
        if (
            ts.isVariableDeclaration(node) &&
            ts.isIdentifier(node.name) &&
            node.name.text === "MSG" &&
            node.initializer
        ) {
            const init = ts.isAsExpression(node.initializer)
                ? node.initializer.expression
                : node.initializer;
            if (ts.isObjectLiteralExpression(init)) {
                for (const prop of init.properties) {
                    if (
                        ts.isPropertyAssignment(prop) &&
                        ts.isStringLiteral(prop.initializer)
                    ) {
                        const raw = prop.initializer.text;
                        if (seen.has(raw)) continue;
                        seen.add(raw);
                        cases.push({ name: camelCase(raw), raw });
                    }
                }
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(sf);
    return cases;
}
```

> Cases are derived from the **wire string** (e.g. `"task:list"` → `taskList`), not the JS key, so the Swift name always matches what travels on the socket.

- [ ] **Step 6: Run the test — verify it passes**

Run: `cd native/scripts/codegen && bun test`
Expected: PASS (3 tests).

- [ ] **Step 7: Implement `native/scripts/codegen/generate.ts` (entry, v1)**

```ts
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { extractMessageCases } from "./lib/messages";
import { swiftHeader, swiftEnum } from "./lib/swift";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SHARED = join(REPO_ROOT, "packages", "shared", "src");
const OUT = join(REPO_ROOT, "native", "Sources", "Taskflow", "Generated");

function emit(relPath: string, body: string): void {
    const full = join(OUT, relPath);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, swiftHeader() + body);
    console.log(`emitted ${relPath}`);
}

// MessageType enum from MSG.
const constants = readFileSync(join(SHARED, "constants.ts"), "utf8");
emit("MessageType.swift", swiftEnum("MessageType", extractMessageCases(constants)));

// Model emission is added in Tasks 4-5.
```

- [ ] **Step 8: Run codegen and verify the generated enum**

Run (from repo root): `bun native/scripts/codegen/generate.ts`
Expected: `emitted MessageType.swift`. Inspect `native/Sources/Taskflow/Generated/MessageType.swift` — contains `case taskList = "task:list"`, `case taskCreated = "task:created"`, `case systemInfo = "system:info"`, etc. (~80 cases).

- [ ] **Step 9: Write a Swift compile-guard test — `native/Tests/TaskflowTests/MessageTypeTests.swift`**

```swift
import XCTest
@testable import Taskflow

final class MessageTypeTests: XCTestCase {
    func testKnownWireValues() {
        XCTAssertEqual(MessageType.taskList.rawValue, "task:list")
        XCTAssertEqual(MessageType.taskCreated.rawValue, "task:created")
        XCTAssertEqual(MessageType.systemInfo.rawValue, "system:info")
    }

    func testRoundTripFromRaw() {
        XCTAssertEqual(MessageType(rawValue: "task:updated"), .taskUpdated)
    }
}
```

- [ ] **Step 10: Build + run the Swift test (proves generated Swift compiles)**

Run: `cd native && swift test --filter MessageTypeTests`
Expected: PASS. (This is the "generated Swift compiles" half of unit 2.3's verify.)

- [ ] **Step 11: Wire codegen into the build orchestrator**

In `native/scripts/build-app.sh`, replace the codegen comment with a real call before `swift build`:
```bash
( cd "$HERE/.." && bun native/scripts/codegen/generate.ts )
```

- [ ] **Step 12: Commit**

```bash
git add native/scripts/codegen native/Sources/Taskflow/Generated/MessageType.swift \
        native/Tests/TaskflowTests/MessageTypeTests.swift native/scripts/build-app.sh && \
git commit -m "feat(native): codegen MessageType enum from shared MSG catalog"
```
Then log the commit + `native/scripts/codegen/generate.ts` via taskflow-cli.

---

### Task 4: Codegen — interfaces, enums, optionals → Codable structs (TDD)

**Files:**
- Create: `native/scripts/codegen/lib/types.ts` (TS-type → Swift-type mapping)
- Modify: `native/scripts/codegen/generate.ts` (emit model files)
- Modify: `native/scripts/codegen/generate.test.ts` (add type-transform tests)
- Create (generated): `native/Sources/Taskflow/Generated/Models/*.swift`
- Create: `native/Tests/TaskflowTests/ModelDecodeTests.swift`

**Interfaces:**
- Consumes: `lib/swift.ts` helpers; the TS compiler API; shared type files.
- Produces:
  - `lib/types.ts`: `swiftType(node: ts.TypeNode, ctx: EmitCtx): string`, `renderInterface(decl: ts.InterfaceDeclaration, ctx): string`, `renderStringUnionAlias(decl: ts.TypeAliasDeclaration, ctx): string | null`.
  - `EmitCtx` (exported interface): `{ checker: ts.TypeChecker; enumNames: Set<string> }`.
  - Generated structs: `struct Task: Codable, Sendable, Equatable { let id: String; let parentId: String?; let sessions: [SessionRef]; ... }` and string-union enums e.g. `enum SessionStatus: String, Codable, Sendable { case working = "working"; ... }`.

- [ ] **Step 1: Write failing transform tests (append to `generate.test.ts`)**

```ts
import { mapPrimitive } from "./lib/types";

test("mapPrimitive maps TS scalars and containers to Swift", () => {
    expect(mapPrimitive("string")).toBe("String");
    expect(mapPrimitive("number")).toBe("Double");
    expect(mapPrimitive("boolean")).toBe("Bool");
});
```

(The full interface/union rendering is asserted via the Swift decode test in Step 8; `mapPrimitive` is the unit-testable seam for the scalar mapping rule.)

- [ ] **Step 2: Run — verify it fails**

Run: `cd native/scripts/codegen && bun test`
Expected: FAIL — `Cannot find module './lib/types'`.

- [ ] **Step 3: Implement `native/scripts/codegen/lib/types.ts`**

```ts
import ts from "typescript";
import { pascalCase, camelCase } from "./swift";

export interface EmitCtx {
    enumNames: Set<string>; // names known to be string-union enums (value types, no `?` quirks)
}

export function mapPrimitive(name: string): string | null {
    switch (name) {
        case "string": return "String";
        case "number": return "Double";
        case "boolean": return "Bool";
        case "null": return "Optional"; // handled by caller as nullability
        case "unknown":
        case "any": return "AnyCodable";
        default: return null;
    }
}

// Render a TS type node to a Swift type string. Optionality (`?`) is decided by the
// property (Task 4 reads `questionToken` and `| null`/`| undefined` unions).
export function swiftType(node: ts.TypeNode, ctx: EmitCtx): string {
    if (ts.isArrayTypeNode(node)) return `[${swiftType(node.elementType, ctx)}]`;
    if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
        const ref = node.typeName.text;
        if (ref === "Array" && node.typeArguments?.length === 1) {
            return `[${swiftType(node.typeArguments[0], ctx)}]`;
        }
        if (ref === "Record" && node.typeArguments?.length === 2) {
            return `[String: ${swiftType(node.typeArguments[1], ctx)}]`;
        }
        if (ref === "Partial" && node.typeArguments?.length === 1) {
            return swiftType(node.typeArguments[0], ctx); // fields become optional at use site
        }
        return ref; // a named interface/enum -> same Swift name
    }
    if (node.kind === ts.SyntaxKind.StringKeyword) return "String";
    if (node.kind === ts.SyntaxKind.NumberKeyword) return "Double";
    if (node.kind === ts.SyntaxKind.BooleanKeyword) return "Bool";
    if (ts.isLiteralTypeNode(node) && ts.isStringLiteral(node.literal)) return "String";
    if (ts.isUnionTypeNode(node)) {
        // Pure string-literal union inlined at a property -> emit a nested enum later;
        // for Task 4 the named string-union aliases are handled by renderStringUnionAlias.
        const nonNull = node.types.filter(
            (t) => t.kind !== ts.SyntaxKind.NullKeyword && t.kind !== ts.SyntaxKind.UndefinedKeyword,
        );
        if (nonNull.length === 1) return swiftType(nonNull[0], ctx);
        if (nonNull.every((t) => ts.isLiteralTypeNode(t) && ts.isStringLiteral(t.literal))) {
            return "String"; // inline literal union: keep as String (Task 5 promotes named ones)
        }
    }
    return "AnyCodable";
}

// `export type Foo = "a" | "b" | "c";` -> a Swift String enum. Returns null if not a string union.
export function renderStringUnionAlias(
    decl: ts.TypeAliasDeclaration,
): string | null {
    const t = decl.type;
    if (!ts.isUnionTypeNode(t)) return null;
    const literals = t.types.filter((x) => ts.isLiteralTypeNode(x) && ts.isStringLiteral(x.literal));
    if (literals.length !== t.types.length || literals.length === 0) return null;
    const name = decl.name.text;
    const cases = literals.map((x) => {
        const raw = ((x as ts.LiteralTypeNode).literal as ts.StringLiteral).text;
        return `    case ${camelCase(raw)} = "${raw}"`;
    });
    return [`enum ${name}: String, Codable, Sendable {`, ...cases, "}", ""].join("\n");
}

// `export interface Foo { a: string; b?: number; c: Bar[] }` -> a Swift Codable struct.
export function renderInterface(decl: ts.InterfaceDeclaration, ctx: EmitCtx): string {
    const name = decl.name.text;
    const fields: string[] = [];
    for (const member of decl.members) {
        if (!ts.isPropertySignature(member) || !member.type || !member.name) continue;
        const propName = ts.isIdentifier(member.name)
            ? member.name.text
            : ts.isStringLiteral(member.name)
              ? member.name.text
              : null;
        if (propName === null) continue;
        let type = swiftType(member.type, ctx);
        const nullableUnion =
            ts.isUnionTypeNode(member.type) &&
            member.type.types.some(
                (t) => t.kind === ts.SyntaxKind.NullKeyword || t.kind === ts.SyntaxKind.UndefinedKeyword,
            );
        const optional = member.questionToken !== undefined || nullableUnion;
        if (optional) type += "?";
        fields.push(`    let ${propName}: ${type}`);
    }
    return [
        `struct ${name}: Codable, Sendable, Equatable {`,
        ...fields,
        "}",
        "",
    ].join("\n");
}
```

> `AnyCodable` is a small hand-written escape hatch (Task 4 Step 6) for genuinely dynamic fields (e.g. `payload: unknown`, `Record<string, unknown>` values). Discriminated unions (`type`-tagged + XOR) are deliberately left as `AnyCodable`/`String` here and properly promoted in Task 5.

- [ ] **Step 4: Run the transform test — verify it passes**

Run: `cd native/scripts/codegen && bun test`
Expected: PASS (existing + `mapPrimitive`).

- [ ] **Step 5: Extend `generate.ts` to emit one Swift file per shared type file**

Add to `generate.ts` (after the MessageType emission):

```ts
import ts from "typescript";
import { readdirSync } from "node:fs";
import { renderInterface, renderStringUnionAlias, type EmitCtx } from "./lib/types";

const TYPES_DIR = join(SHARED, "types");
const ctx: EmitCtx = { enumNames: new Set() };

for (const file of readdirSync(TYPES_DIR).filter((f) => f.endsWith(".ts"))) {
    const sourceText = readFileSync(join(TYPES_DIR, file), "utf8");
    const sf = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true);
    const blocks: string[] = [];
    sf.forEachChild((node) => {
        if (ts.isTypeAliasDeclaration(node)) {
            const e = renderStringUnionAlias(node);
            if (e) {
                ctx.enumNames.add(node.name.text);
                blocks.push(e);
            }
            // Tagged/XOR union aliases are emitted in Task 5.
        } else if (ts.isInterfaceDeclaration(node)) {
            blocks.push(renderInterface(node, ctx));
        }
    });
    if (blocks.length) {
        const swiftName = pascalCase(file.replace(/\.ts$/, "")) + "Types.swift";
        emit(join("Models", swiftName), blocks.join("\n"));
    }
}
```

(Add `import { pascalCase } from "./lib/swift";` to the existing import.)

- [ ] **Step 6: Add the `AnyCodable` support type**

Create `native/Sources/Taskflow/Generated/AnyCodable.swift` (hand-written, lives in Generated for cohesion but is not overwritten by codegen — list it in a `// keep` allowlist comment in generate.ts):

```swift
// Hand-maintained support type for dynamic JSON fields. Not overwritten by codegen.
import Foundation

struct AnyCodable: Codable, Sendable, Equatable {
    let value: AnyCodableValue
    init(_ value: AnyCodableValue) { self.value = value }
    init(from decoder: Decoder) throws { value = try AnyCodableValue(from: decoder) }
    func encode(to encoder: Encoder) throws { try value.encode(to: encoder) }
}

indirect enum AnyCodableValue: Codable, Sendable, Equatable {
    case string(String), number(Double), bool(Bool)
    case array([AnyCodableValue]), object([String: AnyCodableValue]), null

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let b = try? c.decode(Bool.self) { self = .bool(b) }
        else if let d = try? c.decode(Double.self) { self = .number(d) }
        else if let s = try? c.decode(String.self) { self = .string(s) }
        else if let a = try? c.decode([AnyCodableValue].self) { self = .array(a) }
        else if let o = try? c.decode([String: AnyCodableValue].self) { self = .object(o) }
        else { self = .null }
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .null: try c.encodeNil()
        case let .bool(b): try c.encode(b)
        case let .number(n): try c.encode(n)
        case let .string(s): try c.encode(s)
        case let .array(a): try c.encode(a)
        case let .object(o): try c.encode(o)
        }
    }
}
```

- [ ] **Step 7: Regenerate and build**

Run: `bun native/scripts/codegen/generate.ts && cd native && swift build`
Expected: codegen emits `Models/TaskTypes.swift`, `Models/ProjectTypes.swift`, etc.; `swift build` succeeds (the non-union types compile). If a specific type references a not-yet-emitted union type, it will be `AnyCodable`/`String` for now — that compiles.

- [ ] **Step 8: Write the model decode test — `native/Tests/TaskflowTests/ModelDecodeTests.swift`**

```swift
import XCTest
@testable import Taskflow

final class ModelDecodeTests: XCTestCase {
    func testTaskListResponseDecodes() throws {
        // Shape matches a real `task:list` response payload.
        let json = """
        {"tasks":[{"id":"t1","projectId":"p1","title":"Demo","description":"",
        "notes":"","worktree":{"enabled":false},"sessions":[],
        "createdAt":"2026-06-27T00:00:00.000Z","status":"active",
        "archivedAt":null,"pinned":false}]}
        """.data(using: .utf8)!
        struct Resp: Codable { let tasks: [Task] }
        let resp = try JSONDecoder().decode(Resp.self, from: json)
        XCTAssertEqual(resp.tasks.count, 1)
        XCTAssertEqual(resp.tasks[0].id, "t1")
        XCTAssertEqual(resp.tasks[0].status, "active")
        XCTAssertNil(resp.tasks[0].archivedAt ?? nil)
    }

    func testSessionStatusEnumDecodes() throws {
        let v = try JSONDecoder().decode(SessionStatus.self, from: "\"working\"".data(using: .utf8)!)
        XCTAssertEqual(v, .working)
    }
}
```

> If `Task` is a name clash with Swift concurrency's `Task`, the generated type still wins inside `@testable import Taskflow` when referred to unqualified in this module's types; if ambiguity arises, the codegen can be configured to prefix domain types — note this as a carry-forward and resolve by qualifying as `Taskflow.Task` only where needed.

- [ ] **Step 9: Run the Swift decode test**

Run: `cd native && swift test --filter ModelDecodeTests`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add native/scripts/codegen native/Sources/Taskflow/Generated native/Tests/TaskflowTests/ModelDecodeTests.swift && \
git commit -m "feat(native): codegen Codable structs + string-union enums from shared types"
```
Then log the commit + `native/scripts/codegen/lib/types.ts` via taskflow-cli.

> **Carry-forward decision flagged in Step 8:** the generated `Task` shadows Swift's `Task`. Decide in review whether to (a) accept module-local shadowing (works, qualify `_Concurrency.Task` where needed) or (b) prefix domain models. Record the choice in the Task 10 results note.

---

### Task 5: Codegen — discriminated unions → Swift enums with custom Codable (TDD)

**Files:**
- Create: `native/scripts/codegen/lib/unions.ts`
- Modify: `native/scripts/codegen/generate.ts`
- Modify: `native/scripts/codegen/generate.test.ts`
- Create: `native/Tests/TaskflowTests/UnionDecodeTests.swift`

**Interfaces:**
- Consumes: `lib/types.ts`, the TS compiler API.
- Produces:
  - `lib/unions.ts`: `classifyUnion(decl: ts.TypeAliasDeclaration, ctx): UnionKind`, `renderTaggedUnion(...)`, `renderXorUnion(...)`. `UnionKind = {kind:"tagged"; ...} | {kind:"xor"; ...} | {kind:"none"}`.
  - Generated Swift: tagged unions (e.g. `AgentLaunchOptions`) as enums with associated payload structs + custom `init(from:)` switching on the discriminant; XOR unions (e.g. `FlowOwner`) as enums decoded by which key is present.

- [ ] **Step 1: Write failing union tests (append to `generate.test.ts`)**

```ts
import { classifyUnion } from "./lib/unions";
import ts from "typescript";

function alias(src: string): ts.TypeAliasDeclaration {
    const sf = ts.createSourceFile("t.ts", src, ts.ScriptTarget.Latest, true);
    let found: ts.TypeAliasDeclaration | undefined;
    sf.forEachChild((n) => { if (ts.isTypeAliasDeclaration(n)) found = n; });
    if (!found) throw new Error("no alias");
    return found;
}

test("classifyUnion detects a type-tagged union", () => {
    const decl = alias(`type AgentLaunchOptions = ClaudeLaunchOptions | PiLaunchOptions;`);
    const k = classifyUnion(decl, { enumNames: new Set() });
    expect(k.kind).toBe("tagged");
});

test("classifyUnion detects a key-presence XOR union", () => {
    const decl = alias(
        `type FlowOwner =
            | { taskId: string; projectId?: never; master?: never }
            | { projectId: string; taskId?: never; master?: never }
            | { master: true; taskId?: never; projectId?: never };`,
    );
    const k = classifyUnion(decl, { enumNames: new Set() });
    expect(k.kind).toBe("xor");
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `cd native/scripts/codegen && bun test`
Expected: FAIL — `Cannot find module './lib/unions'`.

- [ ] **Step 3: Implement `native/scripts/codegen/lib/unions.ts`**

```ts
import ts from "typescript";
import type { EmitCtx } from "./types";
import { camelCase, pascalCase } from "./swift";

export type UnionKind =
    | { kind: "tagged"; members: string[] } // member type-reference names, each has a `type` discriminant
    | { kind: "xor"; variants: { key: string; type: string }[] } // anonymous object members keyed by presence
    | { kind: "none" };

export function classifyUnion(decl: ts.TypeAliasDeclaration, _ctx: EmitCtx): UnionKind {
    const t = decl.type;
    if (!ts.isUnionTypeNode(t)) return { kind: "none" };

    // Tagged: every member is a TypeReference to a named interface (assumed to carry a `type` field).
    if (t.types.every((m) => ts.isTypeReferenceNode(m) && ts.isIdentifier(m.typeName))) {
        const members = t.types.map((m) => ((m as ts.TypeReferenceNode).typeName as ts.Identifier).text);
        return { kind: "tagged", members };
    }

    // XOR: every member is an anonymous object literal; the "present" key is the one whose
    // sibling fields are all `?: never`. Take the first non-never required key as the discriminant.
    if (t.types.every((m) => ts.isTypeLiteralNode(m))) {
        const variants: { key: string; type: string }[] = [];
        for (const m of t.types as ts.TypeLiteralNode[]) {
            const present = m.members.find((mem) => {
                if (!ts.isPropertySignature(mem) || !mem.type) return false;
                const isNever = mem.type.kind === ts.SyntaxKind.NeverKeyword;
                return !isNever && mem.questionToken === undefined;
            }) as ts.PropertySignature | undefined;
            if (!present || !present.name || !ts.isIdentifier(present.name)) return { kind: "none" };
            const key = present.name.text;
            const type =
                present.type && present.type.kind === ts.SyntaxKind.StringKeyword ? "String" : "Bool";
            variants.push({ key, type });
        }
        return { kind: "xor", variants };
    }
    return { kind: "none" };
}

// Tagged union -> Swift enum with associated values + custom Decodable switching on `type`.
// Assumes each member interface has a string `type` discriminant whose value is the wire tag.
// `tagValues` maps member interface name -> its discriminant wire string (resolved by the caller
// from each member interface's `type` literal; passed in to keep this function pure).
export function renderTaggedUnion(
    name: string,
    members: { interfaceName: string; tag: string }[],
): string {
    const cases = members.map((m) => `    case ${camelCase(m.tag)}(${m.interfaceName})`);
    const decodeCases = members
        .map(
            (m) =>
                `        case "${m.tag}": self = .${camelCase(m.tag)}(try ${m.interfaceName}(from: decoder))`,
        )
        .join("\n");
    const encodeCases = members
        .map((m) => `        case let .${camelCase(m.tag)}(v): try v.encode(to: encoder)`)
        .join("\n");
    return [
        `enum ${name}: Codable, Sendable, Equatable {`,
        ...cases,
        "",
        "    private enum DiscriminantKeys: String, CodingKey { case type }",
        "    init(from decoder: Decoder) throws {",
        "        let c = try decoder.container(keyedBy: DiscriminantKeys.self)",
        "        let tag = try c.decode(String.self, forKey: .type)",
        "        switch tag {",
        decodeCases,
        `        default: throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "unknown ${name} tag \\(tag)"))`,
        "        }",
        "    }",
        "    func encode(to encoder: Encoder) throws {",
        "        switch self {",
        encodeCases,
        "        }",
        "    }",
        "}",
        "",
    ].join("\n");
}

// XOR union -> Swift enum decoded by which key is present.
export function renderXorUnion(name: string, variants: { key: string; type: string }[]): string {
    const cases = variants.map((v) => `    case ${v.key}(${v.type})`);
    const keys = variants.map((v) => `        case ${v.key}`).join("\n");
    const decode = variants
        .map(
            (v) =>
                `        if let v = try c.decodeIfPresent(${v.type}.self, forKey: .${v.key}) { self = .${v.key}(v); return }`,
        )
        .join("\n");
    const encode = variants
        .map((v) => `        case let .${v.key}(v): try c.encode(v, forKey: .${v.key})`)
        .join("\n");
    return [
        `enum ${name}: Codable, Sendable, Equatable {`,
        ...cases,
        "",
        "    private enum CodingKeys: String, CodingKey {",
        keys,
        "    }",
        "    init(from decoder: Decoder) throws {",
        "        let c = try decoder.container(keyedBy: CodingKeys.self)",
        decode,
        `        throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "no known ${name} key present"))`,
        "    }",
        "    func encode(to encoder: Encoder) throws {",
        "        var c = encoder.container(keyedBy: CodingKeys.self)",
        "        switch self {",
        encode,
        "        }",
        "    }",
        "}",
        "",
    ].join("\n");
}
```

> The tagged-union renderer needs each member interface's `type` wire tag. In `generate.ts`, when emitting a type file, first index every interface's `type` property literal (e.g. `ClaudeLaunchOptions.type` resolves through `Extract<AgentType,"claude">` to `"claude"`). Where the discriminant is an `Extract<...>` rather than a bare literal, fall back to `camelCase(interfaceName)`-derived tag **and** record it in the carry-forward log for manual confirmation against `agent.ts`.

- [ ] **Step 4: Run union tests — verify they pass**

Run: `cd native/scripts/codegen && bun test`
Expected: PASS.

- [ ] **Step 5: Wire unions into `generate.ts`**

In the per-file loop, before/after interface emission, classify each `TypeAliasDeclaration`; for `tagged`/`xor` kinds, resolve member tags (as above) and emit via `renderTaggedUnion`/`renderXorUnion` instead of leaving `AnyCodable`. Ensure a union type referenced by an earlier-emitted struct now resolves to the real enum name (it already does — `swiftType` returns the reference name; the enum now exists).

- [ ] **Step 6: Regenerate the full surface and build**

Run: `bun native/scripts/codegen/generate.ts && cd native && swift build`
Expected: all 13 type files' Swift compiles, including `AgentLaunchOptions`, `FlowActionEntry`, `FlowOwner`. Fix any compile error by tightening the corresponding renderer (note the failing type, adjust, regenerate).

- [ ] **Step 7: Write the union decode test — `native/Tests/TaskflowTests/UnionDecodeTests.swift`**

```swift
import XCTest
@testable import Taskflow

final class UnionDecodeTests: XCTestCase {
    func testTaggedAgentOptionsDecodesByType() throws {
        let json = #"{"type":"claude","model":"opus","effort":"high"}"#.data(using: .utf8)!
        let opts = try JSONDecoder().decode(AgentLaunchOptions.self, from: json)
        if case let .claude(c) = opts {
            XCTAssertEqual(c.model, "opus")
        } else {
            XCTFail("expected .claude case, got \(opts)")
        }
    }

    func testXorOwnerDecodesByPresentKey() throws {
        let json = #"{"projectId":"p1"}"#.data(using: .utf8)!
        let owner = try JSONDecoder().decode(FlowOwner.self, from: json)
        if case let .projectId(id) = owner {
            XCTAssertEqual(id, "p1")
        } else {
            XCTFail("expected .projectId case, got \(owner)")
        }
    }
}
```

> Case names (`.claude`, `.projectId`) must match what the renderer emits. If the agent-options tag resolves via `camelCase(tag)`, `.claude` is correct; adjust the test to the actual emitted case name if the discriminant resolution differs, and log the discrepancy.

- [ ] **Step 8: Run the union decode test**

Run: `cd native && swift test --filter UnionDecodeTests`
Expected: PASS. (Completes "generated Swift compiles" + decode behavior for the hardest types — unit 2.3's type half is done.)

- [ ] **Step 9: Commit**

```bash
git add native/scripts/codegen native/Sources/Taskflow/Generated native/Tests/TaskflowTests/UnionDecodeTests.swift && \
git commit -m "feat(native): codegen discriminated unions (tagged + XOR) with custom Codable"
```
Then log the commit + `native/scripts/codegen/lib/unions.ts` via taskflow-cli.

---

### Task 6: Theme bake + `AppTheme` + libghostty config mapping (TDD)

**Files:**
- Create: `native/scripts/codegen/bake-themes.ts`
- Create (generated): `native/Sources/Taskflow/Resources/themes/*.json` (14 files)
- Create: `native/Sources/Taskflow/Theme/ResolvedThemeFile.swift`
- Create: `native/Sources/Taskflow/Theme/AppTheme.swift`
- Create: `native/Sources/Taskflow/Theme/ThemeStore.swift`
- Create: `native/Sources/Taskflow/Theme/GhosttyThemeConfig.swift`
- Create: `native/Tests/TaskflowTests/ThemeTests.swift`

**Interfaces:**
- Consumes: `@taskflow/shared`'s `bundledThemes` + `deriveTheme` (run in `bun`); the generated `MessageType`/models are not needed here.
- Produces:
  - Baked JSON shape per theme: `{ "id": string, "name": string, "css": { "--background": "#..", ...43 }, "xterm": { "background": "#..", ...21 } }`.
  - `ResolvedThemeFile: Decodable, Sendable` mirroring that shape.
  - `struct AppTheme: Equatable, Sendable` with `init(_ file: ResolvedThemeFile)`, `func color(_ token: ThemeToken) -> Color`, and convenience props (`background`, `foreground`, `primary`, `accent`, `border`, `muted`, `destructive`, `success`, `warning`).
  - `enum ThemeToken: String` (the 43 css var names).
  - `@MainActor final class ThemeStore: ObservableObject` with `@Published var current: AppTheme`, `let all: [AppTheme]`, `func select(id: String)`.
  - `enum GhosttyThemeConfig { static func pairs(from file: ResolvedThemeFile) -> [(String, String)] }` producing libghostty config keys (`background`, `foreground`, `cursor-color`, `selection-background`, `palette` × 16).

- [ ] **Step 1: Write `native/scripts/codegen/bake-themes.ts`**

```ts
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { bundledThemes, deriveTheme } from "@taskflow/shared";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const OUT = join(REPO_ROOT, "native", "Sources", "Taskflow", "Resources", "themes");
mkdirSync(OUT, { recursive: true });

for (const record of bundledThemes) {
    const resolved = deriveTheme(record.source);
    const baked = {
        id: record.id,
        name: record.source.name,
        css: resolved.css,
        xterm: resolved.xterm,
    };
    writeFileSync(join(OUT, `${record.id}.json`), JSON.stringify(baked, null, 2) + "\n");
    console.log(`baked ${record.id}.json`);
}
```

> This runs the real `deriveTheme` (43 CSS vars + the 21-field xterm map incl. all ANSI colors) at build time, so Swift never re-implements the color math (D3: "load bundled theme JSON").

- [ ] **Step 2: Run the bake and verify output**

Run (from repo root): `bun native/scripts/codegen/bake-themes.ts`
Expected: `baked ayu.json` … 14 lines. Inspect `native/Sources/Taskflow/Resources/themes/catppuccin-mocha.json` — has `id`, `name`, `css` (43 keys incl. `--background`), `xterm` (incl. `black`…`brightWhite`).

- [ ] **Step 3: Write the failing Swift theme test — `native/Tests/TaskflowTests/ThemeTests.swift`**

```swift
import XCTest
import SwiftUI
@testable import Taskflow

final class ThemeTests: XCTestCase {
    func testThemeStoreLoadsBundledThemes() {
        let store = ThemeStore()
        XCTAssertEqual(store.all.count, 14)
        XCTAssertTrue(store.all.contains { $0.id == "catppuccin-mocha" })
    }

    func testAppThemeExposesCssTokens() throws {
        let store = ThemeStore()
        store.select(id: "dracula")
        // Dracula background per its bundled colors.
        XCTAssertEqual(store.current.hex(.background).lowercased(), "#282a36")
    }

    func testGhosttyPairsIncludePalette() throws {
        let file = try ThemeStore.loadFile(id: "dracula")
        let pairs = GhosttyThemeConfig.pairs(from: file)
        XCTAssertTrue(pairs.contains { $0.0 == "background" })
        XCTAssertTrue(pairs.contains { $0.0 == "palette" && $0.1.hasPrefix("0=") })
        XCTAssertEqual(pairs.filter { $0.0 == "palette" }.count, 16)
    }
}
```

- [ ] **Step 4: Run — verify it fails**

Run: `cd native && swift test --filter ThemeTests`
Expected: FAIL (types not defined).

- [ ] **Step 5: Implement `ResolvedThemeFile.swift`**

```swift
import Foundation

struct XtermColors: Decodable, Sendable, Equatable {
    let background, foreground, cursor, cursorAccent, selectionBackground: String
    let black, red, green, yellow, blue, magenta, cyan, white: String
    let brightBlack, brightRed, brightGreen, brightYellow: String
    let brightBlue, brightMagenta, brightCyan, brightWhite: String
}

struct ResolvedThemeFile: Decodable, Sendable, Equatable {
    let id: String
    let name: String
    let css: [String: String]   // 43 CSS-var name -> hex
    let xterm: XtermColors
}
```

- [ ] **Step 6: Implement `AppTheme.swift`**

```swift
import SwiftUI

enum ThemeToken: String {
    case background = "--background"
    case foreground = "--foreground"
    case primary = "--primary"
    case primaryForeground = "--primary-foreground"
    case accent = "--accent"
    case accentForeground = "--accent-foreground"
    case muted = "--muted"
    case mutedForeground = "--muted-foreground"
    case border = "--border"
    case destructive = "--destructive"
    case success = "--success"
    case warning = "--warning"
    case secondary = "--secondary"
    case card = "--card"
    case sidebarBackground = "--sidebar-background"
    // (remaining 28 tokens elided here for brevity; include all 43 in the real file)
}

struct AppTheme: Equatable, Sendable, Identifiable {
    let id: String
    let name: String
    private let css: [String: String]

    init(_ file: ResolvedThemeFile) {
        id = file.id
        name = file.name
        css = file.css
    }

    func hex(_ token: ThemeToken) -> String { css[token.rawValue] ?? "#000000" }
    func color(_ token: ThemeToken) -> Color { Color(hex: hex(token)) }

    var background: Color { color(.background) }
    var foreground: Color { color(.foreground) }
    var primary: Color { color(.primary) }
    var accent: Color { color(.accent) }
    var border: Color { color(.border) }
    var muted: Color { color(.muted) }
    var destructive: Color { color(.destructive) }
}

extension Color {
    init(hex: String) {
        let h = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
        var v: UInt64 = 0
        Scanner(string: h).scanHexInt64(&v)
        let r, g, b, a: Double
        if h.count == 8 {
            r = Double((v >> 24) & 0xFF) / 255
            g = Double((v >> 16) & 0xFF) / 255
            b = Double((v >> 8) & 0xFF) / 255
            a = Double(v & 0xFF) / 255
        } else {
            r = Double((v >> 16) & 0xFF) / 255
            g = Double((v >> 8) & 0xFF) / 255
            b = Double(v & 0xFF) / 255
            a = 1
        }
        self.init(.sRGB, red: r, green: g, blue: b, opacity: a)
    }
}
```

> Include **all 43** tokens in `ThemeToken` in the real file (copy the names verbatim from `CssVariables` in `packages/shared/src/types/theme.ts`). Some derived vars (`--island-base`) are `rgba(...)` not hex — `Color(hex:)` must tolerate non-hex by falling back; add an `rgba(...)` parse branch or store those as-is and only expose them where needed. Note any unparsed format in the carry-forward log.

- [ ] **Step 7: Implement `ThemeStore.swift`**

```swift
import SwiftUI

@MainActor
final class ThemeStore: ObservableObject {
    @Published private(set) var current: AppTheme
    let all: [AppTheme]

    init(defaultId: String = "catppuccin-mocha") {
        let files = ThemeStore.loadAllFiles()
        let themes = files.map(AppTheme.init).sorted { $0.id < $1.id }
        all = themes
        current = themes.first { $0.id == defaultId } ?? themes[0]
    }

    func select(id: String) {
        if let t = all.first(where: { $0.id == id }) { current = t }
    }

    static func loadAllFiles() -> [ResolvedThemeFile] {
        guard let urls = Bundle.module.urls(forResourcesWithExtension: "json", subdirectory: "themes")
        else { return [] }
        let dec = JSONDecoder()
        return urls.compactMap { try? dec.decode(ResolvedThemeFile.self, from: Data(contentsOf: $0)) }
    }

    static func loadFile(id: String) throws -> ResolvedThemeFile {
        guard let url = Bundle.module.url(forResource: id, withExtension: "json", subdirectory: "themes")
        else { throw CocoaError(.fileNoSuchFile) }
        return try JSONDecoder().decode(ResolvedThemeFile.self, from: Data(contentsOf: url))
    }
}
```

> `Bundle.module` requires the `resources: [.copy("Resources/themes")]` declared in Task 1. After bundling (Task 2), the resource bundle ships inside `Taskflow.app/Contents/MacOS/` (the `make-app-bundle.sh` `*.bundle` copy).

- [ ] **Step 8: Implement `GhosttyThemeConfig.swift`**

```swift
import Foundation

// Maps a resolved theme's terminal colors to libghostty config key/value pairs.
// Wired into the terminal surface in Phase 4; unit-tested here as a pure mapping.
enum GhosttyThemeConfig {
    static func pairs(from file: ResolvedThemeFile) -> [(String, String)] {
        let x = file.xterm
        var out: [(String, String)] = [
            ("background", x.background),
            ("foreground", x.foreground),
            ("cursor-color", x.cursor),
            ("selection-background", x.selectionBackground),
        ]
        let palette = [
            x.black, x.red, x.green, x.yellow, x.blue, x.magenta, x.cyan, x.white,
            x.brightBlack, x.brightRed, x.brightGreen, x.brightYellow,
            x.brightBlue, x.brightMagenta, x.brightCyan, x.brightWhite,
        ]
        for (i, hex) in palette.enumerated() {
            out.append(("palette", "\(i)=\(hex)"))
        }
        return out
    }
}
```

- [ ] **Step 9: Run the theme test**

Run: `cd native && swift test --filter ThemeTests`
Expected: PASS (3 tests). Completes unit 2.3's theme half (themes round-trip to `AppTheme`; ANSI feeds libghostty config).

- [ ] **Step 10: Wire theme-bake into the build orchestrator**

In `native/scripts/build-app.sh`, after the `generate.ts` call, add:
```bash
( cd "$HERE/.." && bun native/scripts/codegen/bake-themes.ts )
```

- [ ] **Step 11: Commit**

```bash
git add native/scripts/codegen/bake-themes.ts native/Sources/Taskflow/Theme \
        native/Sources/Taskflow/Resources/themes native/Tests/TaskflowTests/ThemeTests.swift \
        native/scripts/build-app.sh && \
git commit -m "feat(native): bake derived themes; AppTheme + libghostty color mapping"
```
Then log the commit + `native/Sources/Taskflow/Theme/ThemeStore.swift` via taskflow-cli.

---

### Task 7: Production WS client (TDD)

**Files:**
- Create: `native/Sources/Taskflow/Transport/WSCodec.swift` (ported)
- Create: `native/Sources/Taskflow/Transport/WSClient.swift` (productionized)
- Create: `native/Tests/TaskflowTests/WSCodecTests.swift`
- Create: `native/Tests/TaskflowTests/WSClientTests.swift`

**Interfaces:**
- Consumes: generated `MessageType`.
- Produces:
  - `enum WSInbound: Equatable { case response(correlationId: String, type: String, payload: Data); case event(type: String, payload: Data) }`.
  - `enum WSCodec { static func encodeRequest(type: String, correlationId: String, payload: [String: Any]) -> String?; static func decode(_ text: String) -> WSInbound? }`.
  - `@MainActor final class WSClient`:
    - `init(url: URL)`
    - `func connect()`, `func disconnect()`
    - `func requestRaw(_ type: MessageType, payload: [String: Any]) async throws -> Data`
    - `func request<Res: Decodable>(_ type: MessageType, payload: [String: Any]) async throws -> Res`
    - `@discardableResult func on<E: Decodable>(_ type: MessageType, _ handler: @escaping (E) -> Void) -> () -> Void`
    - `func send(_ type: MessageType, payload: [String: Any])`
    - test seam: `func handleInbound(_ inbound: WSInbound)`, `func awaitNextCorrelation(_ trigger: @escaping @MainActor (String) -> Void) async throws -> Data`.

- [ ] **Step 1: Port `WSCodec.swift` verbatim from the slice**

Copy `experiments/native-slice/Sources/NativeSlice/Transport/WSCodec.swift` to `native/Sources/Taskflow/Transport/WSCodec.swift` unchanged (it already compiles under Swift 6; `[String: Any]` JSON is fine).

- [ ] **Step 2: Write `WSCodecTests.swift` (port from slice)**

```swift
import XCTest
@testable import Taskflow

final class WSCodecTests: XCTestCase {
    func testDecodeResponseVsEvent() {
        let resp = WSCodec.decode(#"{"correlationId":"c1","type":"task:list","payload":{"tasks":[]}}"#)
        XCTAssertEqual(resp, .response(correlationId: "c1", type: "task:list",
                                       payload: #"{"tasks":[]}"#.data(using: .utf8)!))
        let ev = WSCodec.decode(#"{"type":"task:created","payload":{"task":{}}}"#)
        if case let .event(type, _) = ev { XCTAssertEqual(type, "task:created") }
        else { XCTFail("expected event") }
    }

    func testEncodeRequestRoundTrips() {
        let text = WSCodec.encodeRequest(type: "task:list", correlationId: "c1", payload: [:])!
        let obj = try! JSONSerialization.jsonObject(with: text.data(using: .utf8)!) as! [String: Any]
        XCTAssertEqual(obj["type"] as? String, "task:list")
        XCTAssertEqual(obj["correlationId"] as? String, "c1")
    }
}
```

> The `.response` payload comparison depends on `JSONSerialization` key ordering being stable for `{"tasks":[]}`; if it flakes, compare decoded `[String: Any]` instead of raw `Data`.

- [ ] **Step 3: Run codec tests**

Run: `cd native && swift test --filter WSCodecTests`
Expected: PASS.

- [ ] **Step 4: Write `WSClientTests.swift` — port the slice's 3 tests + add the 2 production fixes**

```swift
import XCTest
@testable import Taskflow

@MainActor
final class WSClientTests: XCTestCase {
    func testRequestResolvesOnMatchingResponse() async throws {
        let client = WSClient(url: URL(string: "ws://localhost:1")!)
        let payload = try await client.awaitNextCorrelation { id in
            client.handleInbound(.response(correlationId: id, type: "task:list",
                                           payload: #"{"tasks":[]}"#.data(using: .utf8)!))
        }
        XCTAssertEqual(String(data: payload, encoding: .utf8), #"{"tasks":[]}"#)
    }

    func testEventFanOutAndUnsubscribe() {
        let client = WSClient(url: URL(string: "ws://localhost:1")!)
        var hits = 0
        let off = client.on(MessageType.taskCreated) { (_: AnyCodable) in hits += 1 }
        client.handleInbound(.event(type: "task:created", payload: #"{}"#.data(using: .utf8)!))
        off()
        client.handleInbound(.event(type: "task:created", payload: #"{}"#.data(using: .utf8)!))
        XCTAssertEqual(hits, 1)
    }

    func testUnmatchedResponseIsIgnored() {
        let client = WSClient(url: URL(string: "ws://localhost:1")!)
        client.handleInbound(.response(correlationId: "nope", type: "x",
                                       payload: Data())) // must not crash
    }

    // Production fix 1: a resolved request cancels its timeout (no late spurious failure).
    func testResolvedRequestDoesNotTimeOut() async throws {
        let client = WSClient(url: URL(string: "ws://localhost:1")!)
        let data = try await client.awaitNextCorrelation { id in
            client.handleInbound(.response(correlationId: id, type: "x",
                                           payload: #"{"ok":true}"#.data(using: .utf8)!))
        }
        // If the timeout weren't cancelled, a second resume would crash the continuation.
        try await SleepHelper.millis(50)
        XCTAssertFalse(data.isEmpty)
    }

    // Production fix 2: pending requests fail fast when the socket drops.
    func testSocketDropFailsPending() async {
        let client = WSClient(url: URL(string: "ws://localhost:1")!)
        do {
            _ = try await client.awaitNextCorrelation { _ in client.failAllPending(.notConnected) }
            XCTFail("expected throw")
        } catch {
            // expected
        }
    }
}

enum SleepHelper { static func millis(_ ms: UInt64) async throws { try await Task.sleep(nanoseconds: ms * 1_000_000) } }
```

- [ ] **Step 5: Run — verify it fails**

Run: `cd native && swift test --filter WSClientTests`
Expected: FAIL (`WSClient` not defined; `on(_:)` taking `MessageType`, `failAllPending`, generic handler not present).

- [ ] **Step 6: Implement `native/Sources/Taskflow/Transport/WSClient.swift`**

Start from the slice's `WSClient` and apply: `MessageType` params, generic typed `request`/`on`, a **cancellable** timeout (store the timeout `Task` per correlationId and cancel on resolve/fail), an `isDisconnecting` guard so an intentional `disconnect()` does not reconnect, and `failAllPending(_:)` invoked on socket failure.

```swift
import Foundation

@MainActor
final class WSClient: NSObject, URLSessionWebSocketDelegate {
    enum WSClientError: Error { case timeout, notConnected, badResponse }

    private let url: URL
    private var socketSession: URLSession!
    private var task: URLSessionWebSocketTask?
    private var pending: [String: CheckedContinuation<Data, Error>] = [:]
    private var timeouts: [String: Task<Void, Never>] = [:]
    private var handlers: [String: [UUID: (Data) -> Void]] = [:]
    private var reconnectAttempt = 0
    private var isDisconnecting = false

    init(url: URL) { self.url = url; super.init() }

    func connect() {
        isDisconnecting = false
        socketSession = URLSession(configuration: .default, delegate: self, delegateQueue: nil)
        let task = socketSession.webSocketTask(with: url)
        self.task = task
        task.resume()
        receiveLoop()
    }

    func disconnect() {
        isDisconnecting = true
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
        failAllPending(.notConnected)
    }

    func requestRaw(_ type: MessageType, payload: [String: Any]) async throws -> Data {
        let correlationId = UUID().uuidString
        guard let text = WSCodec.encodeRequest(type: type.rawValue, correlationId: correlationId, payload: payload)
        else { throw WSClientError.badResponse }
        return try await withCheckedThrowingContinuation { cont in
            pending[correlationId] = cont
            task?.send(.string(text)) { [weak self] error in
                if let error { Task { @MainActor in self?.fail(correlationId, error) } }
            }
            timeouts[correlationId] = Task { @MainActor [weak self] in
                try? await Task.sleep(nanoseconds: 30_000_000_000)
                if !Task.isCancelled { self?.fail(correlationId, WSClientError.timeout) }
            }
        }
    }

    func request<Res: Decodable>(_ type: MessageType, payload: [String: Any]) async throws -> Res {
        let data = try await requestRaw(type, payload: payload)
        return try JSONDecoder().decode(Res.self, from: data)
    }

    func send(_ type: MessageType, payload: [String: Any]) {
        guard let text = WSCodec.encodeRequest(type: type.rawValue, correlationId: UUID().uuidString, payload: payload)
        else { return }
        task?.send(.string(text)) { _ in }
    }

    @discardableResult
    func on<E: Decodable>(_ type: MessageType, _ handler: @escaping (E) -> Void) -> () -> Void {
        let id = UUID()
        handlers[type.rawValue, default: [:]][id] = { data in
            if let decoded = try? JSONDecoder().decode(E.self, from: data) { handler(decoded) }
        }
        return { [weak self] in self?.handlers[type.rawValue]?.removeValue(forKey: id) }
    }

    func handleInbound(_ inbound: WSInbound) {
        switch inbound {
        case let .response(correlationId, _, payload):
            timeouts.removeValue(forKey: correlationId)?.cancel()
            if let cont = pending.removeValue(forKey: correlationId) { cont.resume(returning: payload) }
        case let .event(type, payload):
            handlers[type]?.values.forEach { $0(payload) }
        }
    }

    func failAllPending(_ error: WSClientError) {
        for (id, cont) in pending { timeouts.removeValue(forKey: id)?.cancel(); cont.resume(throwing: error) }
        pending.removeAll()
    }

    private func fail(_ correlationId: String, _ error: Error) {
        timeouts.removeValue(forKey: correlationId)?.cancel()
        if let cont = pending.removeValue(forKey: correlationId) { cont.resume(throwing: error) }
    }

    private func receiveLoop() {
        task?.receive { [weak self] result in
            guard let self else { return }
            switch result {
            case .failure:
                Task { @MainActor in
                    self.failAllPending(.notConnected)
                    if !self.isDisconnecting { self.scheduleReconnect() }
                }
            case let .success(message):
                let text: String? = {
                    switch message {
                    case let .string(s): return s
                    case let .data(d): return String(data: d, encoding: .utf8)
                    @unknown default: return nil
                    }
                }()
                Task { @MainActor in
                    if let text, let inbound = WSCodec.decode(text) { self.handleInbound(inbound) }
                    self.receiveLoop()
                }
            }
        }
    }

    private func scheduleReconnect() {
        reconnectAttempt += 1
        let delay = min(pow(2.0, Double(reconnectAttempt)), 30.0)
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
            if !self.isDisconnecting { self.connect() }
        }
    }

    nonisolated func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask,
                                didOpenWithProtocol protocol: String?) {
        Task { @MainActor in self.reconnectAttempt = 0 }
    }

    func awaitNextCorrelation(_ trigger: @escaping @MainActor (String) -> Void) async throws -> Data {
        let correlationId = UUID().uuidString
        return try await withCheckedThrowingContinuation { cont in
            pending[correlationId] = cont
            trigger(correlationId)
        }
    }
}
```

- [ ] **Step 7: Run all transport tests**

Run: `cd native && swift test --filter WSClientTests && swift test --filter WSCodecTests`
Expected: PASS (all). This is unit 2.4's verify: RPC resolves; timeout fires and is cancelled on success; reconnect resets `reconnectAttempt`; broadcast fan-out + unsubscribe; pending fail fast on drop.

- [ ] **Step 8: Commit**

```bash
git add native/Sources/Taskflow/Transport native/Tests/TaskflowTests/WSClientTests.swift \
        native/Tests/TaskflowTests/WSCodecTests.swift && \
git commit -m "feat(native): production WS client (typed RPC, cancellable timeout, fail-fast, reconnect)"
```
Then log the commit + `native/Sources/Taskflow/Transport/WSClient.swift` via taskflow-cli.

---

### Task 8: Backend sidecar manager (TDD on pure helpers + integration launch)

**Files:**
- Create: `native/Sources/Taskflow/Sidecar/SidecarSupport.swift`
- Create: `native/Sources/Taskflow/Sidecar/SidecarManager.swift`
- Create: `native/scripts/build-backend-sidecar.sh`
- Modify: `native/scripts/build-app.sh`
- Create: `native/Tests/TaskflowTests/SidecarSupportTests.swift`

**Interfaces:**
- Consumes: `WSClient` (Task 7), `MessageType` (Task 3), the compiled backend binary.
- Produces:
  - `enum SidecarSupport`: `static func parsePort(_ contents: String) -> Int?`, `static func childEnvironment(base: [String: String], portFile: String, rgPath: String?) -> [String: String]`, `static func wsURL(port: Int) -> URL`.
  - `@MainActor final class SidecarManager`: `init(resourcesURL: URL?, devRepoRoot: URL?)`, `func start() async throws -> WSClient` (spawns backend, resolves port, connects, health-checks), `func stop()`, `var isRunning: Bool`. `enum SidecarError: Error { case binaryNotFound, portTimeout, healthCheckFailed }`.

- [ ] **Step 1: Write failing tests — `native/Tests/TaskflowTests/SidecarSupportTests.swift`**

```swift
import XCTest
@testable import Taskflow

final class SidecarSupportTests: XCTestCase {
    func testParsePortAcceptsValidInteger() {
        XCTAssertEqual(SidecarSupport.parsePort("63074\n"), 63074)
        XCTAssertEqual(SidecarSupport.parsePort("  51000  "), 51000)
    }

    func testParsePortRejectsEmptyOrZeroOrPartial() {
        XCTAssertNil(SidecarSupport.parsePort(""))
        XCTAssertNil(SidecarSupport.parsePort("0"))
        XCTAssertNil(SidecarSupport.parsePort("12"))  // partial write: too small to be a real port
    }

    func testChildEnvironmentStripsClaudeVarsAndSetsPortFile() {
        let base = ["PATH": "/usr/bin", "CLAUDECODE": "1", "CLAUDE_CODE_ENTRYPOINT": "cli"]
        let env = SidecarSupport.childEnvironment(base: base, portFile: "/tmp/pf", rgPath: "/bin/rg")
        XCTAssertNil(env["CLAUDECODE"])
        XCTAssertNil(env["CLAUDE_CODE_ENTRYPOINT"])
        XCTAssertEqual(env["TASKFLOW_PORT_FILE"], "/tmp/pf")
        XCTAssertEqual(env["TASKFLOW_RG_PATH"], "/bin/rg")
        XCTAssertEqual(env["PATH"], "/usr/bin")
    }

    func testWsURLBuildsLocalhost() {
        XCTAssertEqual(SidecarSupport.wsURL(port: 8080).absoluteString, "ws://localhost:8080")
    }
}
```

> `parsePort` rejecting `"12"` encodes the port-file partial-write guard: a valid ephemeral port is ≥ 1024. Use that threshold.

- [ ] **Step 2: Run — verify it fails**

Run: `cd native && swift test --filter SidecarSupportTests`
Expected: FAIL (`SidecarSupport` not defined).

- [ ] **Step 3: Implement `SidecarSupport.swift`**

```swift
import Foundation

enum SidecarSupport {
    static func parsePort(_ contents: String) -> Int? {
        let trimmed = contents.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let port = Int(trimmed), port >= 1024, port <= 65535 else { return nil }
        return port
    }

    static func childEnvironment(base: [String: String], portFile: String, rgPath: String?) -> [String: String] {
        var env = base
        env.removeValue(forKey: "CLAUDECODE")
        env.removeValue(forKey: "CLAUDE_CODE_ENTRYPOINT")
        env["TASKFLOW_PORT_FILE"] = portFile
        if let rgPath { env["TASKFLOW_RG_PATH"] = rgPath }
        return env
    }

    static func wsURL(port: Int) -> URL {
        URL(string: "ws://localhost:\(port)")!
    }
}
```

- [ ] **Step 4: Run — verify it passes**

Run: `cd native && swift test --filter SidecarSupportTests`
Expected: PASS (4 tests).

- [ ] **Step 5: Implement `SidecarManager.swift`**

```swift
import Foundation

@MainActor
final class SidecarManager {
    enum SidecarError: Error { case binaryNotFound, portTimeout, healthCheckFailed }

    private let resourcesURL: URL?   // packaged: .../Contents/Resources
    private let devRepoRoot: URL?    // dev fallback: run via `bun packages/backend/src/index.ts`
    private var process: Process?
    private var portFile: URL?
    private(set) var isRunning = false

    init(resourcesURL: URL?, devRepoRoot: URL?) {
        self.resourcesURL = resourcesURL
        self.devRepoRoot = devRepoRoot
    }

    func start() async throws -> WSClient {
        let pf = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("taskflow-port-\(ProcessInfo.processInfo.processIdentifier)-\(Int(Date().timeIntervalSince1970))")
        portFile = pf

        let proc = Process()
        let env = SidecarSupport.childEnvironment(
            base: ProcessInfo.processInfo.environment, portFile: pf.path, rgPath: resolveRipgrep())

        if let bin = packagedBinary() {
            proc.executableURL = bin
            proc.arguments = []
        } else if let root = devRepoRoot {
            proc.executableURL = URL(fileURLWithPath: "/usr/bin/env")
            proc.arguments = ["bun", "run", root.appendingPathComponent("packages/backend/src/index.ts").path]
        } else {
            throw SidecarError.binaryNotFound
        }
        proc.environment = env
        proc.standardOutput = FileHandle.nullDevice
        proc.standardError = FileHandle.nullDevice
        try proc.run()
        process = proc

        let port = try await waitForPort(pf, deadlineSeconds: 10)
        let client = WSClient(url: SidecarSupport.wsURL(port: port))
        client.connect()
        // Health check: system:info must round-trip.
        do {
            _ = try await client.requestRaw(.systemInfo, payload: [:])
        } catch {
            throw SidecarError.healthCheckFailed
        }
        isRunning = true
        return client
    }

    func stop() {
        process?.terminate()
        process = nil
        isRunning = false
        if let pf = portFile { try? FileManager.default.removeItem(at: pf) }
    }

    private func packagedBinary() -> URL? {
        guard let res = resourcesURL else { return nil }
        let bin = res.appendingPathComponent("backend/taskflow-backend")
        return FileManager.default.isExecutableFile(atPath: bin.path) ? bin : nil
    }

    private func resolveRipgrep() -> String? {
        if let res = resourcesURL {
            let rg = res.appendingPathComponent("backend/rg").path
            if FileManager.default.isExecutableFile(atPath: rg) { return rg }
        }
        return nil
    }

    private func waitForPort(_ file: URL, deadlineSeconds: Double) async throws -> Int {
        let deadline = Date().addingTimeInterval(deadlineSeconds)
        while Date() < deadline {
            if process?.isRunning == false { throw SidecarError.portTimeout }
            if let contents = try? String(contentsOf: file, encoding: .utf8),
               let port = SidecarSupport.parsePort(contents) {
                return port
            }
            try? await Task.sleep(nanoseconds: 100_000_000) // 100ms
        }
        throw SidecarError.portTimeout
    }
}
```

> Mirrors Electron's `backend-manager.ts`: unique temp port file, 100ms/10s polling, strip the two Claude vars, packaged-binary vs dev `bun run` fallback. `system:info` is the health check (returns `{ editors, homedir }`).

- [ ] **Step 6: Write `native/scripts/build-backend-sidecar.sh`**

```bash
#!/usr/bin/env bash
# Compile the Bun backend and stage it into the app's resources for bundling.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # native/
REPO_ROOT="$(cd "$HERE/.." && pwd)"

( cd "$REPO_ROOT/packages/backend" && bun build src/index.ts --compile --outfile dist/taskflow-backend )

DEST="$HERE/Sources/Taskflow/Resources/backend"
mkdir -p "$DEST"
cp "$REPO_ROOT/packages/backend/dist/taskflow-backend" "$DEST/taskflow-backend"
chmod +x "$DEST/taskflow-backend"

# Stage ripgrep if available (used by search; optional for boot).
RG="$(find "$REPO_ROOT" -path '*/@vscode/ripgrep/bin/rg' -type f 2>/dev/null | head -1 || true)"
[ -n "$RG" ] && cp "$RG" "$DEST/rg" && chmod +x "$DEST/rg" || true

echo "Staged backend sidecar into $DEST"
```

Make executable: `chmod +x native/scripts/build-backend-sidecar.sh`. Add its call to `build-app.sh` before `swift build`:
```bash
scripts/build-backend-sidecar.sh
```

- [ ] **Step 7: Integration — boot the app against the sidecar**

Add a temporary boot path in `TaskflowApp`/`AppEnvironment` that, on launch, constructs `SidecarManager(resourcesURL: Bundle.main.resourceURL ... , devRepoRoot: <repo root for dev>)`, calls `start()`, and logs the resolved port + a successful `system:info`. For dev runs (`swift run`), pass `devRepoRoot` = the repo root so it spawns via `bun run` (no bundling needed to test the path).

Run (dev path): `cd native && swift build && TASKFLOW_REPO_ROOT="$(cd .. && pwd)" ./.build/debug/Taskflow &`
Expected: app window appears; console/log shows `sidecar port <N>` then a `system:info` success (homedir printed). Capture `native/evidence/03-sidecar-connected.png`. Confirm with `pgrep -fl taskflow-backend` (dev path shows the `bun` process). Kill app + sidecar afterward; confirm `stop()` removes the port file.

- [ ] **Step 8: Verify packaged path end-to-end (optional but recommended)**

Run: `cd native && ./scripts/build-app.sh && open .build/app/Taskflow.app`
Expected: the bundled `.app` spawns the **compiled** `taskflow-backend` from `Contents/Resources/backend/` and connects (verify via `pgrep -fl taskflow-backend`). Screenshot `native/evidence/04-sidecar-packaged.png`.

- [ ] **Step 9: Commit**

```bash
git add native/Sources/Taskflow/Sidecar native/scripts/build-backend-sidecar.sh \
        native/scripts/build-app.sh native/Tests/TaskflowTests/SidecarSupportTests.swift \
        native/Sources/Taskflow/App && \
git commit -m "feat(native): backend sidecar manager (spawn, port handshake, health-check, lifecycle)"
```
Then log the commit + `native/Sources/Taskflow/Sidecar/SidecarManager.swift` via taskflow-cli.

---

### Task 9: `ui/` primitives kit + gallery (themed)

**Files:**
- Create: `native/Sources/Taskflow/UI/Primitives/AppButton.swift`
- Create: `native/Sources/Taskflow/UI/Primitives/AppToggle.swift`
- Create: `native/Sources/Taskflow/UI/Primitives/AppBadge.swift`
- Create: `native/Sources/Taskflow/UI/Primitives/AppTextField.swift`
- Create: `native/Sources/Taskflow/UI/Primitives/AppSegmentedTabs.swift`
- Create: `native/Sources/Taskflow/UI/Primitives/AppMenu.swift` (Menu/Popover/Sheet wrappers)
- Create: `native/Sources/Taskflow/UI/Primitives/ThemeEnvironment.swift`
- Create: `native/Sources/Taskflow/UI/PrimitivesGallery.swift`

**Interfaces:**
- Consumes: `AppTheme` + `ThemeStore` (Task 6).
- Produces: a `\.appTheme` SwiftUI `EnvironmentValues` key; primitives that read it; a `PrimitivesGallery` view showing every primitive and a theme `Picker` bound to `ThemeStore`.

- [ ] **Step 1: Add the theme environment — `ThemeEnvironment.swift`**

```swift
import SwiftUI

private struct AppThemeKey: EnvironmentKey {
    static let defaultValue = AppTheme(ResolvedThemeFile(
        id: "fallback", name: "Fallback",
        css: ["--background": "#1e1e2e", "--foreground": "#cdd6f4", "--primary": "#cdd6f4",
              "--accent": "#89b4fa", "--border": "#45475a", "--muted": "#585b70",
              "--destructive": "#f38ba8"],
        xterm: XtermColors(background: "#1e1e2e", foreground: "#cdd6f4", cursor: "#f5e0dc",
            cursorAccent: "#1e1e2e", selectionBackground: "#585b70", black: "#45475a",
            red: "#f38ba8", green: "#a6e3a1", yellow: "#f9e2af", blue: "#89b4fa",
            magenta: "#f5c2e7", cyan: "#94e2d5", white: "#bac2de", brightBlack: "#585b70",
            brightRed: "#f38ba8", brightGreen: "#a6e3a1", brightYellow: "#f9e2af",
            brightBlue: "#89b4fa", brightMagenta: "#f5c2e7", brightCyan: "#94e2d5",
            brightWhite: "#a6adc8")))
}

extension EnvironmentValues {
    var appTheme: AppTheme {
        get { self[AppThemeKey.self] }
        set { self[AppThemeKey.self] = newValue }
    }
}
```

- [ ] **Step 2: Implement the primitives (each reads `\.appTheme`)**

`AppButton.swift` (the others follow the same pattern — themed via `@Environment(\.appTheme)`):

```swift
import SwiftUI

struct AppButton: View {
    enum Kind { case primary, secondary, destructive }
    let title: String
    var kind: Kind = .primary
    let action: () -> Void
    @Environment(\.appTheme) private var theme

    var body: some View {
        Button(action: action) {
            Text(title)
                .padding(.horizontal, 12).padding(.vertical, 6)
                .foregroundStyle(foreground)
                .background(background)
                .clipShape(RoundedRectangle(cornerRadius: 6))
        }
        .buttonStyle(.plain)
    }

    private var background: Color {
        switch kind {
        case .primary: return theme.primary
        case .secondary: return theme.muted
        case .destructive: return theme.destructive
        }
    }
    private var foreground: Color { theme.background }
}
```

Implement `AppToggle`, `AppBadge`, `AppTextField`, `AppSegmentedTabs`, `AppMenu` similarly — native `Toggle`/`TextField`/`Menu`/`.popover`/`.sheet` tinted from `theme`. Keep each file small and single-purpose.

- [ ] **Step 3: Build the gallery — `PrimitivesGallery.swift`**

```swift
import SwiftUI

struct PrimitivesGallery: View {
    @ObservedObject var themeStore: ThemeStore
    @State private var toggleOn = true
    @State private var text = "edit me"
    @State private var tab = 0

    var body: some View {
        let theme = themeStore.current
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Picker("Theme", selection: Binding(
                    get: { theme.id },
                    set: { themeStore.select(id: $0) })) {
                    ForEach(themeStore.all) { t in Text(t.name).tag(t.id) }
                }
                .frame(width: 260)

                HStack(spacing: 8) {
                    AppButton(title: "Primary", kind: .primary) {}
                    AppButton(title: "Secondary", kind: .secondary) {}
                    AppButton(title: "Delete", kind: .destructive) {}
                }
                AppToggle(title: "Enabled", isOn: $toggleOn)
                AppTextField(text: $text)
                AppSegmentedTabs(selection: $tab, titles: ["One", "Two", "Three"])
                HStack { AppBadge(text: "active"); AppBadge(text: "3") }
            }
            .padding(24)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(theme.background)
        .environment(\.appTheme, theme)
    }
}
```

- [ ] **Step 4: Point the app's root at the gallery (temporary host)**

In `TaskflowApp`, set the root view to `PrimitivesGallery(themeStore: themeStore)` with a `@StateObject ThemeStore`. (Task 10 composes the final root; for now the gallery is the visible surface.)

- [ ] **Step 5: Build + launch + verify theming switches**

Run: `cd native && swift build && ./.build/debug/Taskflow &`
Then capture `native/evidence/05-gallery-default.png`, switch the theme `Picker` to "Dracula", capture `native/evidence/06-gallery-dracula.png`.
Expected: every primitive renders; switching themes recolors buttons/background/badges live (proves `AppTheme` → primitives wiring). Quit afterward.

- [ ] **Step 6: Commit**

```bash
git add native/Sources/Taskflow/UI && \
git commit -m "feat(native): themed ui/ primitives kit + primitives gallery"
```
Then log the commit + `native/Sources/Taskflow/UI/PrimitivesGallery.swift` via taskflow-cli.

---

### Task 10: Phase 2 integration smoke + results note (the acceptance gate)

**Files:**
- Modify: `native/Sources/Taskflow/App/TaskflowApp.swift`
- Create: `native/Sources/Taskflow/App/AppEnvironment.swift`
- Create: `docs/superpowers/specs/2026-06-27-phase2-foundations-results.md`

**Interfaces:**
- Consumes: everything — `SidecarManager`, `WSClient`, `ThemeStore`, `PrimitivesGallery`, generated `MessageType`/models.
- Produces: an `AppEnvironment` `ObservableObject` that owns the sidecar lifecycle + WS client and exposes connection state; a results spec recording what Phase 2 proved + carry-forwards.

- [ ] **Step 1: Implement `AppEnvironment.swift` (composition root)**

```swift
import SwiftUI

@MainActor
final class AppEnvironment: ObservableObject {
    enum Status: Equatable { case connecting, connected(port: Int), failed(String) }
    @Published private(set) var status: Status = .connecting
    let themeStore = ThemeStore()
    private let sidecar: SidecarManager
    private(set) var client: WSClient?

    init() {
        let repoRoot = ProcessInfo.processInfo.environment["TASKFLOW_REPO_ROOT"].map(URL.init(fileURLWithPath:))
        sidecar = SidecarManager(resourcesURL: Bundle.main.resourceURL, devRepoRoot: repoRoot)
    }

    func boot() async {
        do {
            let client = try await sidecar.start()
            self.client = client
            // A real round-trip beyond the health check: count tasks.
            let data = try await client.requestRaw(.taskList, payload: [:])
            struct Resp: Decodable { let tasks: [Taskflow.Task] }
            let resp = try JSONDecoder().decode(Resp.self, from: data)
            NSLog("Phase2 smoke: task:list returned \(resp.tasks.count) tasks")
            status = .connected(port: 0)
        } catch {
            status = .failed("\(error)")
        }
    }

    func shutdown() { sidecar.stop() }
}
```

> Resolve the `Taskflow.Task` shadowing decision flagged in Task 4 here (qualify or rename). Whatever is chosen, apply it consistently and record it in the results note.

- [ ] **Step 2: Wire the composition root into `TaskflowApp`**

```swift
import SwiftUI

@main
struct TaskflowApp: App {
    @StateObject private var env = AppEnvironment()

    var body: some Scene {
        WindowGroup("Taskflow") {
            RootView()
                .environmentObject(env)
                .environment(\.appTheme, env.themeStore.current)
                .frame(minWidth: 900, minHeight: 600)
                .task { await env.boot() }
                .onDisappear { env.shutdown() }
        }
    }
}

struct RootView: View {
    @EnvironmentObject var env: AppEnvironment
    var body: some View {
        VStack(spacing: 0) {
            statusBar
            PrimitivesGallery(themeStore: env.themeStore)
        }
    }
    private var statusBar: some View {
        HStack {
            switch env.status {
            case .connecting: Text("Connecting to backend…")
            case let .connected(port): Text("Backend connected (port \(port))")
            case let .failed(msg): Text("Backend failed: \(msg)").foregroundStyle(.red)
            }
            Spacer()
        }
        .padding(8)
    }
}
```

- [ ] **Step 3: Build + run the full integration**

Run: `cd native && swift build && TASKFLOW_REPO_ROOT="$(cd .. && pwd)" ./.build/debug/Taskflow &`
Expected: window shows "Backend connected", the primitives gallery renders themed, the log shows `Phase2 smoke: task:list returned N tasks` (N matches a direct probe), and `pgrep -fl taskflow-backend` shows the sidecar. Capture `native/evidence/07-phase2-integration.png`. Quit; confirm the sidecar process is gone.

- [ ] **Step 4: Run the full test suite**

Run: `cd native && swift test`
Expected: all tests pass (MessageType, ModelDecode, UnionDecode, Theme, WSCodec, WSClient, SidecarSupport). Record the count.

- [ ] **Step 5: Write the results note — `docs/superpowers/specs/2026-06-27-phase2-foundations-results.md`**

Record: what each unit proved (2.1 launchable `.app` from SwiftPM; 2.2 sidecar spawn + port handshake + health-check; 2.3 full codegen surface incl. unions + 14 baked themes + `AppTheme` + libghostty mapping; 2.4 production WS client; 2.5 themed primitives kit), the evidence screenshots, the test count, and **carry-forwards**: the `Task`-shadowing resolution chosen; any union tags resolved by fallback that need manual confirmation against `agent.ts`; any `rgba(...)` CSS vars not parsed by `Color(hex:)`; the editor/terminal deps are pinned but unwired (Phase 4). State that Phase 2 is complete and Phase 3 (structural spine) is unblocked.

- [ ] **Step 6: Commit**

```bash
git add native/Sources/Taskflow/App docs/superpowers/specs/2026-06-27-phase2-foundations-results.md && \
git commit -m "feat(native): Phase 2 integration smoke (app->sidecar->WS->themed gallery) + results"
```
Then log the commit + the results spec path via taskflow-cli.

---

## Self-Review

**Spec coverage (master plan Phase 2 units):**
- **2.1 Project + build** → Tasks 1–2 (SwiftPM target, Swift 6, launchable `.app`). ✓
- **2.2 Backend sidecar launch** → Task 8 (spawn, port handshake, `system:info` health-check, `stop()` lifecycle). ✓
- **2.3 Type + theme codegen (D3)** → Tasks 3–6 (MSG catalog, structs/enums, unions, 14 baked themes → `AppTheme`, ANSI → libghostty config; codegen wired into the build). ✓ Emits the **entire** surface per the locked decision. ✓
- **2.4 Production WS client** → Task 7 (typed correlationId RPC, broadcast, cancellable 30s timeout, fail-fast, exp-backoff reconnect). ✓
- **2.5 `ui/` primitives kit** → Task 9 (themed Button/Toggle/Badge/TextField/SegmentedTabs/Menu + gallery). ✓ (Built after the spine deps it needs — `AppTheme` — exist; still within Phase 2 and ahead of Phases 3–5 that consume it.)
- **Integration/acceptance** → Task 10 (app → sidecar → WS → themed gallery, results note). ✓

**Global-constraint coverage:** macOS 13+ ✓; SwiftPM-only + bundling script ✓ (Task 2); Swift 6 mode ✓ (Task 1); exact dep pins ✓ (Task 1); no shared/backend edits ✓ (codegen reads, sidecar runs); committed+reproducible codegen ✓ (Tasks 3–6 + build-app.sh); full-surface codegen ✓; bun-only, no `as any` ✓; no co-authored-by ✓; taskflow-cli logging per task ✓.

**Placeholder scan:** No "TBD"/"add error handling"/"similar to Task N" left. The two areas intentionally summarized rather than fully inlined — the remaining 28 `ThemeToken` cases (copy verbatim from `theme.ts`) and the sibling primitives following `AppButton`'s shown pattern — are explicit, mechanical, and fully specified by the shown exemplar + named source, not open design.

**Type consistency:** `MessageType` (Task 3) consumed by `WSClient` (7), `SidecarManager` (8), `AppEnvironment` (10). `WSClient` API (`requestRaw`/`request`/`on`/`send`) defined in Task 7, consumed in 8/10. `AppTheme`/`ThemeStore`/`ResolvedThemeFile`/`XtermColors`/`ThemeToken` defined in Task 6, consumed in 9/10. `SidecarSupport`/`SidecarManager` defined in Task 8, consumed in 10. `AnyCodable` defined in Task 4, used by 5/7. The `Taskflow.Task` shadow is flagged at first emission (Task 4) and resolved at the composition root (Task 10). Names are consistent across producer/consumer blocks.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-27-phase2-foundations.md`. Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration. (Matches how Phase 1 was executed.)
2. **Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
