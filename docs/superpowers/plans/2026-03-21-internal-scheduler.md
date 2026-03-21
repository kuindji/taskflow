# Internal Scheduler System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a cron-like scheduler that runs agents on a timer, with a management UI dialog, project-scoped schedules, and CLI completion signaling.

**Architecture:** Standalone `SchedulerService` + `ScheduleStore` for persistence. Reuses `SessionLifecycle` for agent spawning. Card-based management dialog in UI. CLI extension for agent completion signaling.

**Tech Stack:** TypeScript, Bun, Zustand, React, shadcn/ui components, cron-parser library

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `packages/shared/src/types/schedule.ts` | Schedule type, WS payload types |
| `packages/backend/src/services/schedule-store.ts` | JSON persistence with mutation queue |
| `packages/backend/src/services/scheduler-service.ts` | Timer management, execution, completion, timeout |
| `packages/backend/src/handlers/schedule.ts` | WebSocket handler for CRUD |
| `packages/ui/src/stores/schedule-store.ts` | Zustand store + broadcast listener |
| `packages/ui/src/components/schedules/ScheduleManagementDialog.tsx` | Management dialog (list + form) |
| `packages/ui/src/components/schedules/ScheduleForm.tsx` | Create/edit form |

### Modified Files
| File | Change |
|------|--------|
| `packages/shared/src/constants.ts` | Add `SCHEDULE_*` MSG constants |
| `packages/shared/src/index.ts` | Export schedule types |
| `packages/backend/src/config.ts` | Add `schedulesFile` to `buildDataPaths()` |
| `packages/backend/src/index.ts` | Initialize ScheduleStore + SchedulerService, register handlers |
| `packages/backend/src/api/routes.ts` | Add `POST /api/schedules/complete` endpoint |
| `packages/backend/src/services/taskflow-cli.sh` | Add `schedule complete` command |
| `packages/ui/src/stores/ui-store.ts` | Add `scheduleManagementOpen` + toggle |
| `packages/ui/src/App.tsx` | Mount `ScheduleManagementDialog` |
| `packages/ui/src/components/sidebar/TaskSidebar.tsx` | Add Schedules toolbar button |
| `packages/ui/src/components/workspace/Workspace.tsx` | Wire `onOpenSchedules` IPC |
| `electron/src/preload.ts` | Add `onOpenSchedules` bridge |
| `electron/src/main.ts` | Add Schedules menu item |

---

## Task 1: Shared Types & Constants

**Files:**
- Create: `packages/shared/src/types/schedule.ts`
- Modify: `packages/shared/src/constants.ts:89` (after FLOW_RUN_UPDATED)
- Modify: `packages/shared/src/index.ts:9` (after flow export)

- [ ] **Step 1: Create schedule types**

Create `packages/shared/src/types/schedule.ts`:

```typescript
import type { AgentLaunchOptions, AgentType } from "./agent";

interface Schedule {
    id: string;
    projectId: string;
    name: string;
    prompt: string;
    agentType?: AgentType;
    agentOptions?: AgentLaunchOptions;

    expression: string;
    expressionType: "cron" | "rate";
    timeout: number;
    enabled: boolean;

    lastRunAt: string | null;
    lastError: string | null;
    nextRunAt: string | null;
    runningSessionId: string | null;

    createdAt: string;
    updatedAt: string;
}

// --- Handler payload types ---

interface ScheduleCreatePayload {
    projectId: string;
    name?: string;
    prompt: string;
    agentType?: AgentType;
    agentOptions?: AgentLaunchOptions;
    expression: string;
    expressionType: "cron" | "rate";
    timeout?: number;
    enabled?: boolean;
}

interface ScheduleUpdatePayload {
    id: string;
    name?: string;
    prompt?: string;
    agentType?: AgentType | null;
    agentOptions?: AgentLaunchOptions | null;
    expression?: string;
    expressionType?: "cron" | "rate";
    timeout?: number;
    enabled?: boolean;
}

interface ScheduleDeletePayload {
    id: string;
}

interface ScheduleListPayload {
    projectId?: string;
}

interface ScheduleTriggerPayload {
    id: string;
}

export type {
    Schedule,
    ScheduleCreatePayload,
    ScheduleUpdatePayload,
    ScheduleDeletePayload,
    ScheduleListPayload,
    ScheduleTriggerPayload,
};
```

- [ ] **Step 2: Add MSG constants**

In `packages/shared/src/constants.ts`, after `FLOW_RUN_UPDATED: "flow:run-updated",` (line 89), add:

```typescript
    // Schedules
    SCHEDULE_LIST: "schedule:list",
    SCHEDULE_CREATE: "schedule:create",
    SCHEDULE_UPDATE: "schedule:update",
    SCHEDULE_DELETE: "schedule:delete",
    SCHEDULE_TRIGGER: "schedule:trigger",
    SCHEDULE_UPDATED: "schedule:updated",
```

- [ ] **Step 3: Export schedule types**

In `packages/shared/src/index.ts`, after `export * from "./types/flow";` (line 9), add:

```typescript
export * from "./types/schedule";
```

- [ ] **Step 4: Verify build**

Run: `cd packages/shared && bun run build`
Expected: Clean build, no errors

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/types/schedule.ts packages/shared/src/constants.ts packages/shared/src/index.ts
git commit -m "feat(shared): add schedule types and MSG constants"
```

---

## Task 2: Backend Config — Add schedulesFile Path

**Files:**
- Modify: `packages/backend/src/config.ts:23-35` (buildDataPaths)

- [ ] **Step 1: Add schedulesFile to buildDataPaths**

In `packages/backend/src/config.ts`, in `buildDataPaths()` (line 23-35), add after `flowRunsDir`:

```typescript
        schedulesFile: join(dataDir, "schedules.json"),
```

The full function becomes:
```typescript
function buildDataPaths(dataDir: string) {
    return {
        dataDir,
        projectsFile: join(dataDir, "projects.json"),
        tasksDir: join(dataDir, "tasks"),
        archiveDir: join(dataDir, "archive"),
        taskLogsDir: join(dataDir, "task-logs"),
        agentSkillsDir: join(dataDir, "agent-skills"),
        themesDir: join(dataDir, "themes"),
        flowsDir: join(dataDir, "flows"),
        flowRunsDir: join(dataDir, "flow-runs"),
        schedulesFile: join(dataDir, "schedules.json"),
    };
}
```

Note: `schedulesFile` is a single file path (not a directory), so no `ensureDirectories()` entry needed — the store creates the file on first write.

- [ ] **Step 2: Verify build**

Run: `cd packages/backend && bun run build`
Expected: Clean build

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/config.ts
git commit -m "feat(backend): add schedulesFile to config data paths"
```

---

## Task 3: Schedule Store (Backend Persistence)

**Files:**
- Create: `packages/backend/src/services/schedule-store.ts`

- [ ] **Step 1: Create ScheduleStore**

Create `packages/backend/src/services/schedule-store.ts`. Follows `FlowStore` pattern with `withMutation()` queue and `readJsonFile()` helper.

```typescript
import { readFile, writeFile } from "fs/promises";
import type { Schedule } from "@taskflow/shared";

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
    return error instanceof Error && "code" in error && error.code === "ENOENT";
}

class ScheduleStore {
    private mutations = new Map<string, Promise<void>>();

    constructor(private schedulesFile: string) {}

    async getAll(): Promise<Schedule[]> {
        return (await this.readJsonFile<Schedule[]>(this.schedulesFile)) ?? [];
    }

    async getById(id: string): Promise<Schedule | null> {
        const schedules = await this.getAll();
        return schedules.find((s) => s.id === id) ?? null;
    }

    async findBySessionId(sessionId: string): Promise<Schedule | null> {
        const schedules = await this.getAll();
        return schedules.find((s) => s.runningSessionId === sessionId) ?? null;
    }

    async save(schedule: Schedule): Promise<void> {
        await this.withMutation("schedules", async () => {
            const schedules = await this.getAll();
            const index = schedules.findIndex((s) => s.id === schedule.id);
            if (index >= 0) {
                schedules[index] = schedule;
            } else {
                schedules.push(schedule);
            }
            await writeFile(this.schedulesFile, JSON.stringify(schedules, null, 2));
        });
    }

    async delete(id: string): Promise<void> {
        await this.withMutation("schedules", async () => {
            const schedules = await this.getAll();
            const filtered = schedules.filter((s) => s.id !== id);
            await writeFile(this.schedulesFile, JSON.stringify(filtered, null, 2));
        });
    }

    async update(id: string, updater: (schedule: Schedule) => Schedule): Promise<Schedule> {
        return await this.withMutation("schedules", async () => {
            const schedules = await this.getAll();
            const index = schedules.findIndex((s) => s.id === id);
            if (index < 0) throw new Error(`Schedule not found: ${id}`);
            schedules[index] = updater(schedules[index]);
            await writeFile(this.schedulesFile, JSON.stringify(schedules, null, 2));
            return schedules[index];
        });
    }

    private async readJsonFile<T>(filePath: string): Promise<T | null> {
        let data: string;
        try {
            data = await readFile(filePath, "utf-8");
        } catch (error) {
            if (isMissingFileError(error)) {
                return null;
            }
            throw error;
        }
        return JSON.parse(data) as T;
    }

    private async withMutation<T>(key: string, mutation: () => Promise<T>): Promise<T> {
        const previous = this.mutations.get(key) ?? Promise.resolve();
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const queued = previous.catch(() => undefined).then(() => gate);
        this.mutations.set(key, queued);
        await previous.catch(() => undefined);
        try {
            return await mutation();
        } finally {
            release();
            if (this.mutations.get(key) === queued) {
                this.mutations.delete(key);
            }
        }
    }
}

export { ScheduleStore };
```

- [ ] **Step 2: Verify build**

Run: `cd packages/backend && bun run build`
Expected: Clean build

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/services/schedule-store.ts
git commit -m "feat(backend): add ScheduleStore for schedule persistence"
```

---

## Task 4: Install cron-parser Library

**Files:**
- Modify: `package.json` (root or backend)

- [ ] **Step 1: Install cron-parser**

Run: `cd /path/to/project && bun add cron-parser`

Check which `package.json` manages backend deps — if backend has its own, install there:
Run: `cd packages/backend && bun add cron-parser`

If the monorepo uses hoisted deps, install at root instead: `bun add cron-parser`

- [ ] **Step 2: Verify import**

Run: `bun -e "import { parseExpression } from 'cron-parser'; console.log(parseExpression('0 9 * * *').next().toISOString())"`
Expected: Prints next occurrence of 9 AM

- [ ] **Step 3: Commit**

```bash
git add packages/backend/package.json bun.lockb
git commit -m "feat: add cron-parser dependency"
```

Note: If installed at root, `git add package.json bun.lockb` instead.

---

## Task 5: Scheduler Service (Core Logic)

**Files:**
- Create: `packages/backend/src/services/scheduler-service.ts`

This is the largest task. The service manages timers, executes schedules, handles completion/timeout/crash.

- [ ] **Step 1: Create SchedulerService**

Create `packages/backend/src/services/scheduler-service.ts`:

```typescript
import { parseExpression } from "cron-parser";
import type { Schedule, WsEvent } from "@taskflow/shared";
import { MSG } from "@taskflow/shared";
import type { ScheduleStore } from "./schedule-store";

interface SchedulerDeps {
    scheduleStore: ScheduleStore;
    spawnSession: (schedule: Schedule) => Promise<string>;
    closeSession: (sessionId: string) => void;
    broadcast: (event: WsEvent) => void;
}

const SYSTEM_PROMPT_ADDON = `You are running as a scheduled task. When you have completed your work, you MUST call the following command to signal completion:

taskflow-cli schedule complete

Do not exit without calling this command. If you encounter an error that prevents you from completing the task, still call this command — your error output will be captured.`;

function parseRateExpression(expression: string): number {
    const match = expression.match(/^rate\((\d+)\s+(minutes?|hours?|days?)\)$/i);
    if (!match) throw new Error(`Invalid rate expression: ${expression}`);
    const value = parseInt(match[1], 10);
    const unit = match[2].toLowerCase().replace(/s$/, "");
    switch (unit) {
        case "minute":
            return value * 60 * 1000;
        case "hour":
            return value * 60 * 60 * 1000;
        case "day":
            return value * 24 * 60 * 60 * 1000;
        default:
            throw new Error(`Unknown rate unit: ${unit}`);
    }
}

function computeNextRun(schedule: Schedule): Date {
    if (schedule.expressionType === "cron") {
        const interval = parseExpression(schedule.expression);
        return interval.next().toDate();
    }
    const intervalMs = parseRateExpression(schedule.expression);
    const base = schedule.lastRunAt ? new Date(schedule.lastRunAt) : new Date();
    return new Date(base.getTime() + intervalMs);
}

class SchedulerService {
    private timers = new Map<string, ReturnType<typeof setTimeout>>();
    private timeoutTimers = new Map<string, ReturnType<typeof setTimeout>>();
    private deps: SchedulerDeps;

    constructor(deps: SchedulerDeps) {
        this.deps = deps;
    }

    async init(): Promise<void> {
        const schedules = await this.deps.scheduleStore.getAll();
        for (const schedule of schedules) {
            if (schedule.runningSessionId) {
                // Stale from crash — clear it
                await this.deps.scheduleStore.update(schedule.id, (s) => ({
                    ...s,
                    runningSessionId: null,
                    lastError: "Previous run did not complete (app restarted)",
                    updatedAt: new Date().toISOString(),
                }));
            }
            if (schedule.enabled) {
                await this.scheduleNext(schedule.id);
            }
        }
    }

    async scheduleNext(scheduleId: string): Promise<void> {
        this.clearTimer(scheduleId);
        const schedule = await this.deps.scheduleStore.getById(scheduleId);
        if (!schedule || !schedule.enabled) return;

        const nextRun = computeNextRun(schedule);
        const now = new Date();
        const delay = Math.max(0, nextRun.getTime() - now.getTime());

        // Update nextRunAt
        await this.deps.scheduleStore.update(scheduleId, (s) => ({
            ...s,
            nextRunAt: nextRun.toISOString(),
            updatedAt: new Date().toISOString(),
        }));

        if (delay === 0) {
            // Missed run — execute immediately
            void this.execute(scheduleId);
        } else {
            this.timers.set(
                scheduleId,
                setTimeout(() => {
                    void this.execute(scheduleId);
                }, delay),
            );
        }
    }

    private async execute(scheduleId: string): Promise<void> {
        const schedule = await this.deps.scheduleStore.getById(scheduleId);
        if (!schedule || !schedule.enabled) return;

        if (schedule.runningSessionId) {
            console.log(`[scheduler] Skipping "${schedule.name}" — previous run still active`);
            await this.scheduleNext(scheduleId);
            return;
        }

        try {
            const sessionId = await this.deps.spawnSession(schedule);

            this.runningSessions.set(scheduleId, sessionId);

            await this.deps.scheduleStore.update(scheduleId, (s) => ({
                ...s,
                runningSessionId: sessionId,
                lastRunAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            }));

            // Start timeout timer
            this.timeoutTimers.set(
                scheduleId,
                setTimeout(() => {
                    void this.handleTimeout(scheduleId);
                }, schedule.timeout * 60 * 1000),
            );

            this.broadcastUpdate(scheduleId);
        } catch (error) {
            const message = error instanceof Error ? error.message : "Unknown error";
            await this.deps.scheduleStore.update(scheduleId, (s) => ({
                ...s,
                lastError: `Failed to start: ${message}`,
                updatedAt: new Date().toISOString(),
            }));
            this.broadcastUpdate(scheduleId);
            await this.scheduleNext(scheduleId);
        }
    }

    async handleComplete(sessionId: string): Promise<void> {
        const schedule = await this.deps.scheduleStore.findBySessionId(sessionId);
        if (!schedule) return;

        this.clearTimeoutTimer(schedule.id);
        this.runningSessions.delete(schedule.id);
        this.deps.closeSession(sessionId);

        await this.deps.scheduleStore.update(schedule.id, (s) => ({
            ...s,
            runningSessionId: null,
            lastError: null,
            updatedAt: new Date().toISOString(),
        }));

        this.broadcastUpdate(schedule.id);
        await this.scheduleNext(schedule.id);
    }

    async handleSessionExit(sessionId: string, exitCode: number): Promise<void> {
        const schedule = await this.deps.scheduleStore.findBySessionId(sessionId);
        if (!schedule) return;

        this.clearTimeoutTimer(schedule.id);
        this.runningSessions.delete(schedule.id);

        await this.deps.scheduleStore.update(schedule.id, (s) => ({
            ...s,
            runningSessionId: null,
            lastError: `Agent exited unexpectedly (code ${exitCode})`,
            updatedAt: new Date().toISOString(),
        }));

        this.broadcastUpdate(schedule.id);
        await this.scheduleNext(schedule.id);
    }

    private async handleTimeout(scheduleId: string): Promise<void> {
        const schedule = await this.deps.scheduleStore.getById(scheduleId);
        if (!schedule || !schedule.runningSessionId) return;

        this.runningSessions.delete(scheduleId);
        this.deps.closeSession(schedule.runningSessionId);

        await this.deps.scheduleStore.update(scheduleId, (s) => ({
            ...s,
            runningSessionId: null,
            lastError: `Timed out after ${s.timeout} minutes`,
            updatedAt: new Date().toISOString(),
        }));

        this.broadcastUpdate(scheduleId);
        await this.scheduleNext(scheduleId);
    }

    async onScheduleCreated(scheduleId: string): Promise<void> {
        const schedule = await this.deps.scheduleStore.getById(scheduleId);
        if (schedule?.enabled) {
            await this.scheduleNext(scheduleId);
        }
    }

    async onScheduleUpdated(scheduleId: string): Promise<void> {
        this.clearTimer(scheduleId);
        this.clearTimeoutTimer(scheduleId);
        const schedule = await this.deps.scheduleStore.getById(scheduleId);
        if (schedule?.enabled && !schedule.runningSessionId) {
            await this.scheduleNext(scheduleId);
        }
    }

    async onScheduleDeleted(scheduleId: string, runningSessionId: string | null): Promise<void> {
        this.clearTimer(scheduleId);
        this.clearTimeoutTimer(scheduleId);
        if (runningSessionId) {
            this.deps.closeSession(runningSessionId);
        }
    }

    async triggerNow(scheduleId: string): Promise<void> {
        const schedule = await this.deps.scheduleStore.getById(scheduleId);
        if (!schedule) throw new Error(`Schedule not found: ${scheduleId}`);
        if (schedule.runningSessionId) throw new Error("Schedule is already running");
        this.clearTimer(scheduleId);
        await this.execute(scheduleId);
    }

    /** Track running session IDs in memory for synchronous shutdown. */
    private runningSessions = new Map<string, string>(); // scheduleId → sessionId

    shutdown(): void {
        for (const [id] of this.timers) {
            this.clearTimer(id);
        }
        for (const [id] of this.timeoutTimers) {
            this.clearTimeoutTimer(id);
        }
        // Kill all running scheduled sessions (ephemeral, not user-initiated)
        for (const [, sessionId] of this.runningSessions) {
            this.deps.closeSession(sessionId);
        }
        this.runningSessions.clear();
    }

    private clearTimer(id: string): void {
        const timer = this.timers.get(id);
        if (timer) {
            clearTimeout(timer);
            this.timers.delete(id);
        }
    }

    private clearTimeoutTimer(id: string): void {
        const timer = this.timeoutTimers.get(id);
        if (timer) {
            clearTimeout(timer);
            this.timeoutTimers.delete(id);
        }
    }

    private async broadcastUpdate(scheduleId: string): Promise<void> {
        const schedule = await this.deps.scheduleStore.getById(scheduleId);
        if (schedule) {
            this.deps.broadcast({ type: MSG.SCHEDULE_UPDATED, payload: schedule });
        }
    }
}

export { SchedulerService, SYSTEM_PROMPT_ADDON, computeNextRun, parseRateExpression };
```

- [ ] **Step 2: Verify build**

Run: `cd packages/backend && bun run build`
Expected: Clean build

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/services/scheduler-service.ts
git commit -m "feat(backend): add SchedulerService with timer management and execution"
```

---

## Task 6: WebSocket Handler for Schedules

**Files:**
- Create: `packages/backend/src/handlers/schedule.ts`

- [ ] **Step 1: Create schedule handler**

Create `packages/backend/src/handlers/schedule.ts` following the pattern from `handlers/flow.ts`:

```typescript
import { randomUUID } from "crypto";
import { MSG } from "@taskflow/shared";
import type {
    Schedule,
    ScheduleCreatePayload,
    ScheduleUpdatePayload,
    ScheduleDeletePayload,
    ScheduleListPayload,
    ScheduleTriggerPayload,
} from "@taskflow/shared";
import type { Router } from "../ws/router";
import type { ScheduleStore } from "../services/schedule-store";
import type { SchedulerService } from "../services/scheduler-service";

interface ScheduleHandlerDeps {
    router: Router;
    scheduleStore: ScheduleStore;
    schedulerService: SchedulerService;
    generateName: (prompt: string) => Promise<string>;
}

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- T narrows payload inside each handler callback
function typed<T>(
    handler: (payload: T) => Promise<unknown>,
): (payload: unknown) => Promise<unknown> {
    return handler as (payload: unknown) => Promise<unknown>;
}

function registerScheduleHandlers(deps: ScheduleHandlerDeps): void {
    const { router, scheduleStore, schedulerService, generateName } = deps;

    router.register(
        MSG.SCHEDULE_LIST,
        typed<ScheduleListPayload>(async (payload) => {
            const schedules = await scheduleStore.getAll();
            if (payload.projectId) {
                return { schedules: schedules.filter((s) => s.projectId === payload.projectId) };
            }
            return { schedules };
        }),
    );

    router.register(
        MSG.SCHEDULE_CREATE,
        typed<ScheduleCreatePayload>(async (payload) => {
            const now = new Date().toISOString();
            let name = payload.name?.trim() || "";
            if (!name) {
                name = await generateName(payload.prompt);
            }

            const schedule: Schedule = {
                id: randomUUID(),
                projectId: payload.projectId,
                name,
                prompt: payload.prompt,
                agentType: payload.agentType,
                agentOptions: payload.agentOptions,
                expression: payload.expression,
                expressionType: payload.expressionType,
                timeout: payload.timeout ?? 30,
                enabled: payload.enabled ?? true,
                lastRunAt: null,
                lastError: null,
                nextRunAt: null,
                runningSessionId: null,
                createdAt: now,
                updatedAt: now,
            };

            await scheduleStore.save(schedule);
            await schedulerService.onScheduleCreated(schedule.id);
            return schedule;
        }),
    );

    router.register(
        MSG.SCHEDULE_UPDATE,
        typed<ScheduleUpdatePayload>(async (payload) => {
            const updated = await scheduleStore.update(payload.id, (existing) => {
                const result = { ...existing, updatedAt: new Date().toISOString() };
                if (payload.name !== undefined) result.name = payload.name;
                if (payload.prompt !== undefined) result.prompt = payload.prompt;
                if (payload.expression !== undefined) result.expression = payload.expression;
                if (payload.expressionType !== undefined)
                    result.expressionType = payload.expressionType;
                if (payload.timeout !== undefined) result.timeout = payload.timeout;
                if (payload.enabled !== undefined) result.enabled = payload.enabled;
                if (payload.agentType !== undefined)
                    result.agentType = payload.agentType ?? undefined;
                if (payload.agentOptions !== undefined)
                    result.agentOptions = payload.agentOptions ?? undefined;
                return result;
            });
            await schedulerService.onScheduleUpdated(payload.id);
            return updated;
        }),
    );

    router.register(
        MSG.SCHEDULE_DELETE,
        typed<ScheduleDeletePayload>(async (payload) => {
            const schedule = await scheduleStore.getById(payload.id);
            if (!schedule) throw new Error(`Schedule not found: ${payload.id}`);
            await scheduleStore.delete(payload.id);
            await schedulerService.onScheduleDeleted(payload.id, schedule.runningSessionId);
            return { success: true };
        }),
    );

    router.register(
        MSG.SCHEDULE_TRIGGER,
        typed<ScheduleTriggerPayload>(async (payload) => {
            await schedulerService.triggerNow(payload.id);
            return { success: true };
        }),
    );
}

export { registerScheduleHandlers };
export type { ScheduleHandlerDeps };
```

- [ ] **Step 2: Verify build**

Run: `cd packages/backend && bun run build`
Expected: Clean build

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/handlers/schedule.ts
git commit -m "feat(backend): add WebSocket handler for schedule CRUD"
```

---

## Task 7: REST API Endpoint + CLI Command

**Files:**
- Modify: `packages/backend/src/api/routes.ts:429` (after flow action-complete)
- Modify: `packages/backend/src/services/taskflow-cli.sh:219` (after action complete case)

- [ ] **Step 1: Add REST endpoint**

In `packages/backend/src/api/routes.ts`, after the flow action-complete block (around line 429), add:

```typescript
    // --- Schedule completion ---

    apiRouter.register("POST", "/api/schedules/complete", async (req) => {
        let body: Record<string, unknown>;
        try {
            body = (await req.json()) as Record<string, unknown>;
        } catch {
            return errorResponse("Invalid JSON body", 400);
        }

        const { sessionId } = body;
        if (typeof sessionId !== "string") {
            return errorResponse("sessionId is required as a string", 400);
        }

        try {
            await schedulerService.handleComplete(sessionId);
            return jsonResponse({ success: true });
        } catch (err) {
            const message = err instanceof Error ? err.message : "Unknown error";
            return errorResponse(message, 500);
        }
    });
```

Also update `ApiRouteDeps` interface to include `schedulerService`:
```typescript
    schedulerService: { handleComplete: (sessionId: string) => Promise<void> };
```

- [ ] **Step 2: Add CLI command**

In `packages/backend/src/services/taskflow-cli.sh`, before the `agent)` case (around line 335), add a new case:

```bash
  schedule)
    if [ "${1:-}" = "complete" ]; then
      if [ -z "$TASKFLOW_SESSION_ID" ]; then
        echo "Error: TASKFLOW_SESSION_ID is not set" >&2
        exit 1
      fi
      payload=$(printf '{"sessionId":%s}' "$(json_string "$TASKFLOW_SESSION_ID")")
      curl -sf -X POST "$TASKFLOW_API_URL/api/schedules/complete" \
        -H "Content-Type: application/json" \
        -d "$payload"
    else
      echo "Usage: taskflow-cli schedule complete" >&2
      exit 1
    fi
    ;;
```

Also update the help text at the bottom (around line 407) to include:
```bash
    echo "  schedule complete                               Signal scheduled task completion" >&2
```

- [ ] **Step 3: Verify build**

Run: `cd packages/backend && bun run build`
Expected: Clean build

- [ ] **Step 4: Commit**

```bash
git add packages/backend/src/api/routes.ts packages/backend/src/services/taskflow-cli.sh
git commit -m "feat(backend): add schedule complete REST endpoint and CLI command"
```

---

## Task 8: Wire Up Backend — Initialize Services

**Files:**
- Modify: `packages/backend/src/index.ts`

- [ ] **Step 1: Import new modules**

At the top of `packages/backend/src/index.ts`, add imports (after the FlowRunner import on line 29):

```typescript
import { ScheduleStore } from "./services/schedule-store";
import { SchedulerService, SYSTEM_PROMPT_ADDON } from "./services/scheduler-service";
import { registerScheduleHandlers } from "./handlers/schedule";
import { buildShellPath } from "./services/shell-path";
```

- [ ] **Step 2: Initialize ScheduleStore and SchedulerService**

After the `flowRunner` initialization block (around line 128), add:

```typescript
        const scheduleStore = new ScheduleStore(config.schedulesFile);

        const schedulerService = new SchedulerService({
            scheduleStore,
            spawnSession: async (schedule) => {
                return sessionLifecycle.createSession({
                    owner: { projectId: schedule.projectId },
                    type: schedule.agentType ?? "claude",
                    label: `[Scheduled] ${schedule.name}`,
                    prompt: schedule.prompt,
                    systemPrompt: SYSTEM_PROMPT_ADDON,
                    agentOptions: schedule.agentOptions,
                    onSessionExited: (sessionId, exitCode) => {
                        void schedulerService.handleSessionExit(sessionId, exitCode);
                    },
                });
            },
            closeSession: (sessionId) => {
                ptyManager.close(sessionId);
            },
            broadcast: server.broadcast,
        });
```

- [ ] **Step 3: Register handlers**

After `registerFlowHandlers(...)` (line 194), add:

```typescript
        registerScheduleHandlers({
            router,
            scheduleStore,
            schedulerService,
            generateName: async (prompt) => {
                // Use the same claude haiku approach as TitleGenerator
                try {
                    const { CLAUDECODE: _a, CLAUDE_CODE_ENTRYPOINT: _b, ...cleanEnv } = process.env;
                    const aiPrompt = `Generate a concise schedule name (3-7 words) for this scheduled task prompt. Output ONLY the name, nothing else. No quotes, no punctuation at the end.\n\nPrompt: ${prompt}`;
                    const proc = Bun.spawn(["claude", "-p", "--model", "haiku"], {
                        stdin: "pipe",
                        stdout: "pipe",
                        stderr: "pipe",
                        env: { ...cleanEnv, PATH: buildShellPath() },
                    });
                    void proc.stdin.write(aiPrompt);
                    void proc.stdin.end();
                    const output = await new Response(proc.stdout).text();
                    const exitCode = await proc.exited;
                    if (exitCode === 0 && output.trim()) {
                        return output.trim().replace(/^["']|["']$/g, "");
                    }
                } catch {
                    // Fall through to fallback
                }
                return prompt.slice(0, 50).trim() || "Unnamed schedule";
            },
        });
```

- [ ] **Step 4: Add schedulerService to registerApiRoutes**

Update the `registerApiRoutes(...)` call to include `schedulerService`:

```typescript
        registerApiRoutes({
            // ... existing deps ...
            schedulerService,
        });
```

- [ ] **Step 5: Initialize scheduler after server start**

After `console.log(\`Taskflow backend running on port...\`)` (around line 244), add:

```typescript
        await schedulerService.init();
```

- [ ] **Step 6: Add to shutdown**

In the `shutdown` function (around line 263), add before `ptyManager.closeAll()`:

```typescript
            schedulerService.shutdown();
```

- [ ] **Step 7: Verify build**

Run: `cd packages/backend && bun run build`
Expected: Clean build

- [ ] **Step 8: Commit**

```bash
git add packages/backend/src/index.ts
git commit -m "feat(backend): wire up ScheduleStore and SchedulerService"
```

---

## Task 9: UI Store for Schedules

**Files:**
- Create: `packages/ui/src/stores/schedule-store.ts`
- Modify: `packages/ui/src/stores/ui-store.ts`

- [ ] **Step 1: Add UI store toggle**

In `packages/ui/src/stores/ui-store.ts`:

Add to `UIStore` interface (after `flowManagementOpen` on line 35):
```typescript
    scheduleManagementOpen: boolean;
```

Add to interface methods (after `toggleFlowManagement` on line 50):
```typescript
    toggleScheduleManagement(): void;
```

Add initial state (after `flowManagementOpen: false,` on line 79):
```typescript
    scheduleManagementOpen: false,
```

Add method (after `toggleFlowManagement` on line 102-104):
```typescript
    toggleScheduleManagement() {
        set((s) => ({ scheduleManagementOpen: !s.scheduleManagementOpen }));
    },
```

- [ ] **Step 2: Create schedule Zustand store**

Create `packages/ui/src/stores/schedule-store.ts`:

```typescript
import { create } from "zustand";
import type { Schedule, ScheduleCreatePayload, ScheduleUpdatePayload } from "@taskflow/shared";
import { MSG } from "@taskflow/shared";
import { sendRequest, onEvent } from "../hooks/useWebSocket";

interface ScheduleStore {
    schedules: Schedule[];
    loading: boolean;

    fetchSchedules(projectId?: string): Promise<void>;
    createSchedule(payload: ScheduleCreatePayload): Promise<Schedule>;
    updateSchedule(payload: ScheduleUpdatePayload): Promise<Schedule>;
    deleteSchedule(id: string): Promise<void>;
    triggerSchedule(id: string): Promise<void>;

    applyUpdate(schedule: Schedule): void;
}

const useScheduleStore = create<ScheduleStore>((set) => ({
    schedules: [],
    loading: false,

    async fetchSchedules(projectId) {
        set({ loading: true });
        try {
            const { schedules } = await sendRequest<{ schedules: Schedule[] }>(
                MSG.SCHEDULE_LIST,
                { projectId },
            );
            set({ schedules });
        } finally {
            set({ loading: false });
        }
    },

    async createSchedule(payload) {
        const schedule = await sendRequest<Schedule>(MSG.SCHEDULE_CREATE, payload);
        set((s) => ({ schedules: [...s.schedules, schedule] }));
        return schedule;
    },

    async updateSchedule(payload) {
        const updated = await sendRequest<Schedule>(MSG.SCHEDULE_UPDATE, payload);
        set((s) => ({
            schedules: s.schedules.map((sc) => (sc.id === updated.id ? updated : sc)),
        }));
        return updated;
    },

    async deleteSchedule(id) {
        await sendRequest(MSG.SCHEDULE_DELETE, { id });
        set((s) => ({ schedules: s.schedules.filter((sc) => sc.id !== id) }));
    },

    async triggerSchedule(id) {
        await sendRequest(MSG.SCHEDULE_TRIGGER, { id });
    },

    applyUpdate(schedule) {
        set((s) => ({
            schedules: s.schedules.map((sc) => (sc.id === schedule.id ? schedule : sc)),
        }));
    },
}));

// Module-level event listener for schedule updates (same pattern as flow-store.ts)
const _unsubScheduleUpdated = onEvent(MSG.SCHEDULE_UPDATED, (payload) => {
    if (payload && typeof payload === "object" && "id" in payload) {
        useScheduleStore.getState().applyUpdate(payload as Schedule);
    }
});

export { useScheduleStore };
```

- [ ] **Step 3: Verify build**

Run: `cd packages/ui && bun run build`
Expected: Clean build

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/stores/schedule-store.ts packages/ui/src/stores/ui-store.ts
git commit -m "feat(ui): add schedule Zustand store and UI toggle"
```

---

## Task 10: Schedule Management Dialog (UI)

**Files:**
- Create: `packages/ui/src/components/schedules/ScheduleManagementDialog.tsx`
- Create: `packages/ui/src/components/schedules/ScheduleForm.tsx`

- [ ] **Step 1: Create ScheduleForm component**

Create `packages/ui/src/components/schedules/ScheduleForm.tsx` — the create/edit form:

```typescript
import { useState, useCallback, useMemo } from "react";
import type { Schedule, ScheduleCreatePayload, ScheduleUpdatePayload } from "@taskflow/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import type { Project } from "@taskflow/shared";

/** Compute a simple "next run" preview string for display. */
function computeNextRunPreview(expression: string, expressionType: "cron" | "rate"): string | null {
    try {
        if (expressionType === "rate") {
            const match = expression.match(/^rate\((\d+)\s+(minutes?|hours?|days?)\)$/i);
            if (!match) return null;
            const value = parseInt(match[1], 10);
            const unit = match[2].toLowerCase().replace(/s$/, "");
            const msMap: Record<string, number> = { minute: 60000, hour: 3600000, day: 86400000 };
            const ms = msMap[unit];
            if (!ms) return null;
            return new Date(Date.now() + value * ms).toLocaleString();
        }
        // For cron, we'd need cron-parser which is a backend dep.
        // Show a placeholder for now — the backend computes the real nextRunAt.
        return null;
    } catch {
        return null;
    }
}

interface ScheduleFormProps {
    schedule: Schedule | null;
    projects: Project[];
    defaultProjectId?: string;
    onSave: (payload: ScheduleCreatePayload | ScheduleUpdatePayload) => Promise<void>;
    onCancel: () => void;
    onDelete?: () => void;
}

function ScheduleForm({ schedule, projects, defaultProjectId, onSave, onCancel, onDelete }: ScheduleFormProps) {
    const [projectId, setProjectId] = useState(schedule?.projectId ?? defaultProjectId ?? "");
    const [name, setName] = useState(schedule?.name ?? "");
    const [prompt, setPrompt] = useState(schedule?.prompt ?? "");
    const [expressionType, setExpressionType] = useState<"cron" | "rate">(
        schedule?.expressionType ?? "cron",
    );
    const [expression, setExpression] = useState(schedule?.expression ?? "");
    const [agentType, setAgentType] = useState(schedule?.agentType ?? "");
    const [timeout, setTimeout_] = useState(String(schedule?.timeout ?? 30));

    const nextRunPreview = useMemo(
        () => expression.trim() ? computeNextRunPreview(expression.trim(), expressionType) : null,
        [expression, expressionType],
    );

    const isEdit = schedule !== null;

    const handleSubmit = useCallback(async () => {
        if (!prompt.trim() || !expression.trim()) return;

        if (isEdit) {
            const payload: ScheduleUpdatePayload = {
                id: schedule.id,
                name: name.trim() || undefined,
                prompt: prompt.trim(),
                expression: expression.trim(),
                expressionType,
                timeout: parseInt(timeout, 10) || 30,
                agentType: agentType || undefined,
            };
            await onSave(payload);
        } else {
            if (!projectId) return;
            const payload: ScheduleCreatePayload = {
                projectId,
                name: name.trim() || undefined,
                prompt: prompt.trim(),
                expression: expression.trim(),
                expressionType,
                timeout: parseInt(timeout, 10) || 30,
                agentType: agentType || undefined,
            };
            await onSave(payload);
        }
    }, [schedule, isEdit, projectId, name, prompt, expression, expressionType, agentType, timeout, onSave]);

    const canSubmit = useMemo(
        () => prompt.trim() && expression.trim() && (isEdit || projectId),
        [prompt, expression, isEdit, projectId],
    );

    return (
        <div className="flex h-full flex-col overflow-y-auto p-4">
            <div className="space-y-4">
                {!isEdit && (
                    <div>
                        <Label className="text-xs">Project</Label>
                        <Select value={projectId} onValueChange={setProjectId}>
                            <SelectTrigger className="mt-1 h-8 text-xs">
                                <SelectValue placeholder="Select project" />
                            </SelectTrigger>
                            <SelectContent>
                                {projects.map((p) => (
                                    <SelectItem key={p.id} value={p.id}>
                                        {p.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                )}

                <div>
                    <Label className="text-xs">Name (optional)</Label>
                    <Input
                        className="mt-1 h-8 text-xs"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Auto-generated from prompt"
                    />
                </div>

                <div>
                    <Label className="text-xs">Prompt</Label>
                    <Textarea
                        className="mt-1 min-h-[80px] text-xs"
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        placeholder="What should the agent do?"
                    />
                </div>

                <div>
                    <Label className="text-xs">Schedule</Label>
                    <div className="mt-1 flex gap-2">
                        <Select
                            value={expressionType}
                            onValueChange={(v) => setExpressionType(v as "cron" | "rate")}>
                            <SelectTrigger className="h-8 w-24 text-xs">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="cron">Cron</SelectItem>
                                <SelectItem value="rate">Rate</SelectItem>
                            </SelectContent>
                        </Select>
                        <Input
                            className="h-8 flex-1 font-mono text-xs"
                            value={expression}
                            onChange={(e) => setExpression(e.target.value)}
                            placeholder={expressionType === "cron" ? "0 9 * * *" : "rate(1 hour)"}
                        />
                    </div>
                    {nextRunPreview && (
                        <div className="text-muted-foreground mt-1 text-xs">
                            Next run: {nextRunPreview}
                        </div>
                    )}
                </div>

                <div className="flex gap-4">
                    <div className="flex-1">
                        <Label className="text-xs">Agent</Label>
                        <Select value={agentType} onValueChange={setAgentType}>
                            <SelectTrigger className="mt-1 h-8 text-xs">
                                <SelectValue placeholder="Default" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="">Default</SelectItem>
                                <SelectItem value="claude">Claude</SelectItem>
                                <SelectItem value="codex">Codex</SelectItem>
                                <SelectItem value="gemini">Gemini</SelectItem>
                                <SelectItem value="opencode">OpenCode</SelectItem>
                                <SelectItem value="cursor">Cursor</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="w-28">
                        <Label className="text-xs">Timeout (min)</Label>
                        <Input
                            className="mt-1 h-8 text-xs"
                            type="number"
                            min="1"
                            value={timeout}
                            onChange={(e) => setTimeout_(e.target.value)}
                        />
                    </div>
                </div>
            </div>

            <div className="mt-auto flex items-center justify-between border-t pt-4">
                <div>
                    {onDelete && (
                        <Button variant="ghost" size="sm" className="text-destructive text-xs" onClick={onDelete}>
                            Delete
                        </Button>
                    )}
                </div>
                <div className="flex gap-2">
                    <Button variant="ghost" size="sm" className="text-xs" onClick={onCancel}>
                        Cancel
                    </Button>
                    <Button size="sm" className="text-xs" disabled={!canSubmit} onClick={() => void handleSubmit()}>
                        {isEdit ? "Save" : "Create"}
                    </Button>
                </div>
            </div>
        </div>
    );
}

export { ScheduleForm };
```

- [ ] **Step 2: Create ScheduleManagementDialog**

Create `packages/ui/src/components/schedules/ScheduleManagementDialog.tsx`:

```typescript
import { useState, useEffect, useCallback, useMemo } from "react";
import type { Schedule, ScheduleCreatePayload, ScheduleUpdatePayload } from "@taskflow/shared";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Plus, Play, MoreHorizontal } from "lucide-react";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useUIStore } from "@/stores/ui-store";
import { useScheduleStore } from "@/stores/schedule-store";
import { useProjectStore } from "@/stores/project-store";
import { ScheduleForm } from "./ScheduleForm";

function formatRelativeTime(isoDate: string): string {
    const diff = Date.now() - new Date(isoDate).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}

function getStatusInfo(schedule: Schedule): { label: string; color: string } {
    if (schedule.runningSessionId) return { label: "running", color: "text-blue-400" };
    if (schedule.lastError) return { label: "error", color: "text-red-400" };
    return { label: "idle", color: "text-green-400" };
}

function ScheduleManagementDialog() {
    const open = useUIStore((s) => s.scheduleManagementOpen);
    const toggleScheduleManagement = useUIStore((s) => s.toggleScheduleManagement);
    const activeProjectId = useUIStore((s) => s.activeProjectId);

    const schedules = useScheduleStore((s) => s.schedules);
    const projects = useProjectStore((s) => s.projects);

    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [creating, setCreating] = useState(false);
    const [projectFilter, setProjectFilter] = useState<string>(activeProjectId ?? "all");

    useEffect(() => {
        if (!open) return;
        void useScheduleStore.getState().fetchSchedules();
    }, [open]);

    const projectMap = useMemo(() => new Map(projects.map((p) => [p.id, p.name])), [projects]);

    const filteredSchedules = useMemo(() => {
        if (projectFilter === "all") return schedules;
        return schedules.filter((s) => s.projectId === projectFilter);
    }, [schedules, projectFilter]);

    const selectedSchedule = filteredSchedules.find((s) => s.id === selectedId) ?? null;

    const defaultProjectId = projectFilter !== "all" ? projectFilter : undefined;

    const handleOpenChange = useCallback(
        (value: boolean) => {
            if (!value) toggleScheduleManagement();
        },
        [toggleScheduleManagement],
    );

    const handleSave = useCallback(async (payload: ScheduleCreatePayload | ScheduleUpdatePayload) => {
        if ("id" in payload) {
            const updated = await useScheduleStore.getState().updateSchedule(payload);
            setSelectedId(updated.id);
        } else {
            const created = await useScheduleStore.getState().createSchedule(payload);
            setSelectedId(created.id);
        }
        setCreating(false);
    }, []);

    const handleDelete = useCallback(async (id: string) => {
        await useScheduleStore.getState().deleteSchedule(id);
        setSelectedId(null);
        setCreating(false);
    }, []);

    const handleToggleEnabled = useCallback(async (schedule: Schedule) => {
        await useScheduleStore.getState().updateSchedule({
            id: schedule.id,
            enabled: !schedule.enabled,
        });
    }, []);

    const handleTrigger = useCallback(async (id: string) => {
        await useScheduleStore.getState().triggerSchedule(id);
    }, []);

    const startCreating = useCallback(() => {
        setSelectedId(null);
        setCreating(true);
    }, []);

    const clearSelection = useCallback(() => {
        setCreating(false);
        setSelectedId(null);
    }, []);

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent
                className="bg-dialog-shell border-border w-4xl max-w-[calc(100vw-2rem)] gap-0 rounded-xl p-1.5 sm:max-w-[calc(100vw-2rem)]"
                aria-describedby={undefined}>
                <DialogHeader className="px-2 py-2">
                    <DialogTitle className="text-[15px]">Schedules</DialogTitle>
                </DialogHeader>

                <div className="flex h-[60vh] gap-1.5">
                    {/* Left list column */}
                    <div className="bg-card flex w-[280px] shrink-0 flex-col rounded-[10px]">
                        <div className="p-2">
                            <Select
                                value={projectFilter}
                                onValueChange={(v) => {
                                    setProjectFilter(v);
                                    setSelectedId(null);
                                    setCreating(false);
                                }}>
                                <SelectTrigger className="h-7 w-full text-xs">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All Projects</SelectItem>
                                    {projects.map((p) => (
                                        <SelectItem key={p.id} value={p.id}>
                                            {p.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="flex-1 overflow-y-auto px-1.5 py-0.5">
                            {filteredSchedules.map((schedule) => {
                                const status = getStatusInfo(schedule);
                                return (
                                    <button
                                        key={schedule.id}
                                        onClick={() => {
                                            setSelectedId(schedule.id);
                                            setCreating(false);
                                        }}
                                        className={`mb-1 w-full rounded-lg border px-3 py-2.5 text-left transition-colors ${
                                            selectedId === schedule.id
                                                ? "border-border bg-muted"
                                                : "border-transparent hover:bg-muted/50"
                                        }`}>
                                        <div className="flex items-center justify-between">
                                            <div className="text-foreground text-[13px] font-medium truncate">
                                                {schedule.name}
                                            </div>
                                            <div className="flex items-center gap-1.5 shrink-0">
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        void handleToggleEnabled(schedule);
                                                    }}
                                                    className={`h-5 w-9 rounded-full transition-colors ${
                                                        schedule.enabled ? "bg-green-500" : "bg-muted-foreground/30"
                                                    }`}>
                                                    <div
                                                        className={`h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                                                            schedule.enabled ? "translate-x-4" : "translate-x-0.5"
                                                        }`}
                                                    />
                                                </button>
                                                <DropdownMenu>
                                                    <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                                                        <button className="text-muted-foreground hover:text-foreground">
                                                            <MoreHorizontal className="h-3.5 w-3.5" />
                                                        </button>
                                                    </DropdownMenuTrigger>
                                                    <DropdownMenuContent align="end">
                                                        <DropdownMenuItem
                                                            disabled={!!schedule.runningSessionId}
                                                            onClick={() => void handleTrigger(schedule.id)}>
                                                            <Play className="mr-2 h-3.5 w-3.5" />
                                                            Run now
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem
                                                            className="text-destructive"
                                                            onClick={() => void handleDelete(schedule.id)}>
                                                            Delete
                                                        </DropdownMenuItem>
                                                    </DropdownMenuContent>
                                                </DropdownMenu>
                                            </div>
                                        </div>
                                        <div className="text-muted-foreground mt-1 flex items-center gap-1.5 text-xs">
                                            <span className="font-mono">
                                                {schedule.expressionType}: {schedule.expression}
                                            </span>
                                            {projectFilter === "all" && (
                                                <span className="bg-muted truncate rounded px-1">
                                                    {projectMap.get(schedule.projectId) ?? "Unknown"}
                                                </span>
                                            )}
                                        </div>
                                        <div className="text-muted-foreground mt-0.5 flex items-center gap-1.5 text-xs">
                                            <span className={status.color}>● {status.label}</span>
                                            {schedule.lastRunAt && (
                                                <span>· {formatRelativeTime(schedule.lastRunAt)}</span>
                                            )}
                                            {schedule.lastError && !schedule.runningSessionId && (
                                                <span className="text-red-400 truncate">
                                                    · {schedule.lastError}
                                                </span>
                                            )}
                                        </div>
                                    </button>
                                );
                            })}
                            {filteredSchedules.length === 0 && (
                                <div className="text-muted-foreground px-3 py-6 text-center text-xs">
                                    No schedules yet
                                </div>
                            )}
                        </div>
                        <div className="flex justify-end p-1">
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={startCreating}
                                title="New schedule">
                                <Plus className="h-4 w-4" />
                            </Button>
                        </div>
                    </div>

                    {/* Right editor column */}
                    <div className="bg-background flex min-h-0 min-w-0 flex-1 flex-col rounded-[10px]">
                        {(creating || selectedSchedule) ? (
                            <ScheduleForm
                                key={creating ? `new-${defaultProjectId ?? "any"}` : selectedSchedule?.id}
                                schedule={creating ? null : selectedSchedule}
                                projects={projects}
                                defaultProjectId={defaultProjectId}
                                onSave={handleSave}
                                onCancel={clearSelection}
                                onDelete={
                                    selectedSchedule
                                        ? () => void handleDelete(selectedSchedule.id)
                                        : undefined
                                }
                            />
                        ) : (
                            <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
                                Select a schedule or click <Plus className="mx-1 inline h-4 w-4" /> to create
                            </div>
                        )}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}

export { ScheduleManagementDialog };
```

- [ ] **Step 3: Verify build**

Run: `cd packages/ui && bun run build`
Expected: Clean build

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/components/schedules/
git commit -m "feat(ui): add ScheduleManagementDialog and ScheduleForm components"
```

---

## Task 11: Wire Up UI — App, Sidebar, Workspace, Electron

**Files:**
- Modify: `packages/ui/src/App.tsx:11` (add import)
- Modify: `packages/ui/src/App.tsx:132` (mount dialog)
- Modify: `packages/ui/src/components/sidebar/TaskSidebar.tsx:408` (add button)
- Modify: `packages/ui/src/components/workspace/Workspace.tsx:93,317` (add IPC handler)
- Modify: `electron/src/preload.ts:47-53` (add onOpenSchedules)
- Modify: `electron/src/main.ts:448-453` (add menu item)

- [ ] **Step 1: Mount dialog in App.tsx**

In `packages/ui/src/App.tsx`:

Add import (after FlowManagementDialog import on line 11):
```typescript
import { ScheduleManagementDialog } from "@/components/schedules/ScheduleManagementDialog";
```

Add component (after `<FlowManagementDialog />` on line 132):
```typescript
                <ScheduleManagementDialog />
```

- [ ] **Step 2: Add toolbar button in TaskSidebar**

In `packages/ui/src/components/sidebar/TaskSidebar.tsx`:

Add import for the store toggle and an icon. Find where `toggleFlowManagement` is imported (line 63):
```typescript
    const toggleScheduleManagement = useUIStore((s) => s.toggleScheduleManagement);
```

Add a button after the Flows button (after line 414, the `</Button>` closing the Flows button). Use `CalendarClock` from lucide-react:
```typescript
                    <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={toggleScheduleManagement}
                        aria-label="Schedules"
                        tooltip="Schedules"
                        tooltipSide="bottom"
                        className="text-muted-foreground [-webkit-app-region:no-drag]">
                        <CalendarClock className="h-3.5 w-3.5" />
                    </Button>
```

Add `CalendarClock` to the lucide-react import at the top of the file.

- [ ] **Step 3: Add Electron preload bridge**

In `electron/src/preload.ts`, after the `onOpenFlows` block (lines 47-53), add:

```typescript
    onOpenSchedules: (callback: () => void) => {
        const listener = () => callback();
        ipcRenderer.on("open-schedules", listener);
        return () => {
            ipcRenderer.removeListener("open-schedules", listener);
        };
    },
```

- [ ] **Step 4: Add Electron menu item**

In `electron/src/main.ts`, after the Flows menu item (lines 448-453), add:

```typescript
                {
                    label: "Schedules",
                    click: () => {
                        mainWindow?.webContents.send("open-schedules");
                    },
                },
```

- [ ] **Step 5: Wire IPC in Workspace**

In `packages/ui/src/components/workspace/Workspace.tsx`:

Add alongside `toggleFlowManagement` (line 93):
```typescript
    const toggleScheduleManagement = useUIStore((s) => s.toggleScheduleManagement);
```

In the `useEffect` with IPC listeners (around line 316-318), after the `onOpenFlows` block:
```typescript
        if (onOpenSchedules) {
            cleanupFns.push(onOpenSchedules(runIfNoDialogOpen(toggleScheduleManagement)));
        }
```

The `onOpenSchedules` will come from destructuring `window.taskflow` — follow the same pattern as `onOpenFlows`. Find where `onOpenFlows` is destructured and add `onOpenSchedules` alongside it.

Add `toggleScheduleManagement` to the useEffect dependency array.

- [ ] **Step 6: Update window.taskflow type**

If there's a TypeScript declaration for `window.taskflow`, add `onOpenSchedules` to it following the same pattern as `onOpenFlows`.

- [ ] **Step 7: Verify build**

Run: `cd packages/ui && bun run build`
Expected: Clean build

Run: `cd electron && bun run build`
Expected: Clean build

- [ ] **Step 8: Commit**

```bash
git add packages/ui/src/App.tsx packages/ui/src/components/sidebar/TaskSidebar.tsx packages/ui/src/components/workspace/Workspace.tsx electron/src/preload.ts electron/src/main.ts
git commit -m "feat: wire up schedule UI — toolbar button, menu item, IPC bridge"
```

---

## Task 12: Integration Testing & Polish

- [ ] **Step 1: Start the app in dev mode**

```bash
cd packages/backend && TASKFLOW_DEV_PORT=9234 bun run src/index.ts
```

In another terminal:
```bash
cd packages/ui && VITE_BACKEND_PORT=9234 bun run dev
```

- [ ] **Step 2: Verify schedule creation**

1. Open the Schedules dialog (toolbar button)
2. Click "+" to create a new schedule
3. Select a project, enter a prompt, set expression to `rate(5 minutes)`
4. Click Create
5. Verify the schedule appears in the list

- [ ] **Step 3: Verify schedule toggle**

1. Toggle the enabled switch on the schedule card
2. Verify it updates immediately (broadcast works)

- [ ] **Step 4: Verify trigger now**

1. Click the "⋯" menu on a schedule → "Run now"
2. Verify a session appears in the project's session list
3. Verify the schedule status shows "running"

- [ ] **Step 5: Verify completion**

When the agent calls `taskflow-cli schedule complete`:
1. The session should be terminated
2. The schedule status should return to "idle"
3. `lastRunAt` should be updated

- [ ] **Step 6: Verify timeout**

Create a schedule with a 1-minute timeout and trigger it. If the agent doesn't call complete within 1 minute, verify it's killed and `lastError` shows the timeout message.

- [ ] **Step 7: Fix any issues found**

Address any bugs or issues discovered during testing.

- [ ] **Step 8: Final commit**

```bash
git add -A
git commit -m "fix: polish schedule system after integration testing"
```
