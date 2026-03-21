import { CronExpressionParser } from "cron-parser";
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
        return CronExpressionParser.parse(schedule.expression).next().toDate();
    }
    const intervalMs = parseRateExpression(schedule.expression);
    const base = schedule.lastRunAt ? new Date(schedule.lastRunAt).getTime() : Date.now();
    return new Date(base + intervalMs);
}

class SchedulerService {
    private deps: SchedulerDeps;
    private timers = new Map<string, ReturnType<typeof setTimeout>>();
    private timeoutTimers = new Map<string, ReturnType<typeof setTimeout>>();
    private runningSessions = new Map<string, string>(); // scheduleId -> sessionId

    constructor(deps: SchedulerDeps) {
        this.deps = deps;
    }

    async init(): Promise<void> {
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

        // Schedule all enabled schedules
        for (const schedule of schedules) {
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

        // Skip if already running
        if (this.runningSessions.has(scheduleId)) return;

        let sessionId: string;
        try {
            sessionId = await this.deps.spawnSession(schedule);
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

        this.runningSessions.set(scheduleId, sessionId);

        const updated = await this.deps.scheduleStore.update(scheduleId, (s) => ({
            ...s,
            runningSessionId: sessionId,
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
                setTimeout(() => {
                    void this.handleTimeout(scheduleId);
                }, schedule.timeout * 60 * 1000),
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
        this.runningSessions.delete(schedule.id);

        const updated = await this.deps.scheduleStore.update(schedule.id, (s) => ({
            ...s,
            runningSessionId: null,
            lastError: `Agent exited unexpectedly with code ${exitCode}`,
            updatedAt: new Date().toISOString(),
        }));
        this.broadcastUpdated(updated);

        await this.scheduleNext(schedule.id);
    }

    private async handleTimeout(scheduleId: string): Promise<void> {
        this.clearTimeoutTimer(scheduleId);

        const sessionId = this.runningSessions.get(scheduleId);
        if (!sessionId) return;

        this.runningSessions.delete(scheduleId);
        this.deps.closeSession(sessionId);

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
        const schedule = await this.deps.scheduleStore.getById(scheduleId);
        if (!schedule) throw new Error(`Schedule not found: ${scheduleId}`);

        // Skip if already running
        if (this.runningSessions.has(scheduleId)) {
            throw new Error("Schedule is already running");
        }

        await this.execute(scheduleId);
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
        for (const [scheduleId, sessionId] of this.runningSessions) {
            this.deps.closeSession(sessionId);
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

export { SchedulerService, SYSTEM_PROMPT_ADDON };
