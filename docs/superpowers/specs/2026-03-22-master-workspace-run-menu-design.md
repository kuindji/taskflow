# Master Workspace Run Menu

## Overview

Add Run menu support to the master workspace, showing user-level `.claude` commands, global flows, and global standalone actions. No package.json scripts (no project context).

## Data Sources

| Section | Source | Filter |
|---------|--------|--------|
| `.claude` commands | `~/.claude/commands` | User-level only (no project path) |
| Flows | Flow store | Global only (`projectId` is undefined) |
| Actions | Flow store | Global + standalone only (`projectId` undefined, `standalone: true`) |
| Scripts | N/A | Not applicable — no `package.json` in `$HOME` |

## Changes

### 1. Shared Types

**`packages/shared/src/types/flow.ts`**:

Extend `FlowOwner` with `{ master: true }` variant using the existing discriminated-never pattern:

```typescript
type FlowOwner =
    | { taskId: string; projectId?: never; master?: never }
    | { projectId: string; taskId?: never; master?: never }
    | { master: true; taskId?: never; projectId?: never };
```

Extend `FlowRun` — already defined as `FlowOwner & { ... }`, so it inherits the new variant automatically.

Update `getFlowRunOwnerId` to handle master:

```typescript
function getFlowRunOwnerId(run: FlowRun): string {
    if (run.taskId) return run.taskId;
    if (run.projectId) return run.projectId;
    if (run.master) return "__master__";
    throw new Error("FlowRun must have taskId, projectId, or master");
}
```

The sentinel `"__master__"` is used as ownerId for lock keys, store lookups, and broadcast matching.

Extend `FlowStartPayload`:

```typescript
interface FlowStartPayload {
    taskId?: string;
    projectId?: string;
    master?: true;
    flowId: string;
    inputValues?: Record<string, string>;
}
```

### 2. Backend — Flow Execution

Multiple files need changes to handle `{ master: true }` as a valid flow owner.

**`packages/backend/src/handlers/flow.ts`** — `FLOW_START` handler:

```typescript
// Current: throws if neither taskId nor projectId
// New: accept master as third variant
if (payload.taskId) {
    return await flowRunner.startFlow({ taskId: payload.taskId }, flow, inputValues);
}
if (payload.master) {
    return await flowRunner.startFlow({ master: true }, flow, inputValues);
}
if (!payload.projectId) {
    throw new Error("Flow start requires taskId, projectId, or master");
}
const owner: FlowOwner = { projectId: payload.projectId };
return await flowRunner.startFlow(owner, flow, inputValues);
```

**`packages/backend/src/services/flow-runner.ts`**:

- `startFlow()` (line 87): Change `owner.taskId ?? owner.projectId` to use a helper that returns `"__master__"` for master owner. Extract a private `getOwnerId(owner: FlowOwner): string` method.
- `ownerFromRun()` (line 348): Add `if (run.master) return { master: true };`
- `launchAction()` (line 410): Same ownerId extraction fix.
- `buildActionPrompt()` call (line 407): `!!owner.projectId` check — for master, this is false, which is correct (no project context in prompt).

**`packages/backend/src/index.ts`**:

- `spawnSession` callback (line 148): Add master branch:
  ```typescript
  const owner = opts.owner.taskId
      ? { taskId: opts.owner.taskId }
      : opts.owner.master
        ? { master: true as const }
        : { projectId: opts.owner.projectId };
  ```
- `getOwnerDescription` callback (line 173): Add master case returning `"Master workspace"`:
  ```typescript
  if (owner.master) return "Master workspace";
  ```

### 3. UI — Agent Commands Fetch

**`packages/ui/src/components/workspace/Workspace.tsx`** — agent commands effect:

Remove the early return when `scope === "master"`. Instead, for master scope, fetch with a flag that tells the backend to return only user-level commands (skip project scan).

**Backend deduplication**: The `AGENT_COMMANDS_LIST` handler scans both `join(path, ".claude", "commands")` and `~/.claude/commands`. When `path` is `$HOME`, these are the same directory, causing duplicates. Fix by skipping the project scan when `projectDir === userDir` in the handler.

### 4. UI — Workspace.tsx (master scope block)

Replace the hardcoded empty values in the master scope render block:

- Pass `agentCommands` (fetched in step 3)
- Pass `flowDefinitions` and `standaloneActions` (already filtered by `filterByProject` with `null` projectId — returns global-only items)
- Compute `showRunButton` dynamically: `agentCommands.length > 0 || standaloneActions.length > 0 || (flowRunsReady && flowDefinitions.length > 0)`
- Wire `onStartFlow` and `onRunAction` handlers for master scope

### 5. UI — Flow Runs Hydration for Master

**`packages/ui/src/components/workspace/Workspace.tsx`** — ownerId computation (line 101):

```typescript
// Current
const ownerId = taskId ?? workspace.project?.id;

// New — include master sentinel
const ownerId = taskId ?? workspace.project?.id ?? (workspace.scope === "master" ? "__master__" : undefined);
```

This ensures `fetchFlowRuns("__master__")` is called, `flowRunsReady` becomes true, and `activeFlowRun` is looked up correctly.

### 6. UI — Flow Start Handler

**`packages/ui/src/components/workspace/Workspace.tsx`** — `handleStartFlow`:

Add master scope branch:

```typescript
const owner = taskId
    ? { taskId, flowId }
    : workspace.project
      ? { projectId: workspace.project.id, flowId }
      : workspace.scope === "master"
        ? { master: true as const, flowId }
        : null;
```

**`packages/ui/src/stores/flow-store.ts`** — `FlowStartParams`:

Add `master?: true` field so the store can pass it to the backend.

### 7. Run Menu Visibility

Automatic — the Run button appears only when at least one menu section has items. Consistent with project workspace behavior.

## What Stays the Same

- **TabBar component**: No changes. Fully data-driven.
- **Session creation for `.claude` commands**: Already handles `{ master: true }` owner.
- **`showAgentOptions`**: Remains `false` for master (no task description).
- **`onRunScript`/`onRunTab`**: Remain no-ops for master.

## Risk

Low-medium. The flow owner extension touches several files but follows an established pattern. The agent commands deduplication is straightforward. Most UI wiring already exists.
