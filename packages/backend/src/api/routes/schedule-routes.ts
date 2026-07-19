import type { ApiRouter } from "../router";
import type { FlowStore } from "../../services/flow-store";
import type { ScheduleStore } from "../../services/schedule-store";
import type { SchedulerService } from "../../services/scheduler-service";
import { validateExpression } from "../../services/scheduler-service";
import { isAgentType } from "@taskflow/shared";
import type { Schedule } from "@taskflow/shared";
import { jsonResponse, errorResponse } from "./response-helpers";

interface ScheduleRouteDeps {
    apiRouter: ApiRouter;
    flowStore: FlowStore;
    scheduleStore: ScheduleStore;
    schedulerService: SchedulerService;
    generateScheduleName: (prompt: string) => Promise<string>;
}

function registerScheduleRoutes(deps: ScheduleRouteDeps): void {
    const { apiRouter, flowStore, scheduleStore, schedulerService, generateScheduleName } = deps;

    apiRouter.register("GET", "/api/schedules", async (req) => {
        const url = new URL(req.url);
        const projectId = url.searchParams.get("projectId") ?? undefined;
        const all = await scheduleStore.getAll();
        const schedules = projectId ? all.filter((s) => s.projectId === projectId) : all;
        return jsonResponse({ schedules });
    });

    apiRouter.register("POST", "/api/schedules", async (req) => {
        let body: Record<string, unknown>;
        try {
            body = (await req.json()) as Record<string, unknown>;
        } catch {
            return errorResponse("Invalid JSON body", 400);
        }

        const { projectId, expression, expressionType } = body;
        if (typeof projectId !== "string") {
            return errorResponse('Field "projectId" is required', 400);
        }
        if (typeof expression !== "string") {
            return errorResponse('Field "expression" is required', 400);
        }
        if (expressionType !== "cron" && expressionType !== "rate") {
            return errorResponse('Field "expressionType" must be "cron" or "rate"', 400);
        }

        try {
            validateExpression(expression, expressionType);
        } catch (err) {
            const message = err instanceof Error ? err.message : "Invalid expression";
            return errorResponse(message, 400);
        }

        const { randomUUID } = await import("crypto");
        const now = new Date().toISOString();

        let name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : "";
        if (!name) {
            if (typeof body.actionId === "string") {
                const actions = await flowStore.getActions();
                const action = actions.find((a) => a.id === body.actionId);
                name = action?.name ?? "Scheduled action";
            } else if (typeof body.prompt === "string" && body.prompt.trim()) {
                name = await generateScheduleName(body.prompt);
            }
        }

        const schedule: Schedule = {
            id: randomUUID(),
            projectId,
            name,
            prompt: typeof body.prompt === "string" ? body.prompt : "",
            actionId: typeof body.actionId === "string" ? body.actionId : undefined,
            agentType:
                body.agentType === "shell" || isAgentType(body.agentType)
                    ? body.agentType
                    : undefined,
            agentOptions: body.agentOptions as Schedule["agentOptions"],
            expression,
            expressionType,
            timeout: typeof body.timeout === "number" ? body.timeout : 30,
            enabled: typeof body.enabled === "boolean" ? body.enabled : true,
            lastRunAt: null,
            lastError: null,
            nextRunAt: null,
            runningSessionId: null,
            createdAt: now,
            updatedAt: now,
        };

        try {
            await scheduleStore.save(schedule);
            await schedulerService.onScheduleCreated(schedule.id);
            return jsonResponse(schedule, 201);
        } catch (err) {
            const message = err instanceof Error ? err.message : "Unknown error";
            console.error("[api] POST /api/schedules failed:", err);
            return errorResponse(message, 500);
        }
    });

    apiRouter.register("PATCH", "/api/schedules/:id", async (req, params) => {
        let body: Record<string, unknown>;
        try {
            body = (await req.json()) as Record<string, unknown>;
        } catch {
            return errorResponse("Invalid JSON body", 400);
        }

        try {
            if (typeof body.expression === "string") {
                const existing = await scheduleStore.getById(params.id);
                const type =
                    typeof body.expressionType === "string"
                        ? (body.expressionType as "cron" | "rate")
                        : (existing?.expressionType ?? "rate");
                validateExpression(body.expression, type);
            }

            const updated = await scheduleStore.update(params.id, (existing) => {
                const next: Schedule = { ...existing, updatedAt: new Date().toISOString() };
                if (typeof body.name === "string") next.name = body.name;
                if (typeof body.prompt === "string") next.prompt = body.prompt;
                if ("actionId" in body)
                    next.actionId = typeof body.actionId === "string" ? body.actionId : undefined;
                if (typeof body.expression === "string") next.expression = body.expression;
                if (body.expressionType === "cron" || body.expressionType === "rate")
                    next.expressionType = body.expressionType;
                if (typeof body.timeout === "number") next.timeout = body.timeout;
                if (typeof body.enabled === "boolean") next.enabled = body.enabled;
                if ("agentType" in body)
                    next.agentType =
                        body.agentType === "shell" || isAgentType(body.agentType)
                            ? body.agentType
                            : undefined;
                if ("agentOptions" in body)
                    next.agentOptions = body.agentOptions as Schedule["agentOptions"];
                return next;
            });
            await schedulerService.onScheduleUpdated(updated.id);
            return jsonResponse(updated);
        } catch (err) {
            const message = err instanceof Error ? err.message : "Unknown error";
            if (message.includes("not found")) return errorResponse(message, 404);
            console.error("[api] PATCH /api/schedules/:id failed:", err);
            return errorResponse(message, 500);
        }
    });

    apiRouter.register("DELETE", "/api/schedules/:id", async (_req, params) => {
        try {
            const schedule = await scheduleStore.getById(params.id);
            if (!schedule) return errorResponse("Schedule not found", 404);
            const runningSessionId = schedule.runningSessionId ?? null;
            await scheduleStore.delete(params.id);
            await schedulerService.onScheduleDeleted(params.id, runningSessionId);
            return jsonResponse({ success: true });
        } catch (err) {
            const message = err instanceof Error ? err.message : "Unknown error";
            console.error("[api] DELETE /api/schedules/:id failed:", err);
            return errorResponse(message, 500);
        }
    });

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
            console.error("[api] POST /api/schedules/complete failed:", err);
            return errorResponse(message, 500);
        }
    });

    apiRouter.register("POST", "/api/schedules/:id/trigger", async (_req, params) => {
        try {
            await schedulerService.triggerNow(params.id);
            return jsonResponse({ success: true });
        } catch (err) {
            const message = err instanceof Error ? err.message : "Unknown error";
            console.error("[api] POST /api/schedules/:id/trigger failed:", err);
            return errorResponse(message, 500);
        }
    });
}

export { registerScheduleRoutes };
export type { ScheduleRouteDeps };
