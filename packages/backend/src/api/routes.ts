import type { ApiRouter } from "./router";
import type { TaskStore } from "../services/task-store";
import type { PtyManager } from "../services/pty-manager";
import type { SettingsStore } from "../services/settings-store";
import type { FlowStore } from "../services/flow-store";
import type { FlowRunner } from "../services/flow-runner";
import type {
    SessionStatus,
    Task,
    TaskLogEntryType,
    WsEvent,
    SettingsUpdatePayload,
} from "@taskflow/shared";
import { MSG } from "@taskflow/shared";

interface ApiRouteDeps {
    apiRouter: ApiRouter;
    taskStore: TaskStore;
    ptyManager: PtyManager;
    broadcast: (event: WsEvent) => void;
    settingsStore: SettingsStore;
    flowStore: FlowStore;
    flowRunner: FlowRunner;
}

function jsonResponse(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

function errorResponse(message: string, status: number): Response {
    return jsonResponse({ error: message }, status);
}

export function registerApiRoutes(deps: ApiRouteDeps): void {
    const { apiRouter, taskStore, ptyManager, broadcast, settingsStore, flowStore, flowRunner } =
        deps;
    const allowedSessionStatuses = new Set<SessionStatus>(["working", "attention"]);

    apiRouter.register("PATCH", "/api/tasks/:taskId", async (req, params) => {
        let body: Record<string, unknown>;
        try {
            body = (await req.json()) as Record<string, unknown>;
        } catch {
            return errorResponse("Invalid JSON body", 400);
        }

        const allowedFields = ["title", "description", "notes"] as const;
        const updates: Partial<Pick<Task, "title" | "description" | "notes">> = {};
        for (const field of allowedFields) {
            if (field in body) {
                const value = body[field];
                if (typeof value !== "string") {
                    return errorResponse(`Field "${field}" must be a string`, 400);
                }
                updates[field] = value;
            }
        }

        if (Object.keys(updates).length === 0) {
            return errorResponse("No valid fields to update", 400);
        }

        try {
            const updated = await taskStore.updateTask(params.taskId, updates);
            broadcast({ type: MSG.TASK_UPDATED, payload: updated });
            return jsonResponse(updated);
        } catch (err) {
            const message = err instanceof Error ? err.message : "Unknown error";
            if (message.includes("not found")) {
                return errorResponse(message, 404);
            }
            return errorResponse(message, 500);
        }
    });

    apiRouter.register("GET", "/api/tasks/:taskId", async (_req, params) => {
        try {
            const task = await taskStore.getTask(params.taskId);
            if (!task) {
                return errorResponse(`Task not found: ${params.taskId}`, 404);
            }
            const log = await taskStore.getTaskLog(params.taskId);
            return jsonResponse({ task, log });
        } catch (err) {
            const message = err instanceof Error ? err.message : "Unknown error";
            return errorResponse(message, 500);
        }
    });

    const allowedLogTypes = new Set<TaskLogEntryType>(["info", "commit", "warning", "error"]);

    apiRouter.register("POST", "/api/tasks/:taskId/log", async (req, params) => {
        let body: Record<string, unknown>;
        try {
            body = (await req.json()) as Record<string, unknown>;
        } catch {
            return errorResponse("Invalid JSON body", 400);
        }

        const type = body.type;
        if (typeof type !== "string" || !allowedLogTypes.has(type as TaskLogEntryType)) {
            return errorResponse('Field "type" must be one of: info, commit, warning, error', 400);
        }

        const message = body.message;
        if (typeof message !== "string" || !message.trim()) {
            return errorResponse('Field "message" is required and must be a non-empty string', 400);
        }

        const sessionId =
            typeof body.sessionId === "string"
                ? body.sessionId
                : (req.headers.get("x-taskflow-session-id") ?? "unknown");

        let meta: Record<string, string> | undefined;
        if (body.meta && typeof body.meta === "object" && !Array.isArray(body.meta)) {
            meta = {};
            for (const [k, v] of Object.entries(body.meta as Record<string, unknown>)) {
                if (typeof v === "string") {
                    meta[k] = v;
                }
            }
        }

        try {
            const task = await taskStore.getTask(params.taskId);
            if (!task) {
                return errorResponse(`Task not found: ${params.taskId}`, 404);
            }

            const entry = await taskStore.appendTaskLog(
                params.taskId,
                sessionId,
                type as TaskLogEntryType,
                message.trim(),
                meta,
            );

            broadcast({
                type: MSG.TASK_LOG_ADDED,
                payload: { taskId: params.taskId, entry },
            });

            return jsonResponse({ entry }, 201);
        } catch (err) {
            const msg = err instanceof Error ? err.message : "Unknown error";
            return errorResponse(msg, 500);
        }
    });

    apiRouter.register("POST", "/api/tasks/:taskId/browser", async (req, params) => {
        let body: Record<string, unknown>;
        try {
            body = (await req.json()) as Record<string, unknown>;
        } catch {
            return errorResponse("Invalid JSON body", 400);
        }

        const url = body.url;
        if (typeof url !== "string" || !url.trim()) {
            return errorResponse('Field "url" is required and must be a non-empty string', 400);
        }

        const label = typeof body.label === "string" ? body.label : undefined;

        broadcast({
            type: MSG.BROWSER_OPEN,
            payload: { taskId: params.taskId, url, label },
        });

        return jsonResponse({ success: true });
    });

    apiRouter.register("POST", "/api/projects/:projectId/browser", async (req, params) => {
        let body: Record<string, unknown>;
        try {
            body = (await req.json()) as Record<string, unknown>;
        } catch {
            return errorResponse("Invalid JSON body", 400);
        }

        const url = body.url;
        if (typeof url !== "string" || !url.trim()) {
            return errorResponse('Field "url" is required and must be a non-empty string', 400);
        }

        const label = typeof body.label === "string" ? body.label : undefined;

        broadcast({
            type: MSG.BROWSER_OPEN,
            payload: { projectId: params.projectId, url, label },
        });

        return jsonResponse({ success: true });
    });

    apiRouter.register("POST", "/api/sessions/:sessionId/status", async (req, params) => {
        let body: Record<string, unknown>;
        try {
            body = (await req.json()) as Record<string, unknown>;
        } catch {
            return errorResponse("Invalid JSON body", 400);
        }

        const status = body.status;
        if (typeof status !== "string" || !allowedSessionStatuses.has(status as SessionStatus)) {
            return errorResponse('Field "status" must be one of: working, attention', 400);
        }

        if (!ptyManager.has(params.sessionId)) {
            return errorResponse(`Session not found: ${params.sessionId}`, 404);
        }

        broadcast({
            type: MSG.SESSION_STATUS,
            payload: { sessionId: params.sessionId, status },
        });

        return jsonResponse({ success: true });
    });

    apiRouter.register("POST", "/api/sessions/:sessionId/done", async (_req, params) => {
        const { sessionId } = params;

        if (!ptyManager.has(sessionId)) {
            return errorResponse(`Session not found: ${sessionId}`, 404);
        }

        ptyManager.close(sessionId);
        return jsonResponse({ success: true });
    });

    apiRouter.register("GET", "/api/settings", async () => {
        return jsonResponse(await settingsStore.get());
    });

    apiRouter.register("PATCH", "/api/settings", async (req) => {
        let body: SettingsUpdatePayload;
        try {
            body = (await req.json()) as SettingsUpdatePayload;
        } catch {
            return errorResponse("Invalid JSON body", 400);
        }
        return jsonResponse(await settingsStore.update(body));
    });

    // --- Flow step completion ---

    apiRouter.register("POST", "/api/flow/step-complete", async (req) => {
        let body: Record<string, unknown>;
        try {
            body = (await req.json()) as Record<string, unknown>;
        } catch {
            return errorResponse("Invalid JSON body", 400);
        }

        const { taskId, flowId, sessionId } = body;
        if (typeof taskId !== "string" || typeof flowId !== "string" || typeof sessionId !== "string") {
            return errorResponse("Fields taskId, flowId, and sessionId are required strings", 400);
        }

        try {
            await flowRunner.handleStepComplete(taskId, flowId, sessionId);
            return jsonResponse({ success: true });
        } catch (err) {
            const message = err instanceof Error ? err.message : "Unknown error";
            return errorResponse(message, 500);
        }
    });

    // --- Flow artifacts ---

    apiRouter.register("POST", "/api/flow/artifact", async (req) => {
        let body: Record<string, unknown>;
        try {
            body = (await req.json()) as Record<string, unknown>;
        } catch {
            return errorResponse("Invalid JSON body", 400);
        }

        const { taskId, flowId, stepEntryId, type, path, text } = body;
        if (
            typeof taskId !== "string" ||
            typeof flowId !== "string" ||
            typeof stepEntryId !== "string" ||
            typeof type !== "string"
        ) {
            return errorResponse("Fields taskId, flowId, stepEntryId, and type are required strings", 400);
        }

        try {
            await flowRunner.saveArtifact(taskId, flowId, stepEntryId, {
                type,
                path: typeof path === "string" ? path : undefined,
                text: typeof text === "string" ? text : undefined,
            });
            return jsonResponse({ success: true });
        } catch (err) {
            const message = err instanceof Error ? err.message : "Unknown error";
            return errorResponse(message, 500);
        }
    });

    apiRouter.register("GET", "/api/flow/artifact/:taskId/:flowId", async (_req, params) => {
        const run = await flowStore.getFlowRun(params.taskId, params.flowId);
        if (!run) return errorResponse("Flow run not found", 404);
        return jsonResponse({ artifacts: flowRunner.getArtifacts(run) });
    });

    apiRouter.register("GET", "/api/flow/artifact/:taskId/:flowId/:type", async (_req, params) => {
        const run = await flowStore.getFlowRun(params.taskId, params.flowId);
        if (!run) return errorResponse("Flow run not found", 404);
        const artifacts = flowRunner.getArtifacts(run, params.type);
        if (artifacts.length === 0) return errorResponse("Artifact not found", 404);
        return jsonResponse(artifacts[0]);
    });
}
