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
import type { ScheduleStore } from "../services/schedule-store";
import type { RemoteAgentService } from "../services/remote-agent-service";
import type { SchedulerService } from "../services/scheduler-service";
import { validateExpression } from "../services/scheduler-service";
import type { NotificationDeletedEvent } from "@taskflow/shared";
import type {
    ActionDefinition,
    AgentAvailability,
    AgentType,
    EditorInfo,
    FlowDefinition,
    Project,
    RuntimeInfo,
    Schedule,
    SessionRef,
    SessionStatus,
    ShellInfo,
    Task,
    TaskLogEntryType,
    WsEvent,
    SettingsUpdatePayload,
} from "@taskflow/shared";
import { MSG } from "@taskflow/shared";
import type { CreateSessionOpts } from "../services/session-lifecycle";
import { filterTaskSessions, filterProjectSessions } from "../services/instance-filter";
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
    generateTitle?: (taskId: string, description: string, initCommand?: string) => void;
    createWorktree?: (taskId: string, nameSource: string, initCommand?: string) => Promise<void>;
    changeTracker?: ChangeTracker;
    agents: AgentAvailability[];
    sessionLifecycle: {
        createSession: (opts: CreateSessionOpts) => Promise<string>;
        removeSessionFromOwner: (
            sessionId: string,
            owner?: { taskId?: string; projectId?: string },
        ) => Promise<void>;
    };
    schedulerService: SchedulerService;
    trayStateTracker: TrayStateTracker;
    notificationStore: NotificationStore;
    scheduleStore: ScheduleStore;
    shells: ShellInfo[];
    systemShellPath: string | null;
    runtimes: RuntimeInfo[];
    editors: EditorInfo[];
    generateScheduleName: (prompt: string) => Promise<string>;
    remoteAgentService: RemoteAgentService;
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
        createWorktree,
        changeTracker,
        agents,
        sessionLifecycle,
        schedulerService,
        trayStateTracker,
        notificationStore,
        scheduleStore,
        shells,
        systemShellPath,
        runtimes,
        editors,
        generateScheduleName,
    } = deps;
    const allowedSessionStatuses = new Set<SessionStatus>(["working", "attention", "initializing"]);

    apiRouter.register("PATCH", "/api/tasks/:taskId", async (req, params) => {
        let body: Record<string, unknown>;
        try {
            body = (await req.json()) as Record<string, unknown>;
        } catch {
            return errorResponse("Invalid JSON body", 400);
        }

        const stringFields = ["title", "description", "notes"] as const;
        const updates: Partial<Pick<Task, "title" | "description" | "notes" | "pinned">> = {};
        for (const field of stringFields) {
            if (field in body) {
                const value = body[field];
                if (typeof value !== "string") {
                    return errorResponse(`Field "${field}" must be a string`, 400);
                }
                updates[field] = value;
            }
        }
        if ("pinned" in body) {
            if (typeof body.pinned !== "boolean") {
                return errorResponse('Field "pinned" must be a boolean', 400);
            }
            updates.pinned = body.pinned;
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

    apiRouter.register("GET", "/api/tasks/archived", async () => {
        const tasks = await taskStore.listArchived();
        return jsonResponse({
            tasks: tasks.map((t) => filterTaskSessions(t, config.instanceId)),
        });
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

        const worktree = body.worktree === true
            ? { enabled: true, path: null, branch: null, pr: null }
            : undefined;

        const hasInitCommand = Object.prototype.hasOwnProperty.call(body, "initCommand");
        const requestedInitCommand =
            typeof body.initCommand === "string" && body.initCommand.trim()
                ? body.initCommand.trim()
                : undefined;

        try {
            const resolvedInitCommand = worktree
                ? hasInitCommand
                    ? requestedInitCommand
                    : (await taskStore.getProject(params.projectId))?.defaultInitCommand
                : undefined;
            let task = await taskStore.createTask({
                projectId: params.projectId,
                title: title ?? "",
                description: description.trim(),
                worktree,
                initCommand: resolvedInitCommand,
            });

            if (worktree && createWorktree) {
                // Await worktree creation so the CLI blocks until the worktree is ready.
                // This ensures `agent run --task <id>` starts in the correct directory.
                await createWorktree(task.id, title ?? description.trim(), task.initCommand);
                task = (await taskStore.getTask(task.id)) ?? task;
            }

            if (!title && generateTitle) {
                generateTitle(task.id, description.trim(), task.initCommand);
            }

            broadcast({ type: MSG.TASK_CREATED, payload: task });
            return jsonResponse(task, 201);
        } catch (err) {
            const message = err instanceof Error ? err.message : "Unknown error";
            return errorResponse(message, 500);
        }
    });

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

    apiRouter.register("GET", "/api/settings", async () => {
        return jsonResponse(await settingsStore.get());
    });

    apiRouter.register("GET", "/api/app-name", async () => {
        const name = await deps.remoteAgentService.getAppName();
        return jsonResponse({ name });
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
            return errorResponse(
                "Missing required headers: x-taskflow-project-id, x-taskflow-session-id",
                400,
            );
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

        const notification = await notificationStore.create(
            projectId,
            sessionId,
            body.message.trim(),
            taskId,
        );
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

    // ── Projects ───────────────────────────────────────────────────

    apiRouter.register("GET", "/api/projects", async () => {
        const projects = await taskStore.listProjects();
        return jsonResponse({
            projects: projects.map((p) => filterProjectSessions(p, config.instanceId)),
        });
    });

    apiRouter.register("POST", "/api/projects", async (req) => {
        let body: Record<string, unknown>;
        try {
            body = (await req.json()) as Record<string, unknown>;
        } catch {
            return errorResponse("Invalid JSON body", 400);
        }

        const { path, name } = body;
        if (typeof path !== "string" || !path.trim()) {
            return errorResponse('Field "path" is required and must be a non-empty string', 400);
        }

        let resolvedName = typeof name === "string" && name.trim() ? name.trim() : undefined;
        if (!resolvedName) {
            const segments = path.split("/").filter(Boolean).slice(-2).join("/");
            const branch = await gitService.getBranch(path).catch(() => null);
            resolvedName = branch ? `${segments} (${branch})` : segments;
        }

        try {
            const project = await taskStore.addProject({ name: resolvedName, path: path.trim() });
            changeTracker?.track(project.id, project.path);
            return jsonResponse(project, 201);
        } catch (err) {
            const message = err instanceof Error ? err.message : "Unknown error";
            return errorResponse(message, 500);
        }
    });

    apiRouter.register("DELETE", "/api/projects/:id", async (_req, params) => {
        try {
            const project = await taskStore.getProject(params.id);
            if (!project) return errorResponse("Project not found", 404);

            const tasks = await taskStore.listTasks(params.id);
            for (const session of project.sessions) {
                ptyManager.close(session.id);
            }
            for (const task of tasks) {
                for (const session of task.sessions) {
                    ptyManager.close(session.id);
                }
            }
            await taskStore.removeProject(params.id);
            changeTracker?.untrack(params.id);
            return jsonResponse({ success: true });
        } catch (err) {
            const message = err instanceof Error ? err.message : "Unknown error";
            return errorResponse(message, 500);
        }
    });

    apiRouter.register("PATCH", "/api/projects/:id", async (req, params) => {
        let body: Record<string, unknown>;
        try {
            body = (await req.json()) as Record<string, unknown>;
        } catch {
            return errorResponse("Invalid JSON body", 400);
        }

        const updates: Partial<Pick<Project, "name" | "path" | "hidden" | "defaultInitCommand">> =
            {};
        if (typeof body.name === "string") updates.name = body.name;
        if (typeof body.path === "string") updates.path = body.path;
        if (typeof body.hidden === "boolean") updates.hidden = body.hidden;
        if (Object.prototype.hasOwnProperty.call(body, "defaultInitCommand")) {
            updates.defaultInitCommand =
                typeof body.defaultInitCommand === "string" ? body.defaultInitCommand : undefined;
        }

        if (Object.keys(updates).length === 0) {
            return errorResponse(
                "At least one of name, path, hidden, or defaultInitCommand must be provided",
                400,
            );
        }

        try {
            const updated = await taskStore.updateProject(params.id, updates);
            if (updates.path) {
                changeTracker?.untrack(params.id);
                changeTracker?.track(params.id, updates.path);
            }
            broadcast({
                type: MSG.PROJECT_UPDATED,
                payload: filterProjectSessions(updated, config.instanceId),
            });
            return jsonResponse(filterProjectSessions(updated, config.instanceId));
        } catch (err) {
            const message = err instanceof Error ? err.message : "Unknown error";
            if (message.includes("not found")) return errorResponse(message, 404);
            return errorResponse(message, 500);
        }
    });

    apiRouter.register("POST", "/api/projects/:id/fork", async (req, params) => {
        let body: Record<string, unknown>;
        try {
            body = (await req.json()) as Record<string, unknown>;
        } catch {
            return errorResponse("Invalid JSON body", 400);
        }

        const { branch, folderName } = body;
        if (typeof branch !== "string" || !branch.trim()) {
            return errorResponse('Field "branch" is required and must be a non-empty string', 400);
        }

        try {
            const project = await taskStore.getProject(params.id);
            if (!project) return errorResponse("Project not found", 404);

            const { dirname, join } = await import("path");
            const { stat, rm } = await import("fs/promises");

            const slugify = (b: string) =>
                b
                    .toLowerCase()
                    .replace(/[/ ]/g, "-")
                    .replace(/[^a-z0-9\-.]/g, "");

            const derivedFolder =
                typeof folderName === "string" && folderName.trim()
                    ? folderName.trim()
                    : slugify(branch);
            if (!derivedFolder)
                return errorResponse("Could not derive folder name from branch", 400);

            const targetPath = join(dirname(project.path), derivedFolder);

            const exists = await stat(targetPath).then(
                () => true,
                () => false,
            );
            if (exists) return errorResponse(`Folder already exists: ${targetPath}`, 409);

            const currentBranch = await gitService.getBranch(project.path);
            if (!currentBranch) return errorResponse("Could not determine current branch", 500);

            const remoteUrl = await gitService.getRemoteUrl(project.path);

            try {
                await gitService.clone(project.path, targetPath, currentBranch);
                await gitService.createBranch(targetPath, branch);
                if (remoteUrl) await gitService.setRemoteUrl(targetPath, remoteUrl);
            } catch (err) {
                await rm(targetPath, { recursive: true, force: true }).catch(() => {});
                throw err;
            }

            const segments = targetPath.split("/").filter(Boolean).slice(-2).join("/");
            const newName = `${segments} (${branch})`;

            const newProject = await taskStore.addProject({ name: newName, path: targetPath });
            changeTracker?.track(newProject.id, newProject.path);

            return jsonResponse({ project: newProject, targetPath, branch }, 201);
        } catch (err) {
            const message = err instanceof Error ? err.message : "Unknown error";
            return errorResponse(message, 500);
        }
    });

    // ── Task archive / unarchive / delete ──────────────────────────

    apiRouter.register("POST", "/api/tasks/:taskId/archive", async (_req, params) => {
        try {
            const task = await taskStore.getTask(params.taskId);
            if (!task) return errorResponse(`Task not found: ${params.taskId}`, 404);

            // Cascade: stop sessions and archive subtasks before parent
            if (!task.parentId) {
                const subtasks = await taskStore.getSubtasks(task.id);
                for (const subtask of subtasks) {
                    if (subtask.sessions.length > 0) {
                        await taskStore.updateTask(subtask.id, { sessions: [] });
                        for (const session of subtask.sessions) ptyManager.close(session.id);
                    }
                    await taskStore.archiveTask(subtask.id);
                }
            }

            // Fail active flows
            const runs = await flowStore.getFlowRunsForOwner(task.id);
            for (const run of runs) {
                if (run.status === "running" || run.status === "paused") {
                    await flowRunner.failFlowByIds(task.id, run.flowId);
                }
            }

            // Stop sessions
            if (task.sessions.length > 0) {
                await taskStore.updateTask(task.id, { sessions: [] });
                for (const session of task.sessions) ptyManager.close(session.id);
            }

            const archived = await taskStore.archiveTask(params.taskId);
            changeTracker?.untrack(params.taskId);
            const filtered = filterTaskSessions(archived, config.instanceId);
            broadcast({ type: MSG.TASK_UPDATED, payload: filtered });
            return jsonResponse(filtered);
        } catch (err) {
            const message = err instanceof Error ? err.message : "Unknown error";
            return errorResponse(message, 500);
        }
    });

    apiRouter.register("POST", "/api/tasks/:taskId/unarchive", async (_req, params) => {
        try {
            const task = await taskStore.unarchiveTask(params.taskId);

            if (!task.parentId) {
                const archivedSubtasks = await taskStore.getArchivedSubtasks(params.taskId);
                for (const subtask of archivedSubtasks) {
                    await taskStore.unarchiveTask(subtask.id);
                }
            }

            if (task.worktree.enabled && task.worktree.path && !task.parentId) {
                changeTracker?.track(task.id, task.worktree.path);
            }

            const filtered = filterTaskSessions(task, config.instanceId);
            broadcast({ type: MSG.TASK_UPDATED, payload: filtered });
            return jsonResponse(filtered);
        } catch (err) {
            const message = err instanceof Error ? err.message : "Unknown error";
            if (message.includes("not found")) return errorResponse(message, 404);
            return errorResponse(message, 500);
        }
    });

    apiRouter.register("DELETE", "/api/tasks/:taskId", async (req, params) => {
        let body: Record<string, unknown> = {};
        try {
            const text = await req.text();
            if (text) body = JSON.parse(text) as Record<string, unknown>;
        } catch {
            // No body is fine for DELETE
        }

        const deleteWorktree = body.deleteWorktree === true;

        try {
            const task =
                (await taskStore.getTask(params.taskId)) ??
                (await taskStore.getArchived(params.taskId));
            if (!task) return errorResponse(`Task not found: ${params.taskId}`, 404);

            // Cascade: delete subtasks
            if (!task.parentId) {
                const [subtasks, archivedSubtasks] = await Promise.all([
                    taskStore.getSubtasks(params.taskId),
                    taskStore.getArchivedSubtasks(params.taskId),
                ]);
                for (const subtask of subtasks) {
                    for (const session of subtask.sessions) ptyManager.close(session.id);
                    await taskStore.deleteTask(subtask.id);
                }
                for (const subtask of archivedSubtasks) {
                    await taskStore.deleteArchived(subtask.id);
                }
            }

            if (task.status === "active") {
                // Fail active flows
                const runs = await flowStore.getFlowRunsForOwner(params.taskId);
                for (const run of runs) {
                    if (run.status === "running" || run.status === "paused") {
                        await flowRunner.failFlowByIds(params.taskId, run.flowId);
                    }
                }
                for (const session of task.sessions) ptyManager.close(session.id);
                await taskStore.deleteTask(params.taskId);
            } else {
                await taskStore.deleteArchived(params.taskId);
            }
            changeTracker?.untrack(params.taskId);

            // Clean up worktree if requested
            if (
                !task.parentId &&
                deleteWorktree &&
                task.worktree.enabled &&
                task.worktree.path &&
                task.worktree.branch
            ) {
                const project = await taskStore.getProject(task.projectId);
                if (project) {
                    try {
                        await gitService.removeWorktree(project.path, task.worktree.path);
                        await gitService.deleteBranch(project.path, task.worktree.branch);
                    } catch (error) {
                        console.error(
                            `Failed to clean up worktree for task ${params.taskId}:`,
                            error,
                        );
                    }
                }
            }

            return jsonResponse({ success: true });
        } catch (err) {
            const message = err instanceof Error ? err.message : "Unknown error";
            return errorResponse(message, 500);
        }
    });

    // ── Flow definitions CRUD ──────────────────────────────────────

    apiRouter.register("GET", "/api/flows", async () => {
        return jsonResponse({ flows: await flowStore.getFlows() });
    });

    apiRouter.register("GET", "/api/flow-actions", async () => {
        return jsonResponse({ actions: await flowStore.getActions() });
    });

    apiRouter.register("POST", "/api/flows", async (req) => {
        let body: FlowDefinition;
        try {
            body = (await req.json()) as FlowDefinition;
        } catch {
            return errorResponse("Invalid JSON body", 400);
        }
        try {
            await flowStore.saveFlow(body);
            return jsonResponse(body, 201);
        } catch (err) {
            const message = err instanceof Error ? err.message : "Unknown error";
            return errorResponse(message, 500);
        }
    });

    apiRouter.register("POST", "/api/flow-actions", async (req) => {
        let body: ActionDefinition;
        try {
            body = (await req.json()) as ActionDefinition;
        } catch {
            return errorResponse("Invalid JSON body", 400);
        }
        try {
            await flowStore.saveAction(body);
            return jsonResponse(body, 201);
        } catch (err) {
            const message = err instanceof Error ? err.message : "Unknown error";
            return errorResponse(message, 500);
        }
    });

    apiRouter.register("DELETE", "/api/flows/:id", async (_req, params) => {
        try {
            await flowStore.deleteFlow(params.id);
            return jsonResponse({ success: true });
        } catch (err) {
            const message = err instanceof Error ? err.message : "Unknown error";
            return errorResponse(message, 500);
        }
    });

    apiRouter.register("DELETE", "/api/flow-actions/:id", async (_req, params) => {
        try {
            const referencingFlows = await flowStore.getFlowsReferencingAction(params.id);
            if (referencingFlows.length > 0) {
                return errorResponse(
                    `Cannot delete action "${params.id}" because it is used by: ${referencingFlows.map((f) => f.name).join(", ")}`,
                    409,
                );
            }
            await flowStore.deleteAction(params.id);
            return jsonResponse({ success: true });
        } catch (err) {
            const message = err instanceof Error ? err.message : "Unknown error";
            return errorResponse(message, 500);
        }
    });

    // ── Run standalone action ───────────────────────────────────────

    apiRouter.register("POST", "/api/flow-actions/:id/run", async (req, params) => {
        let body: Record<string, unknown>;
        try {
            body = (await req.json()) as Record<string, unknown>;
        } catch {
            return errorResponse("Invalid JSON body", 400);
        }

        const { taskId, projectId, prompt, label } = body;
        if (typeof taskId !== "string" && typeof projectId !== "string") {
            return errorResponse("Either taskId or projectId must be a string", 400);
        }
        if (prompt !== undefined && typeof prompt !== "string") {
            return errorResponse('Field "prompt" must be a string', 400);
        }
        if (label !== undefined && typeof label !== "string") {
            return errorResponse('Field "label" must be a string', 400);
        }

        try {
            const actions = await flowStore.getActions();
            const action = actions.find((a) => a.id === params.id);
            if (!action) {
                return errorResponse(`Action not found: ${params.id}`, 404);
            }

            // Resolve projectId when running in task context
            let resolvedProjectId = typeof projectId === "string" ? projectId : undefined;
            if (typeof taskId === "string" && !resolvedProjectId) {
                const task = await taskStore.getTask(taskId);
                if (!task) {
                    return errorResponse(`Task not found: ${taskId}`, 404);
                }
                resolvedProjectId = task.projectId;
            }

            // Validate agent type availability (shell sessions don't need agent checks)
            if (
                action.sessionType !== "shell" &&
                !availableAgentTypes.has(action.sessionType as AgentType)
            ) {
                return errorResponse(
                    `Agent type "${action.sessionType}" required by action is not available`,
                    400,
                );
            }

            const owner =
                typeof taskId === "string" ? { taskId } : { projectId: projectId as string };
            const sessionId = await sessionLifecycle.createSession({
                owner,
                type: action.sessionType,
                prompt: typeof prompt === "string" ? prompt : action.prompt,
                label: typeof label === "string" ? label : action.name,
                agentOptions: action.agentOptions,
            });

            return jsonResponse({ sessionId, actionId: action.id }, 201);
        } catch (err) {
            const message = err instanceof Error ? err.message : "Unknown error";
            return errorResponse(message, 500);
        }
    });

    // ── Flow execution ─────────────────────────────────────────────

    apiRouter.register("POST", "/api/flows/start", async (req) => {
        let body: Record<string, unknown>;
        try {
            body = (await req.json()) as Record<string, unknown>;
        } catch {
            return errorResponse("Invalid JSON body", 400);
        }

        const { taskId, projectId, flowId, inputValues } = body;
        if (typeof flowId !== "string") {
            return errorResponse('Field "flowId" is required', 400);
        }
        if (typeof taskId !== "string" && typeof projectId !== "string") {
            return errorResponse("Either taskId or projectId must be a string", 400);
        }

        try {
            const flows = await flowStore.getFlows();
            const flow = flows.find((f) => f.id === flowId);
            if (!flow) return errorResponse(`Flow not found: ${flowId}`, 404);

            let validatedInputValues: Record<string, string> | undefined;
            if (inputValues !== undefined) {
                if (
                    typeof inputValues !== "object" ||
                    inputValues === null ||
                    Array.isArray(inputValues)
                ) {
                    return errorResponse(
                        "inputValues must be a plain object with string values",
                        400,
                    );
                }
                for (const [key, value] of Object.entries(inputValues as Record<string, unknown>)) {
                    if (typeof value !== "string") {
                        return errorResponse(`inputValues["${key}"] must be a string`, 400);
                    }
                }
                validatedInputValues = inputValues as Record<string, string>;
            }

            const owner =
                typeof taskId === "string" ? { taskId } : { projectId: projectId as string }; // safe: validated above
            const run = await flowRunner.startFlow(owner, flow, validatedInputValues);
            return jsonResponse(run, 201);
        } catch (err) {
            const message = err instanceof Error ? err.message : "Unknown error";
            return errorResponse(message, 500);
        }
    });

    apiRouter.register("POST", "/api/flows/:ownerId/:flowId/stop", async (_req, params) => {
        try {
            await flowRunner.stopFlow(params.ownerId, params.flowId);
            return jsonResponse({ success: true });
        } catch (err) {
            const message = err instanceof Error ? err.message : "Unknown error";
            return errorResponse(message, 500);
        }
    });

    apiRouter.register("POST", "/api/flows/:ownerId/:flowId/pause", async (_req, params) => {
        try {
            await flowRunner.pauseFlow(params.ownerId, params.flowId);
            return jsonResponse({ success: true });
        } catch (err) {
            const message = err instanceof Error ? err.message : "Unknown error";
            return errorResponse(message, 500);
        }
    });

    apiRouter.register("POST", "/api/flows/:ownerId/:flowId/resume", async (_req, params) => {
        try {
            await flowRunner.resumeFlow(params.ownerId, params.flowId);
            return jsonResponse({ success: true });
        } catch (err) {
            const message = err instanceof Error ? err.message : "Unknown error";
            return errorResponse(message, 500);
        }
    });

    apiRouter.register("POST", "/api/flows/:ownerId/:flowId/skip", async (_req, params) => {
        try {
            await flowRunner.skipAction(params.ownerId, params.flowId);
            return jsonResponse({ success: true });
        } catch (err) {
            const message = err instanceof Error ? err.message : "Unknown error";
            return errorResponse(message, 500);
        }
    });

    apiRouter.register("POST", "/api/flows/:ownerId/:flowId/jump", async (req, params) => {
        let body: Record<string, unknown>;
        try {
            body = (await req.json()) as Record<string, unknown>;
        } catch {
            return errorResponse("Invalid JSON body", 400);
        }

        const { actionIndex } = body;
        if (typeof actionIndex !== "number") {
            return errorResponse('Field "actionIndex" is required and must be a number', 400);
        }

        try {
            await flowRunner.jumpToAction(params.ownerId, params.flowId, actionIndex);
            return jsonResponse({ success: true });
        } catch (err) {
            const message = err instanceof Error ? err.message : "Unknown error";
            return errorResponse(message, 500);
        }
    });

    apiRouter.register("GET", "/api/flow-runs/:ownerId/:flowId", async (_req, params) => {
        const run = await flowStore.getFlowRun(params.ownerId, params.flowId);
        if (!run) return errorResponse("Flow run not found", 404);
        return jsonResponse(run);
    });

    apiRouter.register("GET", "/api/flow-runs/:ownerId", async (_req, params) => {
        const runs = await flowStore.getFlowRunsForOwner(params.ownerId);
        return jsonResponse({ runs });
    });

    // ── Schedules ──────────────────────────────────────────────────

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
                typeof body.agentType === "string" ? (body.agentType as AgentType) : undefined,
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
                        typeof body.agentType === "string"
                            ? (body.agentType as AgentType)
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
            return errorResponse(message, 500);
        }
    });

    apiRouter.register("POST", "/api/schedules/:id/trigger", async (_req, params) => {
        try {
            await schedulerService.triggerNow(params.id);
            return jsonResponse({ success: true });
        } catch (err) {
            const message = err instanceof Error ? err.message : "Unknown error";
            return errorResponse(message, 500);
        }
    });

    // ── System info ────────────────────────────────────────────────

    apiRouter.register("GET", "/api/system/info", async () => {
        return jsonResponse({ editors });
    });

    apiRouter.register("GET", "/api/shells", async () => {
        return jsonResponse({ shells, systemShellPath });
    });

    apiRouter.register("GET", "/api/runtimes", async () => {
        return jsonResponse({ runtimes });
    });
}
