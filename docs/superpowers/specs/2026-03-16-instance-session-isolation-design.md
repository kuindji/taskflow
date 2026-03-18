# Instance-Aware Session Isolation

## Problem

When running multiple Taskflow instances (production + dev), terminal sessions interfere with each other:
- Zombie tabs appear from the other instance's sessions
- Working tabs disappear when the other instance starts up

Both instances share the same data directory (`~/.config/taskflow/`), reading and writing the same `projects.json` and `tasks/*.json` files. Session references are stamped with an `instance` field (added in `687053a`), but this field is not used to filter what each instance sees.

## Design

### 1. Filter sessions at backend read boundary

When the backend serves task/project data to the UI over WebSocket, filter `sessions` arrays to only include entries where `session.instance === config.instanceId`.

**File:** `packages/backend/src/services/task-store.ts`

- Extract a reusable helper (e.g., `filterSessionsByInstance(sessions, instanceId)`) that strips sessions not belonging to the current instance.
- Apply this filter in all methods that return task or project data to the UI.
- Sessions with no `instance` field (legacy orphans) are also filtered out.
- The raw JSON files on disk remain untouched — filtering is read-only.

**File:** `packages/backend/src/services/session-lifecycle.ts`

- After session creation/removal, the lifecycle service fetches the updated task/project and broadcasts it via `TASK_UPDATED`/`PROJECT_UPDATED`. These broadcast payloads must also be filtered using the same helper before being sent, otherwise the UI receives unfiltered data containing foreign-instance sessions as a live push event.

### 2. Simplify startup cleanup

The current `clearAllSessions(instanceId, purgeStale)` has a `purgeStale` mode where the production instance removes foreign sessions older than 24 hours. This can kill active dev sessions.

**Files:** `packages/backend/src/services/task-store.ts`, `packages/backend/src/index.ts`

- Remove the `purgeStale` parameter and its associated logic.
- `clearAllSessions(instanceId)` only removes sessions matching the given instanceId (own stale sessions from a previous run).
- Foreign-instance sessions are left untouched — they're invisible to the UI after the filtering in step 1, and will be cleaned up when that instance next restarts.

### 3. No UI changes needed

The UI's `syncWithTasks` rebuilds tabs from whatever sessions the backend provides. Since the backend now filters by instance, the UI naturally only sees its own sessions.

## Scope

- `packages/backend/src/services/task-store.ts` — Add `filterSessionsByInstance` helper; apply on read paths; simplify `clearAllSessions`
- `packages/backend/src/services/session-lifecycle.ts` — Filter broadcast payloads before sending `TASK_UPDATED`/`PROJECT_UPDATED`
- `packages/backend/src/index.ts` — Remove `purgeStale` argument from `clearAllSessions` call
