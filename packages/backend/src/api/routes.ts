import type { ApiRouter } from "./router";
import type { TaskStore } from "../services/task-store";
import type { PtyManager } from "../services/pty-manager";
import type { SettingsStore } from "../services/settings-store";
import type { FlowStore } from "../services/flow-store";
import type { FlowRunner } from "../services/flow-runner";
import type { GitService } from "../services/git-service";
import type { ChangeTracker } from "../services/change-tracker";
import type { TrayStateTracker } from "../services/tray-state-tracker";
import type { NotificationStore } from "../services/notification-store";
import type { NotificationDeletedEvent } from "@taskflow/shared";
import type {
    AgentAvailability,
    AgentType,
    SessionStatus,
    Task,
    TaskLogEntryType,
    WsEvent,
    SettingsUpdatePayload,
} from "@taskflow/shared";
import { MSG } from "@taskflow/shared";
import type { CreateSessionOpts } from "../services/session-lifecycle";
import { filterTaskSessions } from "../services/instance-filter";
import { config } from "../config";

interface ApiRouteDeps {
    apiRouter: ApiRouter;
    taskStore: TaskStore;
    ptyManager: PtyManager;
    broadcast: (event: WsEvent) => void;
    settingsStore: SettingsStore;
    flowStore: FlowStore;
    flowRunner: FlowRunner;
    gitService: GitService;
    generateTitle?: (taskId: string, description: string) => void;
    changeTracker?: ChangeTracker;
    agents: AgentAvailability[];
    sessionLifecycle: { createSession: (opts: CreateSessionOpts) => Promise<string> };
    schedulerService: { handleComplete: (sessionId: string) => Promise<void> };
    trayStateTracker: TrayStateTracker;
    notificationStore: NotificationStore;
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
    const {
        apiRouter,
        taskStore,
        ptyManager,
        broadcast,
        settingsStore,
        flowStore,
        flowRunner,
        gitService,
        generateTitle,
        changeTracker,
        agents,
        sessionLifecycle,
        schedulerService,
        trayStateTracker,
        notificationStore,
    } = deps;
    const allowedSessionStatuses = new Set<SessionStatus>(["working", "attention", "initializing"]);

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
            const filtered = filterTaskSessions(updated, config.instanceId);
            broadcast({ type: MSG.TASK_UPDATED, payload: filtered });
            return jsonResponse(filtered);
        } catch (err) {
            const message = err instanceof Error ? err.message : "Unknown error";
            if (message.includes("not found")) {
                return errorResponse(message, 404);
            }
            return errorResponse(message, 500);
        }
    });

    apiRouter.register("PATCH", "/api/tasks/:taskId/worktree", async (req, params) => {
        let body: Record<string, unknown>;
        try {
            body = (await req.json()) as Record<string, unknown>;
        } catch {
            return errorResponse("Invalid JSON body", 400);
        }

        if (typeof body.enabled !== "boolean") {
            return errorResponse('Field "enabled" must be a boolean', 400);
        }

        try {
            const task = await taskStore.getTask(params.taskId);
            if (!task) {
                return errorResponse(`Task not found: ${params.taskId}`, 404);
            }

            if (!body.enabled) {
                if (!task.worktree.enabled) {
                    return errorResponse("Worktree is already disabled", 400);
                }

                const project = await taskStore.getProject(task.projectId);
                if (!project) {
                    return errorResponse(`Project not found: ${task.projectId}`, 404);
                }

                if (task.worktree.branch) {
                    const merged = await gitService.isBranchMerged(
                        project.path,
                        task.worktree.branch,
                    );
                    if (!merged) {
                        return errorResponse(
                            `Branch "${task.worktree.branch}" has not been merged`,
                            409,
                        );
                    }
                }

                if (task.worktree.path && task.worktree.branch) {
                    try {
                        await gitService.removeWorktree(project.path, task.worktree.path);
                    } catch {
                        // Worktree may already be removed
                    }
                    try {
                        await gitService.deleteBranch(project.path, task.worktree.branch);
                    } catch {
                        // Branch may already be deleted
                    }
                }
                changeTracker?.untrack(params.taskId);
            } else {
                // Enabling — if a worktree path already exists, start tracking
                if (task.worktree.path) {
                    changeTracker?.track(params.taskId, task.worktree.path);
                }
            }

            const updated = await taskStore.updateTask(params.taskId, {
                worktree: { ...task.worktree, enabled: body.enabled },
            });
            const filtered = filterTaskSessions(updated, config.instanceId);
            broadcast({ type: MSG.TASK_UPDATED, payload: filtered });
            return jsonResponse(filtered);
        } catch (err) {
            const message = err instanceof Error ? err.message : "Unknown error";
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
            return jsonResponse({ task: filterTaskSessions(task, config.instanceId), log });
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

    apiRouter.register("GET", "/api/projects/:projectId/tasks", async (_req, params) => {
        try {
            const tasks = await taskStore.listTasks(params.projectId);
            return jsonResponse({
                tasks: tasks.map((t) => filterTaskSessions(t, config.instanceId)),
            });
        } catch (err) {
            const message = err instanceof Error ? err.message : "Unknown error";
            return errorResponse(message, 500);
        }
    });

    apiRouter.register("POST", "/api/projects/:projectId/tasks", async (req, params) => {
        let body: Record<string, unknown>;
        try {
            body = (await req.json()) as Record<string, unknown>;
        } catch {
            return errorResponse("Invalid JSON body", 400);
        }

        const description = body.description;
        if (typeof description !== "string" || !description.trim()) {
            return errorResponse(
                'Field "description" is required and must be a non-empty string',
                400,
            );
        }

        const title =
            typeof body.title === "string" && body.title.trim() ? body.title.trim() : undefined;

        try {
            const task = await taskStore.createTask({
                projectId: params.projectId,
                title: title ?? "",
                description: description.trim(),
            });

            if (!title && generateTitle) {
                generateTitle(task.id, description.trim());
            }

            broadcast({ type: MSG.TASK_CREATED, payload: task });
            return jsonResponse(task, 201);
        } catch (err) {
            const message = err instanceof Error ? err.message : "Unknown error";
            return errorResponse(message, 500);
        }
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

    apiRouter.register("GET", "/api/settings", async () => {
        return jsonResponse(await settingsStore.get());
    });

    apiRouter.register("GET", "/api/tray-state", async () => {
        return jsonResponse({ status: trayStateTracker.getAggregateState() });
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

    // --- Flow action completion ---

    apiRouter.register("POST", "/api/flow/action-complete", async (req) => {
        let body: Record<string, unknown>;
        try {
            body = (await req.json()) as Record<string, unknown>;
        } catch {
            return errorResponse("Invalid JSON body", 400);
        }

        const { taskId, projectId, flowId, sessionId } = body;
        const ownerId =
            typeof taskId === "string"
                ? taskId
                : typeof projectId === "string"
                  ? projectId
                  : undefined;
        if (!ownerId || typeof flowId !== "string" || typeof sessionId !== "string") {
            return errorResponse(
                "Fields flowId, sessionId, and one of taskId/projectId are required strings",
                400,
            );
        }

        try {
            await flowRunner.handleActionComplete(ownerId, flowId, sessionId);
            return jsonResponse({ success: true });
        } catch (err) {
            const message = err instanceof Error ? err.message : "Unknown error";
            return errorResponse(message, 500);
        }
    });

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

    // --- Flow artifacts ---

    apiRouter.register("POST", "/api/flow/artifact", async (req) => {
        let body: Record<string, unknown>;
        try {
            body = (await req.json()) as Record<string, unknown>;
        } catch {
            return errorResponse("Invalid JSON body", 400);
        }

        const { taskId, projectId, flowId, actionEntryId, sessionId, type, path, text } = body;
        const ownerId =
            typeof taskId === "string"
                ? taskId
                : typeof projectId === "string"
                  ? projectId
                  : undefined;
        if (
            !ownerId ||
            typeof flowId !== "string" ||
            typeof actionEntryId !== "string" ||
            typeof sessionId !== "string" ||
            typeof type !== "string"
        ) {
            return errorResponse(
                "Fields flowId, actionEntryId, sessionId, type, and one of taskId/projectId are required strings",
                400,
            );
        }

        const hasPath = typeof path === "string";
        const hasText = typeof text === "string";
        if (hasPath === hasText) {
            return errorResponse("Exactly one of path or text is required", 400);
        }

        try {
            await flowRunner.saveArtifact(ownerId, flowId, actionEntryId, sessionId, {
                type,
                path: hasPath ? path : undefined,
                text: hasText ? text : undefined,
            });
            return jsonResponse({ success: true });
        } catch (err) {
            const message = err instanceof Error ? err.message : "Unknown error";
            if (message === "No flow run found") {
                return errorResponse(message, 404);
            }
            if (
                message === "Flow run is not active" ||
                message === "No running action available for artifact save" ||
                message === "Artifacts can only be saved for the current action" ||
                message === "Artifacts can only be saved by the active action session" ||
                message === "Artifact must include exactly one of path or text"
            ) {
                return errorResponse(message, 409);
            }
            return errorResponse(message, 500);
        }
    });

    apiRouter.register("GET", "/api/flow/artifact/:ownerId/:flowId", async (_req, params) => {
        const run = await flowStore.getFlowRun(params.ownerId, params.flowId);
        if (!run) return errorResponse("Flow run not found", 404);
        return jsonResponse({ artifacts: flowRunner.getArtifacts(run) });
    });

    // ── Notifications ──────────────────────────────────────────────
    apiRouter.register("GET", "/api/notifications", async () => {
        const notifications = await notificationStore.list();
        return jsonResponse({ notifications });
    });

    apiRouter.register("POST", "/api/notifications", async (req) => {
        const projectId = req.headers.get("x-taskflow-project-id");
        const sessionId = req.headers.get("x-taskflow-session-id");
        const taskId = req.headers.get("x-taskflow-task-id") || undefined;

        if (!projectId || !sessionId) {
            return errorResponse("Missing required headers: x-taskflow-project-id, x-taskflow-session-id", 400);
        }

        let body: { message?: unknown };
        try {
            body = (await req.json()) as { message?: unknown };
        } catch {
            return errorResponse("Invalid JSON body", 400);
        }

        if (typeof body.message !== "string" || !body.message.trim()) {
            return errorResponse("Field 'message' is required and must be a non-empty string", 400);
        }

        const notification = await notificationStore.create(projectId, sessionId, body.message.trim(), taskId);
        broadcast({ type: MSG.NOTIFICATION_CREATED, payload: { notification } });
        return jsonResponse(notification, 201);
    });

    apiRouter.register("PATCH", "/api/notifications/:id", async (_req, params) => {
        const notification = await notificationStore.markAsRead(params.id);
        if (!notification) return errorResponse("Notification not found", 404);
        broadcast({ type: MSG.NOTIFICATION_UPDATED, payload: { notification } });
        return jsonResponse(notification);
    });

    apiRouter.register("DELETE", "/api/notifications/:id", async (_req, params) => {
        const deleted = await notificationStore.delete(params.id);
        if (!deleted) return errorResponse("Notification not found", 404);
        const event: NotificationDeletedEvent = { id: params.id };
        broadcast({ type: MSG.NOTIFICATION_DELETED, payload: event });
        return jsonResponse({ success: true });
    });

    apiRouter.register("DELETE", "/api/notifications", async () => {
        await notificationStore.deleteAll();
        const event: NotificationDeletedEvent = { all: true };
        broadcast({ type: MSG.NOTIFICATION_DELETED, payload: event });
        return jsonResponse({ success: true });
    });

    apiRouter.register("GET", "/api/flow/artifact/:ownerId/:flowId/:type", async (_req, params) => {
        const run = await flowStore.getFlowRun(params.ownerId, params.flowId);
        if (!run) return errorResponse("Flow run not found", 404);
        const artifacts = flowRunner.getArtifacts(run, params.type);
        if (artifacts.length === 0) return errorResponse("Artifact not found", 404);
        return jsonResponse(artifacts[0]);
    });

    // --- Flow input values ---

    apiRouter.register("GET", "/api/flow/input/:ownerId/:flowId", async (_req, params) => {
        const run = await flowStore.getFlowRun(params.ownerId, params.flowId);
        if (!run) return errorResponse("Flow run not found", 404);
        return jsonResponse({ inputValues: run.inputValues ?? {} });
    });

    apiRouter.register("GET", "/api/flow/input/:ownerId/:flowId/:inputId", async (_req, params) => {
        const run = await flowStore.getFlowRun(params.ownerId, params.flowId);
        if (!run) return errorResponse("Flow run not found", 404);
        const value = run.inputValues?.[params.inputId];
        if (value === undefined) {
            return errorResponse(`Input "${params.inputId}" not found`, 404);
        }
        // Return plain text for easy CLI consumption (no JSON parsing needed)
        return new Response(value, {
            status: 200,
            headers: { "Content-Type": "text/plain" },
        });
    });

    // --- Agents ---

    apiRouter.register("GET", "/api/agents", async () => {
        return jsonResponse({ agents });
    });

    // --- Sessions ---

    const availableAgentTypes = new Set(agents.filter((a) => a.available).map((a) => a.type));

    apiRouter.register("POST", "/api/sessions", async (req) => {
        let body: Record<string, unknown>;
        try {
            body = (await req.json()) as Record<string, unknown>;
        } catch {
            return errorResponse("Invalid JSON body", 400);
        }

        const { projectId, type, taskId, prompt, label } = body;

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
            });

            return jsonResponse({ sessionId }, 201);
        } catch (err) {
            const message = err instanceof Error ? err.message : "Unknown error";
            return errorResponse(message, 500);
        }
    });
}
