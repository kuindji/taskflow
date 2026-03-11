import type { ApiRouter } from "./router";
import type { TaskStore } from "../services/task-store";
import type { PtyManager } from "../services/pty-manager";
import type { SessionStatus, Task, WsEvent } from "@taskflow/shared";
import { MSG } from "@taskflow/shared";

interface ApiRouteDeps {
    apiRouter: ApiRouter;
    taskStore: TaskStore;
    ptyManager: PtyManager;
    broadcast: (event: WsEvent) => void;
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
    const { apiRouter, taskStore, ptyManager, broadcast } = deps;
    const allowedSessionStatuses = new Set<SessionStatus>(["idle", "working", "attention"]);

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

    apiRouter.register("POST", "/api/sessions/:sessionId/status", async (req, params) => {
        let body: Record<string, unknown>;
        try {
            body = (await req.json()) as Record<string, unknown>;
        } catch {
            return errorResponse("Invalid JSON body", 400);
        }

        const status = body.status;
        if (typeof status !== "string" || !allowedSessionStatuses.has(status as SessionStatus)) {
            return errorResponse(
                'Field "status" must be one of: idle, working, attention',
                400,
            );
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
}
