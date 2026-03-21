# Internal Scheduler System for Agents

## Overview

A cron-like scheduler for running agents on a timer. Schedules are project-bound, execute a specified prompt, and support cron and rate expressions. Agents signal completion via `taskflow-cli schedule complete`, after which the process is terminated.

## Data Model

### Schedule Record

```typescript
interface Schedule {
  id: string;                        // UUID
  projectId: string;                 // Project-bound
  name: string;                      // Display name (optional at creation, auto-generated from prompt)
  prompt: string;                    // The prompt to run
  agentType?: AgentType;             // Optional — uses system default if omitted
  agentOptions?: AgentLaunchOptions; // Model, fullAccess, etc.

  // Scheduling
  expression: string;                // Cron or rate expression
  expressionType: "cron" | "rate";   // Expression format
  timeout: number;                   // Minutes, default 30
  enabled: boolean;                  // Toggle on/off

  // State
  lastRunAt: string | null;          // ISO timestamp
  lastError: string | null;          // Last error message
  nextRunAt: string | null;          // Computed next execution time
  runningSessionId: string | null;   // Currently running session, null if idle

  createdAt: string;
  updatedAt: string;
}
```

### Expression Formats

**Cron:** Standard 5-field (`minute hour day month weekday`). Parsed with a cron parser library.

**Rate:** AWS-style `rate(N unit)` where unit is `minutes`, `hours`, or `days`. Examples: `rate(5 minutes)`, `rate(1 hour)`, `rate(2 days)`.

### Storage

`schedules.json` in the data directory (respects `data-location.json`, same as `projects.json`). Array of Schedule records. Uses the same mutation-queue pattern as TaskStore to prevent concurrent write corruption.

## Scheduler Service

### Architecture

`SchedulerService` is a standalone service that owns the full lifecycle: persistence, timer management, execution, and cleanup.

### Timer Management

Uses `setTimeout` for each schedule, set to fire at `nextRunAt`. No `setInterval` — always computed from the expression after each execution or skip. This ensures correct behavior after app restarts and expression changes.

### Execution Flow

1. Timer fires
2. Check `runningSessionId` — if set, skip this run (log "skipped, previous run still active")
3. If idle, call `SessionLifecycle.createSession()` with:
   - Project-level context (project's working directory)
   - The schedule's prompt, wrapped with system instructions
   - Agent type and options from the schedule
4. Set `runningSessionId` on the schedule, update `lastRunAt`
5. Start a timeout timer for the configured timeout duration

### Overlap Policy

Skip. If a previous run is still active when the next trigger fires, the trigger is skipped entirely.

### System Prompt Injection

The scheduler wraps the user's prompt with completion instructions:

```
You are running as a scheduled task. When you have completed your work, you MUST call the following command to signal completion:

taskflow-cli schedule complete

Do not exit without calling this command. If you encounter an error that prevents you from completing the task, still call this command — your error output will be captured.
```

Uses existing env vars `TASKFLOW_SESSION_ID` and `TASKFLOW_API_URL` already injected by SessionLifecycle.

### Completion

`taskflow-cli schedule complete` → `POST /api/schedule/complete`

1. Reads `TASKFLOW_SESSION_ID` from env
2. Backend matches session ID to a schedule's `runningSessionId`
3. Kills PTY process
4. Clears `runningSessionId` and `lastError`
5. Recalculates `nextRunAt`, sets next timer
6. Persists state and broadcasts `SCHEDULE_UPDATED`

### Timeout

If timeout fires before completion:
- Kill PTY process
- Set `lastError` to "Timed out after N minutes"
- Clear `runningSessionId`
- Recalculate `nextRunAt`, set next timer

### Unexpected Session Exit

If a running session dies without calling `schedule complete` (crash, OOM, etc.):
- Set `lastError` to exit reason
- Clear `runningSessionId`
- Recalculate next timer

## Startup Behavior

1. Load all schedules from `schedules.json`
2. For each enabled schedule, compute `nextRunAt` from expression
3. If `nextRunAt` is in the past (app was offline) → run immediately
4. If `runningSessionId` is set but no matching PTY exists (stale from crash) → clear it, treat as missed run
5. Set timers for all enabled schedules

## Shutdown Behavior

1. Cancel all timers
2. Kill any running scheduled sessions (ephemeral, not user-initiated)
3. Persist current state to `schedules.json`

## API

### WebSocket Messages

| Message | Direction | Purpose |
|---------|-----------|---------|
| `SCHEDULE_LIST` | request/response | List schedules, optionally filtered by projectId |
| `SCHEDULE_CREATE` | request/response | Create a new schedule |
| `SCHEDULE_UPDATE` | request/response | Update schedule fields |
| `SCHEDULE_DELETE` | request/response | Delete a schedule |
| `SCHEDULE_UPDATED` | broadcast | Notify clients of schedule state changes |

### REST Endpoint

| Endpoint | Purpose |
|----------|---------|
| `POST /api/schedule/complete` | Called by `taskflow-cli` to signal agent completion |

### CLI Command

`taskflow-cli schedule complete` — reads `TASKFLOW_SESSION_ID` from env, POSTs to the completion endpoint.

## UI

### Entry Points

- Toolbar button alongside settings/appearance/flows
- System menu item

### Schedule Management Dialog

Card-based list layout:
- **Project filter dropdown** at top ("All Projects" or specific project)
- **"+ New" button** to create a schedule
- **Card per schedule** showing:
  - Name
  - Expression (cron/rate)
  - Last run time (relative)
  - Status indicator (idle/running/error)
  - Enabled/disabled toggle switch
  - Actions menu (edit, delete, run now)
- When "All Projects" is selected, each card shows its project name

### Create/Edit Form

Fields:
- **Project** — selector (pre-filled if opened from a project context)
- **Name** — optional text input, auto-generated from prompt if omitted
- **Prompt** — textarea
- **Schedule** — cron/rate toggle with expression input. Live "next run" preview below the input
- **Agent** — type selector, defaults to system default
- **Timeout** — number input in minutes, default 30

Same form is used for both create and edit (pre-populated in edit mode).

## File Structure

### Backend
- `packages/backend/src/services/schedule-store.ts` — persistence (JSON file I/O, mutation queue)
- `packages/backend/src/services/scheduler-service.ts` — timer management, execution, completion, timeout
- `packages/backend/src/handlers/schedule.ts` — WebSocket handler for CRUD operations

### Shared
- `packages/shared/src/types/schedule.ts` — Schedule type, request/response types
- Update `packages/shared/src/types/ws.ts` — add SCHEDULE_* message constants
- Update `packages/shared/src/index.ts` — export schedule types

### UI
- `packages/ui/src/stores/schedule-store.ts` — Zustand store for schedule state
- `packages/ui/src/components/ScheduleDialog.tsx` — management dialog (list + form)

### CLI
- Update taskflow-cli to add `schedule complete` command

### Electron
- Update menu to add Schedules item
- Update toolbar to add Schedules button
