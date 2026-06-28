# Task 8 Report: RunMenuViewModel

## TDD Evidence

**RED:** `swift test --filter RunMenuTests` before implementation → compile errors (`cannot find 'RunMenuViewModel' in scope`, `cannot find 'RunMenuData' in scope`).

**GREEN:** After implementing `RunMenuViewModel.swift` → all 5 `RunMenuTests` pass (0.001 s):
- `testHasItems`
- `testFlowsSuppressedWhileRunning`
- `testAgentCommandsTriggerItems`
- `testStandaloneActionsTriggerItems`
- `testEmptyDataReturnsFalse`

**Full suite:** `swift test` → **Executed 176 tests, with 0 failures**.

---

## TS Callback Findings

### `useRunMenu.ts` — key observations

- **`navigate(focusWorkspace: bool)`** calls: `setActiveTask(taskId)` (if taskId), `setActiveProject(projectId)`, `setFocusedPanel("workspace")` (if `focusWorkspace`). Does NOT call `setMasterWorkspaceActive` — that note in the task description is not borne out by the TS source.
- **`onRunScript(name)`**: `runInShell` → shell session with command `\`${defaultRuntime} run ${name}\r\``. `runInShell` creates a session with `configuredShell` as the shell type; in Swift no shell-selection mechanism exists yet so we use `type: .shell` and follow with `sendInput`.
- **`onRunAgentCommand(cmd)`**: `createSession(owner, "claude", cmd.name, \`/${cmd.name}\`)` — the 4th arg is the `prompt` delivered at session start. Ported to `createSession` + `sendInput("/\(cmd.name)\r")`.
- **`onRunAction(action)`**: Shell → `runInShell(prompt: action.prompt ? \`${action.prompt}\r\` : undefined)`; non-shell → `createSession(sessionType, name, prompt)`. Ported: shell branch uses `TabType.shell`; other branch maps `SessionType.rawValue → TabType.rawValue`. `sendInput(prompt)` skipped if `action.prompt.isEmpty`.
- **`onStartFlow(flowId)`**: Looks up the flow; if `flow?.inputs && flow.inputs.length > 0` → opens flow-input dialog (5F seam). Else navigate + `startFlow(flowOwner)`. Ported faithfully; 5F seam is `return` with comment.
- **`onRunTab(agent)`**: Guards `if (!taskId) return`; creates session with `task?.description` as prompt. Ported with `guard let taskId` and `sendInput(description)` if non-empty.
- **`onRunTabWithOptions(agent)`**: Sets `runOptionsAgent` state to open options dialog. Ported as `// 5F: AgentOptionsDialog seam` no-op.

### `lib/run-menu.ts` — `hasRunMenuItems` predicate

```typescript
const hasClaudeAgent = isAgentAvailable(data.agents, "claude");
return scriptNames.length > 0
    || (data.agentCommands.length > 0 && hasClaudeAgent)
    || (data.flows.length > 0 && !data.activeFlowRun)
    || data.standaloneActions.length > 0
    || data.showAgentOptions;
```

The `online` field is NOT checked in this predicate; it governs item enablement in the UI layer.

---

## Backend-Contract Decisions

| Decision | Rationale |
|---|---|
| Used `ScriptsListResponse` directly (has `packageManager` field) | Generated type reused as-is; `scripts` dict extracted |
| Used `AgentCommandsListResponse` directly | Matches generated type |
| `hasActiveFlowRun: Bool` in `RunMenuData` (not `FlowRun?`) | Brief specifies bool; predicate only needs it as boolean |
| `agentCommands` gate = non-empty only (no `hasClaudeAgent` check) | 5B all-available simplification; annotated with comment |
| Added `defaultRuntime: String` to `callbacks()` signature | Brief's signature omits it but `onRunScript` requires it; call site reads `env.settings?.settings?.general.defaultRuntime ?? "bun"` |
| Navigate does NOT call `setMasterWorkspaceActive(false)` | TS `navigate` in `useRunMenu.ts` does not call it; the task description's listing appears to be a broader nav-API inventory, not specific to this hook |
| `onRunTab` guards `guard let taskId else { return }` | Ports TS `if (!taskId) return` exactly |
| `sendInput` after `createSession` (not `prompt:` param) | `SessionViewModel.createSession` has no `prompt` param; brief explicitly prescribes `sendInput` with note to prefer `initialInput` if added later |
| Strong captures (no `[weak]`) in callbacks closures | `RunMenuCallbacks` is a value struct not stored on any captured VM → no retain cycle; all VMs are `@MainActor` (implicitly `Sendable` in Swift 6) |
| `workspaceKey` derived as `task(taskId)` else `project(projectId)` | Matches `SessionViewModel.createSession`'s own fallback logic; explicit `targetWorkspaceKey` ensures the tab lands in the right pane immediately |

---

## Files Changed

| File | Change |
|---|---|
| `native/Sources/Taskflow/ViewModels/RunMenuViewModel.swift` | **Created** — `RunMenuData`, `RunMenuCallbacks`, `RunMenuViewModel` |
| `native/Tests/TaskflowTests/RunMenuTests.swift` | **Created** — 5 TDD tests for `hasRunMenuItems` |
| `native/Sources/Taskflow/App/AppEnvironment.swift` | Added `private(set) var runMenu: RunMenuViewModel?` and construction in `compose(client:)` |
| `native/Tests/TaskflowTests/AppEnvironmentTests.swift` | Added `XCTAssertNil(env.runMenu)` and `XCTAssertNotNil(env.runMenu)` to the two guard tests |

---

## Self-Review

- All generated types reused (`ScriptsListResponse`, `AgentCommandsListResponse`, `AgentCommand`, `FlowDefinition`, `ActionDefinition`, `FlowStartPayload`, `SessionType`, `AgentType`, `TabType`).
- No `as any`, `as!`, `AnyCodable` casts, or inline `struct Res` wrappers added.
- `hasRunMenuItems` is `nonisolated static` — callable from any context.
- `RunMenuViewModel` has no `AppEnvironment` back-reference.
- No `bind()` call and no boot load added (lazy fetch only).
- `AppEnvironmentTests` updated in both guard tests (`Nil` + `NotNil`).
- `onRunTabWithOptions` and flow-input branch both carry unambiguous 5F seam comments.
- `displayName(_:)` switch is exhaustive over `AgentType` cases.

### Items needing controller confirmation

1. **`defaultRuntime` in `callbacks()` signature**: Added as explicit param (not in brief's spec). Confirm call-site expectation for Task 9.
2. **`setMasterWorkspaceActive` omission**: TS source doesn't call it in `navigate`; omitted here. Confirm if native app requires it.
3. **`onRunTab` only works with a task owner**: The TS `onRunTab` guards `if (!taskId) return` — project-only contexts get a no-op. Confirm this is acceptable for Task 9's call sites.
