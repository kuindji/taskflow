import type { ApiRouter } from "../router";
import type { TaskStore } from "../../services/task-store";
import type { PtyManager } from "../../services/pty-manager";
import type { GitService } from "../../services/git-service";
import type { ChangeTracker } from "../../services/change-tracker";
import type { FlowStore } from "../../services/flow-store";
import type { FlowRunner } from "../../services/flow-runner";
import type { Task, TaskLogEntryType, WsEvent } from "@taskflow/shared";
import { MSG } from "@taskflow/shared";
import { filterTaskSessions } from "../../services/instance-filter";
import { config } from "../../config";
import { jsonResponse, errorResponse } from "./response-helpers";

interface TaskRouteDeps {
    apiRouter: ApiRouter;
    taskStore: TaskStore;
    ptyManager: PtyManager;
    broadcast: (event: WsEvent) => void;
    gitService: GitService;
    changeTracker?: ChangeTracker;
    flowStore: FlowStore;
    flowRunner: FlowRunner;
    generateTitle?: (taskId: string, description: string, initCommand?: string) => void;
    createWorktree?: (taskId: string, nameSource: string, initCommand?: string) => Promise<void>;
}

function registerTaskRoutes(deps: TaskRouteDeps): void {
    const {
        apiRouter,
        taskStore,
        ptyManager,
        broadcast,
        gitService,
        changeTracker,
        flowStore,
        flowRunner,
        generateTitle,
        createWorktree,
    } = deps;

    const allowedLogTypes = new Set<TaskLogEntryType>(["info", "commit", "warning", "error"]);

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

    // ── Task creation (under project) ──────────────────────────────

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

        const worktree =
            body.worktree === true
                ? { enabled: true, path: null, branch: null, pr: null }
                : undefined;

        const requestedInitCommand =
            typeof body.initCommand === "string" && body.initCommand.trim()
                ? body.initCommand.trim()
                : undefined;

        try {
            const resolvedInitCommand = worktree
                ? requestedInitCommand
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
}

export { registerTaskRoutes };
export type { TaskRouteDeps };
