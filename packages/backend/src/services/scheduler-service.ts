import { CronExpressionParser } from "cron-parser";
import type { Schedule, ScheduleDeletePayload, WsEvent } from "@taskflow/shared";
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
    now?: () => number;
    schedule?: (callback: () => void, delayMs: number) => () => void;
}

const SYSTEM_PROMPT_ADDON = `You are running as a scheduled job. When you have completed your work, you MUST call the following command to signal completion:

\`taskflow-cli schedule complete\`

Do not exit without calling this command. If you encounter an error that prevents you from completing the task, still call this command — your error output will be captured.`;

function parseRateExpression(expression: string): number {
    const match = expression.match(/^rate\((\d+)\s+(minutes?|hours?|days?)\)$/i);
    if (!match) throw new Error(`Invalid rate expression: ${expression}`);
    const value = parseInt(match[1], 10);
    if (value < 1) throw new Error(`Rate must be at least 1: ${expression}`);
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

function computeNextRun(schedule: Schedule, nowMs: number): Date {
    if (schedule.expressionType === "cron") {
        return CronExpressionParser.parse(schedule.expression, { currentDate: new Date(nowMs) })
            .next()
            .toDate();
    }
    const intervalMs = parseRateExpression(schedule.expression);
    return new Date(nowMs + intervalMs);
}

function validateExpression(expression: string, expressionType: "cron" | "rate"): void {
    if (expressionType === "cron") {
        CronExpressionParser.parse(expression);
    } else {
        parseRateExpression(expression);
    }
}

class SchedulerService {
    private timers = new Map<string, () => void>();
    private timeoutTimers = new Map<string, () => void>();
    private runningSessions = new Map<string, SpawnResult>();
    // Schedules between spawning a session and recording it as their run. A
    // session can exit in that window; its exit is held in earlyExits and
    // replayed once the run is recorded.
    private launching = new Set<string>();
    private earlyExits = new Map<string, number>();
    private admitted = new Set<string>();
    private deferredSchedules = new Set<string>();
    private cancelTick: (() => void) | null = null;
    private initialization: Promise<void> | null = null;
    private stopped = false;
    private now: () => number;
    private schedule: (callback: () => void, delayMs: number) => () => void;

    constructor(private deps: SchedulerDeps) {
        this.now = deps.now ?? Date.now;
        this.schedule =
            deps.schedule ??
            ((callback, delayMs) => {
                const timer = setTimeout(callback, delayMs);
                return () => clearTimeout(timer);
            });
    }

    assertEnabled(): void {
        if (this.deps.enabled === false) {
            throw new Error("Schedules are owned by the production Taskflow instance");
        }
    }

    async init(): Promise<void> {
        if (this.deps.enabled === false || this.stopped) return;
        this.initialization ??= this.initialize();
        await this.initialization;
    }

    private async initialize(): Promise<void> {
        for (const schedule of await this.deps.scheduleStore.getAll()) {
            if (this.stopped) return;
            if (schedule.runningSessionId) {
                await this.deps.scheduleStore.update(schedule.id, (s) => ({
                    ...s,
                    runningSessionId: null,
                    lastError: "Previous run did not complete (app restarted)",
                    updatedAt: new Date(this.now()).toISOString(),
                }));
            }
        }
        this.startTick();
        await this.checkDue();
    }

    private startTick(): void {
        if (this.stopped || this.deps.enabled === false || this.cancelTick) return;
        this.cancelTick = this.schedule(() => {
            this.cancelTick = null;
            this.startTick();
            this.background(this.checkDue());
        }, 30_000);
    }

    private async checkDue(): Promise<void> {
        if (this.stopped || this.deps.enabled === false) return;
        for (const schedule of await this.deps.scheduleStore.getAll()) {
            if (schedule.enabled) {
                try {
                    await this.scheduleNext(schedule.id);
                } catch (error) {
                    const lastError = `Failed to schedule: ${error instanceof Error ? error.message : String(error)}`;
                    // The tick repeats this check; record a failure once, not every 30 s.
                    if (schedule.lastError === lastError) continue;
                    console.error(`Failed to schedule "${schedule.name}" (${schedule.id}):`, error);
                    try {
                        await this.deps.scheduleStore.update(schedule.id, (s) => ({
                            ...s,
                            lastError,
                            updatedAt: new Date(this.now()).toISOString(),
                        }));
                    } catch (writeError) {
                        console.error(
                            `Failed to record schedule error ${schedule.id}:`,
                            writeError,
                        );
                    }
                }
            }
        }
    }

    async scheduleNext(scheduleId: string): Promise<void> {
        if (this.stopped || this.deps.enabled === false) return;
        this.clearTimer(scheduleId);
        let schedule = await this.deps.scheduleStore.getById(scheduleId);
        if (!schedule || !schedule.enabled || this.stopped) return;

        if (!schedule.nextRunAt || !Number.isFinite(Date.parse(schedule.nextRunAt))) {
            schedule = await this.deps.scheduleStore.update(scheduleId, (current) => {
                if (
                    this.stopped ||
                    !current.enabled ||
                    (current.nextRunAt && Number.isFinite(Date.parse(current.nextRunAt)))
                )
                    return current;
                return {
                    ...current,
                    nextRunAt: computeNextRun(current, this.now()).toISOString(),
                    updatedAt: new Date(this.now()).toISOString(),
                };
            });
            this.broadcastUpdated(schedule);
        }
        if (this.stopped || !schedule.enabled || this.admitted.has(scheduleId)) return;
        const delay = Date.parse(schedule.nextRunAt ?? "") - this.now();
        if (delay <= 0) {
            // execute admits synchronously; don't hold the due scan or init open on its spawn.
            this.background(this.execute(scheduleId, "scheduled"));
        } else {
            // Concurrent checks may have read together; replace the timer at installation too.
            this.clearTimer(scheduleId);
            this.timers.set(
                scheduleId,
                this.schedule(
                    () => {
                        this.background(this.checkDue());
                    },
                    Math.min(delay, 2_147_483_647),
                ),
            );
        }
    }

    private admit(scheduleId: string): boolean {
        if (this.admitted.has(scheduleId)) return false;
        this.admitted.add(scheduleId);
        return true;
    }

    private nextAfterAttempt(current: Schedule, captured: Schedule): string | null {
        if (!current.enabled) return null;
        const timingChanged =
            current.expressionType !== captured.expressionType ||
            current.expression !== captured.expression ||
            current.enabled !== captured.enabled;
        if (timingChanged && current.nextRunAt && Number.isFinite(Date.parse(current.nextRunAt))) {
            return current.nextRunAt;
        }
        return computeNextRun(current, this.now()).toISOString();
    }

    private async execute(scheduleId: string, source: "scheduled" | "manual"): Promise<void> {
        if (this.stopped || this.deps.enabled === false) return;
        if (!this.admit(scheduleId)) {
            if (source === "manual") throw new Error("Schedule is already running");
            return;
        }
        let keepAdmission = false;
        let result: SpawnResult | undefined;
        let rearm = false;
        try {
            this.clearTimer(scheduleId);
            const schedule = await this.deps.scheduleStore.getById(scheduleId);
            if (!schedule) {
                if (source === "manual") throw new Error(`Schedule not found: ${scheduleId}`);
                return;
            }
            if (!schedule.enabled || this.stopped) return;
            if (
                source === "scheduled" &&
                (!schedule.nextRunAt || !(Date.parse(schedule.nextRunAt) <= this.now()))
            ) {
                rearm = true;
                return;
            }
            if (!this.deps.isOnline()) {
                this.deferredSchedules.add(scheduleId);
                if (schedule.lastError !== "Skipped: offline") {
                    const updated = await this.deps.scheduleStore.update(scheduleId, (s) => ({
                        ...s,
                        lastError: "Skipped: offline",
                        updatedAt: new Date(this.now()).toISOString(),
                    }));
                    this.broadcastUpdated(updated);
                }
                return;
            }
            this.deferredSchedules.delete(scheduleId);
            this.launching.add(scheduleId);
            try {
                result = await this.deps.spawnSession(schedule);
            } catch (error) {
                if (this.stopped || !(await this.deps.scheduleStore.getById(scheduleId))) return;
                const errorMessage = error instanceof Error ? error.message : String(error);
                const updated = await this.deps.scheduleStore.update(scheduleId, (current) => ({
                    ...current,
                    lastError: `Failed to spawn session: ${errorMessage}`,
                    lastRunAt: new Date(this.now()).toISOString(),
                    nextRunAt: this.nextAfterAttempt(current, schedule),
                    updatedAt: new Date(this.now()).toISOString(),
                }));
                this.broadcastUpdated(updated);
                rearm = true;
                return;
            }

            const latest = await this.deps.scheduleStore.getById(scheduleId);
            if (this.stopped || !latest || !this.admitted.has(scheduleId)) {
                this.deps.closeSession(result.sessionId);
                result = undefined;
                return;
            }
            const runInfo = result;
            this.runningSessions.set(scheduleId, runInfo);
            const updated = await this.deps.scheduleStore.update(scheduleId, (current) => {
                if (this.stopped || this.runningSessions.get(scheduleId) !== runInfo)
                    return current;
                return {
                    ...current,
                    runningSessionId: runInfo.sessionId,
                    lastRunAt: new Date(this.now()).toISOString(),
                    lastError: null,
                    nextRunAt: this.nextAfterAttempt(current, schedule),
                    updatedAt: new Date(this.now()).toISOString(),
                };
            });
            if (this.stopped || this.runningSessions.get(scheduleId) !== runInfo) return;
            keepAdmission = true;
            this.broadcastUpdated(updated);
            if (schedule.timeout > 0) {
                this.timeoutTimers.set(
                    scheduleId,
                    this.schedule(() => {
                        this.background(
                            this.finishRun(
                                scheduleId,
                                runInfo.sessionId,
                                `Timed out after ${schedule.timeout} minutes`,
                                true,
                            ),
                        );
                    }, schedule.timeout * 60_000),
                );
            }
        } catch (error) {
            if (result) {
                this.clearTimeoutTimer(scheduleId);
                this.runningSessions.delete(scheduleId);
                this.deps.closeSession(result.sessionId);
                const sessionId = result.sessionId;
                try {
                    if (await this.deps.scheduleStore.getById(scheduleId)) {
                        await this.deps.scheduleStore.update(scheduleId, (current) =>
                            current.runningSessionId === sessionId
                                ? { ...current, runningSessionId: null }
                                : current,
                        );
                    }
                } catch (cleanupError) {
                    console.error(`Failed to clear schedule run ${scheduleId}:`, cleanupError);
                }
            }
            keepAdmission = false;
            throw error;
        } finally {
            if (this.launching.delete(scheduleId)) this.replayEarlyExit(result, keepAdmission);
            if (!keepAdmission) this.admitted.delete(scheduleId);
            if (rearm && !this.stopped) await this.scheduleNext(scheduleId);
        }
    }

    private replayEarlyExit(result: SpawnResult | undefined, recorded: boolean): void {
        const exitCode = result ? this.earlyExits.get(result.sessionId) : undefined;
        if (result) this.earlyExits.delete(result.sessionId);
        if (this.launching.size === 0) this.earlyExits.clear();
        if (result && recorded && exitCode !== undefined) {
            this.background(this.handleSessionExit(result.sessionId, exitCode));
        }
    }

    private async finishRun(
        scheduleId: string,
        sessionId: string,
        lastError: string | null,
        close: boolean,
    ): Promise<void> {
        if (this.runningSessions.get(scheduleId)?.sessionId !== sessionId) return;
        // Claim completion before closing the PTY; its exit callback must see no live run.
        this.runningSessions.delete(scheduleId);
        this.clearTimeoutTimer(scheduleId);
        try {
            if (close) this.deps.closeSession(sessionId);
            if (await this.deps.scheduleStore.getById(scheduleId)) {
                const updated = await this.deps.scheduleStore.update(scheduleId, (current) =>
                    current.runningSessionId === sessionId
                        ? {
                              ...current,
                              runningSessionId: null,
                              lastError,
                              updatedAt: new Date(this.now()).toISOString(),
                          }
                        : current,
                );
                this.broadcastUpdated(updated);
            }
        } finally {
            this.admitted.delete(scheduleId);
        }
        await this.scheduleNext(scheduleId);
    }

    async handleComplete(sessionId: string): Promise<void> {
        const schedule = await this.deps.scheduleStore.findBySessionId(sessionId);
        if (schedule) await this.finishRun(schedule.id, sessionId, null, true);
    }

    async handleSessionExit(sessionId: string, exitCode: number): Promise<void> {
        for (const [scheduleId, runInfo] of this.runningSessions) {
            if (runInfo.sessionId !== sessionId || this.launching.has(scheduleId)) continue;
            const error =
                runInfo.isShell && exitCode === 0
                    ? null
                    : `${runInfo.isShell ? "Shell" : "Agent"} exited unexpectedly with code ${exitCode}`;
            await this.finishRun(scheduleId, sessionId, error, false);
            return;
        }
        if (this.launching.size > 0) this.earlyExits.set(sessionId, exitCode);
    }

    async onScheduleCreated(scheduleId: string): Promise<void> {
        await this.scheduleNext(scheduleId);
    }

    async onScheduleUpdated(scheduleId: string, timingChanged: boolean): Promise<void> {
        if (timingChanged) {
            this.clearTimer(scheduleId);
            this.deferredSchedules.delete(scheduleId);
            await this.scheduleNext(scheduleId);
        }
        const schedule = await this.deps.scheduleStore.getById(scheduleId);
        if (schedule) this.broadcastUpdated(schedule);
    }

    async onScheduleDeleted(scheduleId: string, runningSessionId: string | null): Promise<void> {
        this.clearTimer(scheduleId);
        this.clearTimeoutTimer(scheduleId);
        this.deferredSchedules.delete(scheduleId);
        const sessionId = this.runningSessions.get(scheduleId)?.sessionId ?? runningSessionId;
        this.runningSessions.delete(scheduleId);
        this.admitted.delete(scheduleId);
        if (sessionId) this.deps.closeSession(sessionId);
        const payload: ScheduleDeletePayload = { id: scheduleId };
        this.deps.broadcast({ type: MSG.SCHEDULE_DELETED, payload });
    }

    async triggerNow(scheduleId: string): Promise<void> {
        this.assertEnabled();
        if (!this.deps.isOnline()) throw new Error("Cannot trigger schedule while offline");
        await this.execute(scheduleId, "manual");
    }

    async resumeDeferred(): Promise<void> {
        const ids = [...this.deferredSchedules];
        for (const id of ids) {
            try {
                await this.scheduleNext(id);
            } catch (error) {
                console.error(`Failed to resume deferred schedule ${id}:`, error);
            }
        }
    }

    shutdown(): void {
        this.stopped = true;
        this.cancelTick?.();
        this.cancelTick = null;
        for (const cancel of this.timers.values()) cancel();
        this.timers.clear();
        for (const cancel of this.timeoutTimers.values()) cancel();
        this.timeoutTimers.clear();
        const runs = [...this.runningSessions.values()];
        this.runningSessions.clear();
        this.admitted.clear();
        this.deferredSchedules.clear();
        for (const run of runs) this.deps.closeSession(run.sessionId);
    }

    private clearTimer(scheduleId: string): void {
        this.timers.get(scheduleId)?.();
        this.timers.delete(scheduleId);
    }

    private clearTimeoutTimer(scheduleId: string): void {
        this.timeoutTimers.get(scheduleId)?.();
        this.timeoutTimers.delete(scheduleId);
    }

    private background(work: Promise<void>): void {
        void work.catch((error: unknown) => {
            console.error("Scheduler callback failed:", error);
        });
    }

    private broadcastUpdated(schedule: Schedule): void {
        this.deps.broadcast({ type: MSG.SCHEDULE_UPDATED, payload: schedule });
    }
}

export { SchedulerService, SYSTEM_PROMPT_ADDON, validateExpression };
