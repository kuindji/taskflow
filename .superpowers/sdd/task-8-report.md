# Task 8 Report: MissingLocationDialog + ProjectGroup trigger

## Build Result

`swift build` completed clean (Build complete! 4.58s). One pre-existing `result of 'try?' is unused` warning on the `updateProject` call in `changeLocation()`; zero errors. 257/0 test suite unchanged.

## Files Changed

1. **CREATED** `native/Sources/Taskflow/UI/Dialogs/MissingLocationDialog.swift` — 115 lines
2. **MODIFIED** `native/Sources/Taskflow/UI/Sidebar/ProjectGroup.swift` — added `@State private var missingDialogOpen`, locationValid branch in tap gesture, and `.sheet` mount

## Implementation Notes

### MissingLocationDialog

- Header matches `NewProjectDialog` / `ScheduleManagementDialog` pattern: `Text(title)` + `Spacer()` + plain `AppIcon("X")` button that sets `isPresented.wrappedValue = false`
- Content section: title sentence naming `project.name`, then `project.path` in `.font(.system(.body, design: .monospaced))`, then a secondary hint line
- Footer: `AppButton(title: "Remove Project", kind: .destructive)` on the left sets `confirmRemove = true`; `AppButton(title: "Change Location", kind: .secondary)` on the right calls `changeLocation()`
- `changeLocation()` is `@MainActor` (matches `GeneralSection.pickDirectory`): runs `NSOpenPanel.runModal()` synchronously, then dispatches `Task { @MainActor in try? await env.projects?.updateProject(id: project.id, path: url.path); isPresented.wrappedValue = false }`
- `.alert("Remove Project?", isPresented: $confirmRemove)` with a `.destructive` "Remove" action that dispatches `Task { @MainActor in try? await env.projects?.removeProject(id: project.id); isPresented.wrappedValue = false }` and a `.cancel` "Cancel" action — matches `ScheduleManagementDialog` alert style

### ProjectGroup trigger

- `@State private var missingDialogOpen = false` added alongside existing state fields
- `.onTapGesture(perform: onProjectClick)` replaced with a closure that checks `project.locationValid == false` and sets `missingDialogOpen = true`, else calls `onProjectClick()`
- `.sheet(isPresented: $missingDialogOpen) { MissingLocationDialog(isPresented: $missingDialogOpen, project: project) }` mounted on the header view, immediately after the tap gesture modifier
- Drag/drop, context menu, and `// 5F: fork dialog seam` are untouched

## Self-Review

- No `as any` or force casts
- No `public` exports — all `internal`/`private`
- No lint-rule disabling
- `@MainActor` on `changeLocation()` makes the synchronous `runModal()` call explicit; consistent with `GeneralSection` and `NewProjectDialog`
- The `try?` on `updateProject` silently swallows errors — acceptable given TS counterpart also ignores errors at this layer; a future task could add inline error feedback
- `project.locationValid == false` (not `!= true`) correctly leaves `nil` (unknown) projects unaffected — tapping them proceeds with normal `onProjectClick()` behaviour

## Concerns

None. The warning on unused `try?` result is pre-existing style in this codebase (matches `removeProject` and other call sites).

## Commit

`952a8d9` — `feat(native): 5F MissingLocationDialog + ProjectGroup trigger`

taskflow-cli log entries recorded for commit and both changed files.

## Fix wave (Task 8 review)

**Line 106 changed:** `native/Sources/Taskflow/UI/Dialogs/MissingLocationDialog.swift` — Added `_ = ` prefix to discard unused `try?` result from `updateProject` call in `changeLocation()`.

**Build:** `swift build` complete, "Result of 'try?' is unused" warning gone, only pre-existing tree-sitter linker warnings remain.

**Tests:** 257/0 passing.
