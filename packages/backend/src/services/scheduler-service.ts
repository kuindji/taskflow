import { CronExpressionParser } from "cron-parser";
import type { Schedule, WsEvent } from "@taskflow/shared";
import { MSG } from "@taskflow/shared";
import type { ScheduleStore } from "./schedule-store";

interface SpawnResult {
    sessionId: string;
    isShell: boolean;
}

interface SchedulerDeps {
    scheduleStore: ScheduleStore;
    spawnSession: (schedule: Schedule) => Promise<SpawnResult>;
    closeSession: (sessionId: string) => void;
    broadcast: (event: WsEvent) => void;
    isOnline: () => boolean;
    enabled?: boolean;
}

const SYSTEM_PROMPT_ADDON = `You are running as a scheduled job. When you have completed your work, you MUST call the following command to signal completion:

\`taskflow-cli schedule complete\`

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
        return CronExpressionParser.parse(schedule.expression).next().toDate();
    }
    const intervalMs = parseRateExpression(schedule.expression);
    const base = schedule.lastRunAt ? new Date(schedule.lastRunAt).getTime() : Date.now();
    return new Date(base + intervalMs);
}

function validateExpression(expression: string, expressionType: "cron" | "rate"): void {
    if (expressionType === "cron") {
        CronExpressionParser.parse(expression);
    } else {
        parseRateExpression(expression);
    }
}

class SchedulerService {
    private deps: SchedulerDeps;
    private timers = new Map<string, ReturnType<typeof setTimeout>>();
    private timeoutTimers = new Map<string, ReturnType<typeof setTimeout>>();
    private runningSessions = new Map<string, SpawnResult>(); // scheduleId -> session info
    private deferredSchedules = new Set<string>();

    constructor(deps: SchedulerDeps) {
        this.deps = deps;
    }

    assertEnabled(): void {
        if (this.deps.enabled === false) {
            throw new Error("Schedules are owned by the production Taskflow instance");
        }
    }

    async init(): Promise<void> {
        if (this.deps.enabled === false) return;
        const schedules = await this.deps.scheduleStore.getAll();

        // Clear stale runningSessionIds from crash
        for (const schedule of schedules) {
            if (schedule.runningSessionId) {
                await this.deps.scheduleStore.update(schedule.id, (s) => ({
                    ...s,
                    runningSessionId: null,
                    lastError: "Previous run did not complete (app restarted)",
                    updatedAt: new Date().toISOString(),
                }));
            }
        }

        // Schedule all enabled schedules (defer if offline)
        for (const schedule of schedules) {
            if (schedule.enabled) {
                if (!this.deps.isOnline()) {
                    this.deferredSchedules.add(schedule.id);
                    continue;
                }
                try {
                    await this.scheduleNext(schedule.id);
                } catch (err) {
                    console.error(`Failed to schedule "${schedule.name}" (${schedule.id}):`, err);
                    await this.deps.scheduleStore.update(schedule.id, (s) => ({
                        ...s,
                        lastError: `Failed to schedule: ${err instanceof Error ? err.message : String(err)}`,
                        updatedAt: new Date().toISOString(),
                    }));
                }
            }
        }
    }

    async scheduleNext(scheduleId: string): Promise<void> {
        this.clearTimer(scheduleId);

        const schedule = await this.deps.scheduleStore.getById(scheduleId);
        if (!schedule || !schedule.enabled) return;

        const nextRun = computeNextRun(schedule);
        const delay = nextRun.getTime() - Date.now();

        // Update nextRunAt in store
        const updated = await this.deps.scheduleStore.update(scheduleId, (s) => ({
            ...s,
            nextRunAt: nextRun.toISOString(),
            updatedAt: new Date().toISOString(),
        }));
        this.broadcastUpdated(updated);

        if (delay <= 0) {
            // Run immediately if past due
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
        this.clearTimer(scheduleId);

        const schedule = await this.deps.scheduleStore.getById(scheduleId);
        if (!schedule || !schedule.enabled) return;

        // Defer if offline
        if (!this.deps.isOnline()) {
            this.deferredSchedules.add(scheduleId);
            const updated = await this.deps.scheduleStore.update(scheduleId, (s) => ({
                ...s,
                lastError: "Skipped: offline",
                nextRunAt: null,
                updatedAt: new Date().toISOString(),
            }));
            this.broadcastUpdated(updated);
            return;
        }

        // Skip if already running
        if (this.runningSessions.has(scheduleId)) return;

        let result: SpawnResult;
        try {
            result = await this.deps.spawnSession(schedule);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            const updated = await this.deps.scheduleStore.update(scheduleId, (s) => ({
                ...s,
                lastError: `Failed to spawn session: ${errorMessage}`,
                lastRunAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            }));
            this.broadcastUpdated(updated);
            await this.scheduleNext(scheduleId);
            return;
        }

        this.runningSessions.set(scheduleId, result);

        const updated = await this.deps.scheduleStore.update(scheduleId, (s) => ({
            ...s,
            runningSessionId: result.sessionId,
            lastRunAt: new Date().toISOString(),
            lastError: null,
            nextRunAt: null,
            updatedAt: new Date().toISOString(),
        }));
        this.broadcastUpdated(updated);

        // Set timeout timer
        if (schedule.timeout > 0) {
            this.timeoutTimers.set(
                scheduleId,
                setTimeout(
                    () => {
                        void this.handleTimeout(scheduleId);
                    },
                    schedule.timeout * 60 * 1000,
                ),
            );
        }
    }

    async handleComplete(sessionId: string): Promise<void> {
        const schedule = await this.deps.scheduleStore.findBySessionId(sessionId);
        if (!schedule) return;

        this.clearTimeoutTimer(schedule.id);
        this.runningSessions.delete(schedule.id);

        this.deps.closeSession(sessionId);

        const updated = await this.deps.scheduleStore.update(schedule.id, (s) => ({
            ...s,
            runningSessionId: null,
            lastError: null,
            updatedAt: new Date().toISOString(),
        }));
        this.broadcastUpdated(updated);

        await this.scheduleNext(schedule.id);
    }

    async handleSessionExit(sessionId: string, exitCode: number): Promise<void> {
        const schedule = await this.deps.scheduleStore.findBySessionId(sessionId);
        if (!schedule) return;

        this.clearTimeoutTimer(schedule.id);
        const runInfo = this.runningSessions.get(schedule.id);
        this.runningSessions.delete(schedule.id);

        // Shell sessions complete via exit code (0 = success)
        const isShellSuccess = runInfo?.isShell && exitCode === 0;

        const updated = await this.deps.scheduleStore.update(schedule.id, (s) => ({
            ...s,
            runningSessionId: null,
            lastError: isShellSuccess
                ? null
                : `${runInfo?.isShell ? "Shell" : "Agent"} exited unexpectedly with code ${exitCode}`,
            updatedAt: new Date().toISOString(),
        }));
        this.broadcastUpdated(updated);

        await this.scheduleNext(schedule.id);
    }

    private async handleTimeout(scheduleId: string): Promise<void> {
        this.clearTimeoutTimer(scheduleId);

        const runInfo = this.runningSessions.get(scheduleId);
        if (!runInfo) return;

        this.runningSessions.delete(scheduleId);
        this.deps.closeSession(runInfo.sessionId);

        const updated = await this.deps.scheduleStore.update(scheduleId, (s) => ({
            ...s,
            runningSessionId: null,
            lastError: `Timed out after ${s.timeout} minutes`,
            updatedAt: new Date().toISOString(),
        }));
        this.broadcastUpdated(updated);

        await this.scheduleNext(scheduleId);
    }

    async onScheduleCreated(scheduleId: string): Promise<void> {
        const schedule = await this.deps.scheduleStore.getById(scheduleId);
        if (!schedule || !schedule.enabled) return;
        await this.scheduleNext(scheduleId);
    }

    async onScheduleUpdated(scheduleId: string): Promise<void> {
        this.clearTimer(scheduleId);
        this.clearTimeoutTimer(scheduleId);

        const schedule = await this.deps.scheduleStore.getById(scheduleId);
        if (!schedule) return;

        if (schedule.enabled) {
            await this.scheduleNext(scheduleId);
        } else {
            // If disabled while running, let it finish but don't reschedule
            const updated = await this.deps.scheduleStore.update(scheduleId, (s) => ({
                ...s,
                nextRunAt: null,
                updatedAt: new Date().toISOString(),
            }));
            this.broadcastUpdated(updated);
        }
    }

    async onScheduleDeleted(scheduleId: string, runningSessionId: string | null): Promise<void> {
        this.clearTimer(scheduleId);
        this.clearTimeoutTimer(scheduleId);
        this.runningSessions.delete(scheduleId);

        if (runningSessionId) {
            this.deps.closeSession(runningSessionId);
        }
    }

    async triggerNow(scheduleId: string): Promise<void> {
        this.assertEnabled();
        if (!this.deps.isOnline()) {
            throw new Error("Cannot trigger schedule while offline");
        }

        const schedule = await this.deps.scheduleStore.getById(scheduleId);
        if (!schedule) throw new Error(`Schedule not found: ${scheduleId}`);

        // Skip if already running
        if (this.runningSessions.has(scheduleId)) {
            throw new Error("Schedule is already running");
        }

        await this.execute(scheduleId);
    }

    async resumeDeferred(): Promise<void> {
        const ids = [...this.deferredSchedules];
        this.deferredSchedules.clear();
        for (const id of ids) {
            try {
                await this.scheduleNext(id);
            } catch (err) {
                console.error(`Failed to resume deferred schedule ${id}:`, err);
            }
        }
    }

    shutdown(): void {
        // Cancel all scheduled timers
        for (const timer of this.timers.values()) {
            clearTimeout(timer);
        }
        this.timers.clear();

        // Cancel all timeout timers
        for (const timer of this.timeoutTimers.values()) {
            clearTimeout(timer);
        }
        this.timeoutTimers.clear();

        // Kill all running sessions
        for (const [scheduleId, runInfo] of this.runningSessions) {
            this.deps.closeSession(runInfo.sessionId);
            this.runningSessions.delete(scheduleId);
        }
    }

    // --- Private helpers ---

    private clearTimer(scheduleId: string): void {
        const timer = this.timers.get(scheduleId);
        if (timer) {
            clearTimeout(timer);
            this.timers.delete(scheduleId);
        }
    }

    private clearTimeoutTimer(scheduleId: string): void {
        const timer = this.timeoutTimers.get(scheduleId);
        if (timer) {
            clearTimeout(timer);
            this.timeoutTimers.delete(scheduleId);
        }
    }

    private broadcastUpdated(schedule: Schedule): void {
        this.deps.broadcast({
            type: MSG.SCHEDULE_UPDATED,
            payload: schedule,
        });
    }
}

export { SchedulerService, SYSTEM_PROMPT_ADDON, validateExpression };
