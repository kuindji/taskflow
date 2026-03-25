import type { ApiRouter } from "../router";
import type { TaskStore } from "../../services/task-store";
import type { PtyManager } from "../../services/pty-manager";
import type { SettingsStore } from "../../services/settings-store";
import type { TrayStateTracker } from "../../services/tray-state-tracker";
import type {
    AgentAvailability,
    AgentType,
    SessionRef,
    SessionStatus,
    WsEvent,
} from "@taskflow/shared";
import { MSG } from "@taskflow/shared";
import type { CreateSessionOpts } from "../../services/session-lifecycle";
import { jsonResponse, errorResponse } from "./response-helpers";

interface SessionRouteDeps {
    apiRouter: ApiRouter;
    taskStore: TaskStore;
    ptyManager: PtyManager;
    broadcast: (event: WsEvent) => void;
    settingsStore: SettingsStore;
    trayStateTracker: TrayStateTracker;
    agents: AgentAvailability[];
    sessionLifecycle: {
        createSession: (opts: CreateSessionOpts) => Promise<string>;
        removeSessionFromOwner: (
            sessionId: string,
            owner?: { taskId?: string; projectId?: string },
        ) => Promise<void>;
    };
}

function registerSessionRoutes(deps: SessionRouteDeps): void {
    const {
        apiRouter,
        taskStore,
        ptyManager,
        broadcast,
        settingsStore,
        trayStateTracker,
        agents,
        sessionLifecycle,
    } = deps;

    const allowedSessionStatuses = new Set<SessionStatus>(["working", "attention", "initializing"]);
    const availableAgentTypes = new Set(agents.filter((a) => a.available).map((a) => a.type));

    apiRouter.register("GET", "/api/sessions/:sessionId/status", async (_req, params) => {
        const status = trayStateTracker.getSessionStatus(params.sessionId);
        return jsonResponse({ status });
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
                `Field "status" must be one of: ${[...allowedSessionStatuses].join(", ")}`,
                400,
            );
        }

        if (!ptyManager.has(params.sessionId)) {
            return errorResponse(`Session not found: ${params.sessionId}`, 404);
        }

        const nextStatus = status as SessionStatus;
        trayStateTracker.setSessionStatus(params.sessionId, nextStatus);
        broadcast({
            type: MSG.SESSION_STATUS,
            payload: { sessionId: params.sessionId, status: nextStatus },
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

    apiRouter.register("POST", "/api/sessions/:sessionId/input", async (req, params) => {
        let body: Record<string, unknown>;
        try {
            body = (await req.json()) as Record<string, unknown>;
        } catch {
            return errorResponse("Invalid JSON body", 400);
        }

        const data = body.data;
        if (typeof data !== "string" || data.length === 0) {
            return errorResponse('Field "data" must be a non-empty string', 400);
        }

        const { sessionId } = params;
        if (!ptyManager.has(sessionId)) {
            return errorResponse(`Session not found: ${sessionId}`, 404);
        }

        const raw = body.raw === true;
        ptyManager.write(sessionId, raw ? data : data + "\r");
        return jsonResponse({ success: true });
    });

    apiRouter.register("POST", "/api/sessions", async (req) => {
        let body: Record<string, unknown>;
        try {
            body = (await req.json()) as Record<string, unknown>;
        } catch {
            return errorResponse("Invalid JSON body", 400);
        }

        const { projectId, type, taskId, prompt, label, agentOptions } = body;

        if (typeof projectId !== "string" || !projectId.trim()) {
            return errorResponse(
                'Field "projectId" is required and must be a non-empty string',
                400,
            );
        }

        // Resolve agent type: use provided value or fall back to defaultAgent setting
        let resolvedType: AgentType;
        if (type !== undefined) {
            if (typeof type !== "string" || !availableAgentTypes.has(type as AgentType)) {
                return errorResponse(
                    `Field "type" must be one of the available agent types: ${[...availableAgentTypes].join(", ")}`,
                    400,
                );
            }
            resolvedType = type as AgentType;
        } else {
            const settings = await settingsStore.get();
            resolvedType = settings.general.defaultAgent;
            if (!availableAgentTypes.has(resolvedType)) {
                return errorResponse(`Default agent "${resolvedType}" is not available`, 400);
            }
        }

        if (taskId !== undefined && typeof taskId !== "string") {
            return errorResponse('Field "taskId" must be a string', 400);
        }
        if (prompt !== undefined && typeof prompt !== "string") {
            return errorResponse('Field "prompt" must be a string', 400);
        }
        if (label !== undefined && typeof label !== "string") {
            return errorResponse('Field "label" must be a string', 400);
        }

        try {
            let resolvedPrompt = typeof prompt === "string" ? prompt : undefined;

            if (typeof taskId === "string") {
                const task = await taskStore.getTask(taskId);
                if (!task) {
                    return errorResponse(`Task not found: ${taskId}`, 404);
                }
                if (task.projectId !== projectId) {
                    return errorResponse("Task does not belong to the specified project", 400);
                }
                if (!resolvedPrompt && task.description) {
                    resolvedPrompt = task.description;
                }
            }

            const sessionId = await sessionLifecycle.createSession({
                owner: typeof taskId === "string" ? { taskId } : { projectId },
                type: resolvedType,
                prompt: resolvedPrompt,
                label: typeof label === "string" ? label : undefined,
                agentOptions:
                    agentOptions && typeof agentOptions === "object" && !Array.isArray(agentOptions)
                        ? (agentOptions as import("@taskflow/shared").AgentLaunchOptions)
                        : undefined,
            });

            return jsonResponse({ sessionId }, 201);
        } catch (err) {
            const message = err instanceof Error ? err.message : "Unknown error";
            return errorResponse(message, 500);
        }
    });

    // ── Session rename ─────────────────────────────────────────────

    apiRouter.register("POST", "/api/sessions/:sessionId/rename", async (req, params) => {
        let body: Record<string, unknown>;
        try {
            body = (await req.json()) as Record<string, unknown>;
        } catch {
            return errorResponse("Invalid JSON body", 400);
        }

        const { label } = body;
        if (typeof label !== "string" || !label.trim()) {
            return errorResponse('Field "label" is required and must be a non-empty string', 400);
        }

        const { sessionId } = params;

        const updateLabel = (sessions: SessionRef[]) =>
            sessions.map((s) => (s.id === sessionId ? { ...s, label } : s));

        try {
            const tasks = await taskStore.listTasks();
            const ownerTask = tasks.find((t) => t.sessions.some((s) => s.id === sessionId));
            if (ownerTask) {
                await taskStore.updateTask(ownerTask.id, (task) => ({
                    sessions: updateLabel(task.sessions),
                }));
                return jsonResponse({ success: true });
            }

            const projects = await taskStore.listProjects();
            const ownerProject = projects.find((p) => p.sessions.some((s) => s.id === sessionId));
            if (ownerProject) {
                await taskStore.updateProject(ownerProject.id, (project) => ({
                    sessions: updateLabel(project.sessions),
                }));
                return jsonResponse({ success: true });
            }

            return errorResponse(`Session not found: ${sessionId}`, 404);
        } catch (err) {
            const message = err instanceof Error ? err.message : "Unknown error";
            return errorResponse(message, 500);
        }
    });

    // ── Session snapshot ───────────────────────────────────────────

    apiRouter.register("GET", "/api/sessions/:sessionId/snapshot", async (_req, params) => {
        if (!ptyManager.has(params.sessionId)) {
            return errorResponse(`Session not found: ${params.sessionId}`, 404);
        }
        return jsonResponse(ptyManager.getSnapshot(params.sessionId));
    });

    // ── Session tail ──────────────────────────────────────────────

    apiRouter.register("GET", "/api/sessions/:sessionId/tail", async (req, params) => {
        if (!ptyManager.has(params.sessionId)) {
            return errorResponse(`Session not found: ${params.sessionId}`, 404);
        }
        const url = new URL(req.url);
        const lines = Math.max(1, parseInt(url.searchParams.get("lines") ?? "100", 10) || 100);
        const { data } = ptyManager.getScrollback(params.sessionId);
        const allLines = data.split("\n");
        const tail = allLines.slice(-lines).join("\n");
        return new Response(tail, {
            headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
    });
}

export { registerSessionRoutes };
export type { SessionRouteDeps };
