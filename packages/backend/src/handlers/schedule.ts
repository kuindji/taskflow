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

// Narrow payload types without `as any` — the router handler signature is
// (payload: unknown) => Promise<unknown>, so this cast is safe at the boundary.
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
            const all = await scheduleStore.getAll();
            const schedules = payload.projectId
                ? all.filter((s) => s.projectId === payload.projectId)
                : all;
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
                const next: Schedule = {
                    ...existing,
                    updatedAt: new Date().toISOString(),
                };
                if (payload.name !== undefined) next.name = payload.name;
                if (payload.prompt !== undefined) next.prompt = payload.prompt;
                if (payload.expression !== undefined) next.expression = payload.expression;
                if (payload.expressionType !== undefined)
                    next.expressionType = payload.expressionType;
                if (payload.timeout !== undefined) next.timeout = payload.timeout;
                if (payload.enabled !== undefined) next.enabled = payload.enabled;
                if ("agentType" in payload) next.agentType = payload.agentType ?? undefined;
                if ("agentOptions" in payload)
                    next.agentOptions = payload.agentOptions ?? undefined;
                return next;
            });
            await schedulerService.onScheduleUpdated(updated.id);
            return updated;
        }),
    );

    router.register(
        MSG.SCHEDULE_DELETE,
        typed<ScheduleDeletePayload>(async (payload) => {
            const schedule = await scheduleStore.getById(payload.id);
            const runningSessionId = schedule?.runningSessionId ?? null;
            await scheduleStore.delete(payload.id);
            await schedulerService.onScheduleDeleted(payload.id, runningSessionId);
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
