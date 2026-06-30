# Task 9 Report: ForkProjectDialog + slugify (TDD) + ProjectGroup trigger

## Build Result
`swift build` — Build complete! (4.66s), zero errors, zero new warnings from project code.

## Test Suite
`swift test` — 261 tests, 0 failures (baseline was 257; +4 new ForkSlugifyTests).

## TDD Evidence

### RED phase
Wrote `ForkSlugifyTests.swift` first. Running `swift test --filter ForkSlugifyTests` produced:
```
error: cannot find 'ForkProjectDialog' in scope
```
All 4 assertions unresolved — confirmed RED.

### GREEN phase
After implementing `ForkProjectDialog.swift`:
```
Test Suite 'ForkSlugifyTests' passed at ...
Executed 4 tests, with 0 failures (0 unexpected) in 0.001 seconds
```

## slugify / parentDir Implementation

`slugify(_ s: String)` — lowercases, then iterates characters: `/` or whitespace → `-`; letters, digits, `-`, `.` → kept; all other characters dropped. Clean character-level loop, no regex.

`parentDir(_ path: String)` — finds `lastIndex(of: "/")`, returns substring before it. Returns `path` unchanged if slash is at index 0 or not found.

Both are `nonisolated static` on the struct, accessible via `@testable import Taskflow`.

## Dialog Implementation

`ForkProjectDialog: View` with:
- `let isPresented: Binding<Bool>; let project: Project`
- `@Environment(AppEnvironment.self)` + `@Environment(\.appTheme)`
- Branch field (autofocus via `@FocusState`), folder field, target path preview, inline error text
- Custom `Binding<String>` (`folderBinding`) on the folder TextField: setter marks `customFolder = true` before updating state. This prevents the circular problem where programmatic folder updates from branch onChange would fire folder's onChange and prematurely lock the auto-derive.
- Branch onChange: `if !customFolder { folder = Self.slugify(newValue) }` — re-derives folder only while user hasn't customized it.
- Validation: `canSubmit = !branch.trimmed.isEmpty && !folder.trimmed.isEmpty && !loading`
- Submit button + `.keyboardShortcut(.return, modifiers: .command)` on the button (not container)
- Error: inline `Text` in `theme.color(.destructive)`

**Success alert decision**: Kept the `.alert` success notice. After the fork call succeeds, we set `isPresented = false` first, then set `showSuccess = true` + `successMessage`. The alert fires in the parent context after dismissal, which avoids ordering issues. Note: since dismissal happens before the alert fires, the alert appears after the sheet is gone — this is acceptable behavior.

## Trigger Wired

`ProjectGroup.swift` — added `@State private var forkOpen = false`; button action sets `forkOpen = true`; `.sheet(isPresented: $forkOpen) { ForkProjectDialog(isPresented: $forkOpen, project: project) }` added to the header chain after the `missingDialogOpen` sheet. No other context-menu items or the Task 8 missing-location sheet were touched.

## Files Changed
- **Created**: `native/Sources/Taskflow/UI/Dialogs/ForkProjectDialog.swift` (178 lines)
- **Created**: `native/Tests/TaskflowTests/ForkSlugifyTests.swift` (17 lines)
- **Modified**: `native/Sources/Taskflow/UI/Sidebar/ProjectGroup.swift` (added `@State forkOpen`, button action, `.sheet`)

## Commit
`1abad1c` — feat(native): 5F ForkProjectDialog + slugify (TDD) + trigger

## Self-Review Findings
- No `public`, no `as any`, no force casts, no disabled lint rules.
- Custom Binding pattern for folder avoids SwiftUI onChange circular-update bug that a naive `@State + .onChange` approach would have.
- `nonisolated static` on both pure helpers satisfies Swift 6 concurrency (no actor-isolated state access) and testability.
- Target path preview shown only when folder is non-empty to avoid a bare trailing `/`.

## Concerns
None.

## Fix wave (Task 9 review)

Addressed three code-review findings in `ForkProjectDialog.swift`:

1. **Dead success alert removed** — Removed `@State private var showSuccess` and `@State private var successMessage` declarations. Removed the `.alert("Fork complete", isPresented: $showSuccess)` modifier from body. In `submit()`, removed the success-notice block `if let resp { successMessage = ...; showSuccess = true }` and replaced the unused result with `_ =`.

2. **Font collapse** — Replaced double `.font` modifiers (`.font(.system(.body, design: .monospaced))` + `.font(.system(size: 11))`) with single combined call: `.font(.system(size: 11, design: .monospaced))`.

3. **Predicate simplification** — Removed redundant `!targetPath.isEmpty` check (targetPath always contains "/" from parentDir logic). Kept only folder non-empty guard.

Build: clean, zero new warnings. Test suite: 261 tests, 0 failures (unchanged).
