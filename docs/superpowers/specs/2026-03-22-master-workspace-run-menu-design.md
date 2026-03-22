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

**`packages/shared/src/types/flow.ts`** — Extend `FlowOwner`:

```typescript
// Before
type FlowOwner = { taskId: string } | { projectId: string }

// After
type FlowOwner = { taskId: string } | { projectId: string } | { master: true }
```

### 2. Backend — Flow Execution

**`packages/backend/src/handlers/flow.ts`** and related flow services — handle `{ master: true }` as a valid flow owner when starting and tracking flow runs.

### 3. UI — Workspace.tsx (master scope)

Remove guards that skip data fetching for master scope:

- **Agent commands fetch**: Remove the early return when `scope === "master"`. For master scope, send the request with the homedir path. The backend already scans `~/.claude/commands` as user-level commands alongside project-level ones — for master we only get user-level since homedir won't have a `.claude/commands` project directory.
- **Flows/actions**: Already fetched globally in the effect that runs on `workspace.project?.id`. When `projectId` is `undefined`, `filterByProject()` returns only global items (no `projectId`). Pass these to TabBar.
- **`showRunButton`**: Compute dynamically — `true` when any of: `agentCommands.length > 0`, `flowDefinitions.length > 0`, `standaloneActions.length > 0`.
- **Handlers**: Wire `onStartFlow` and `onRunAction` for master scope. `onRunAgentCommand` already works (uses `{ master: true }` owner).

### 4. UI — Workspace.tsx (flow start handler)

Extend `handleStartFlow` to construct `{ master: true }` owner when `workspace.scope === "master"`.

### 5. Run Menu Visibility

Automatic — the Run button appears only when at least one menu section has items. This is consistent with project workspace behavior.

## What Stays the Same

- **TabBar component**: No changes. It's fully data-driven — it renders whatever props it receives.
- **Session creation for `.claude` commands**: Already handles `{ master: true }` owner.
- **Flow store**: Already fetches all flows/actions globally.
- **`showAgentOptions`**: Remains `false` for master (no task description to run with).

## Risk

Low. Most plumbing exists. The work is removing master-scope guards, extending `FlowOwner`, and passing filtered data through.
