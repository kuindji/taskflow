import { MSG } from "@taskflow/shared";
import type {
    SessionCreatePayload,
    SessionClosePayload,
    SessionRenamePayload,
    SessionInputPayload,
    SessionHistoryPayload,
    TerminalResizePayload,
    WsEvent,
} from "@taskflow/shared";
import type { Router } from "../ws/router";
import type { PtyManager } from "../services/pty-manager";
import type { TaskStore } from "../services/task-store";
import { config } from "../config";
import {
    buildAgentLaunchSpec,
    ensureInternalAgentSkillFile,
} from "../services/internal-agent-skill";

interface SessionHandlerDeps {
    router: Router;
    ptyManager: PtyManager;
    taskStore: TaskStore;
    broadcast: (event: WsEvent) => void;
    getPort: () => number;
}

function getDefaultSessionLabel(type: SessionCreatePayload["type"]): string {
    if (type === "claude") return "Claude";
    if (type === "codex") return "Codex";
    return `${type} session`;
}

export function registerSessionHandlers(deps: SessionHandlerDeps): void {
    const { router, ptyManager, taskStore, broadcast, getPort } = deps;

    async function removeSessionFromOwner(
        sessionId: string,
        owner?: { taskId?: string; projectId?: string },
    ): Promise<void> {
        const targetTask = owner?.taskId ? await taskStore.getTask(owner.taskId) : null;
        if (targetTask?.sessions.some((session) => session.id === sessionId)) {
            await taskStore.updateTask(targetTask.id, (task) => ({
                sessions: task.sessions.filter((session) => session.id !== sessionId),
            }));
            return;
        }

        const targetProject = owner?.projectId ? await taskStore.getProject(owner.projectId) : null;
        if (targetProject?.sessions.some((session) => session.id === sessionId)) {
            await taskStore.updateProject(targetProject.id, (project) => ({
                sessions: project.sessions.filter((session) => session.id !== sessionId),
            }));
            return;
        }

        const activeOwner = (owner?.taskId ? [] : await taskStore.listTasks()).find((task) =>
            task.sessions.some((session) => session.id === sessionId),
        );
        if (activeOwner) {
            await taskStore.updateTask(activeOwner.id, (task) => ({
                sessions: task.sessions.filter((session) => session.id !== sessionId),
            }));
            return;
        }

        const activeProjectOwner = (owner?.projectId ? [] : await taskStore.listProjects()).find(
            (project) => project.sessions.some((session) => session.id === sessionId),
        );
        if (activeProjectOwner) {
            await taskStore.updateProject(activeProjectOwner.id, (project) => ({
                sessions: project.sessions.filter((session) => session.id !== sessionId),
            }));
            return;
        }

        const archivedOwner = (await taskStore.listArchived()).find((task) =>
            task.sessions.some((session) => session.id === sessionId),
        );
        if (!archivedOwner) return;

        await taskStore.updateArchived(archivedOwner.id, (task) => ({
            sessions: task.sessions.filter((session) => session.id !== sessionId),
        }));
    }

    router.register(MSG.SESSION_CREATE, async (payload) => {
        const { taskId, projectId, type, label, prompt, shell, cols, rows, agentOptions } =
            payload as SessionCreatePayload;
        if ((taskId ? 1 : 0) + (projectId ? 1 : 0) !== 1) {
            throw new Error("Exactly one of taskId or projectId is required");
        }

        const task = taskId ? await taskStore.getTask(taskId) : null;
        if (taskId && !task) throw new Error(`Task not found: ${taskId}`);

        const project = task
            ? await taskStore.getProject(task.projectId)
            : projectId
              ? await taskStore.getProject(projectId)
              : null;
        if (!project) throw new Error(`Project not found: ${task?.projectId ?? projectId}`);
        const cwd =
            task?.worktree.enabled && task.worktree.path ? task.worktree.path : project.path;

        let command: string;
        const args: string[] = [];
        if (type === "shell") {
            if (!shell) throw new Error("shell path is required for shell sessions");
            command = shell;
        } else {
            const skillPath = await ensureInternalAgentSkillFile(config.agentSkillsDir);
            const spec = buildAgentLaunchSpec(type, prompt, skillPath, agentOptions);
            command = spec.command;
            args.push(...spec.args);
        }

        const sessionId = crypto.randomUUID();
        const taskflowEnv = {
            TASKFLOW_API_URL: `http://localhost:${getPort()}`,
            TASKFLOW_SESSION_ID: sessionId,
            ...(task ? { TASKFLOW_TASK_ID: task.id } : {}),
            ...(project ? { TASKFLOW_PROJECT_ID: project.id } : {}),
        };

        ptyManager.spawn({
            id: sessionId,
            command,
            args,
            cwd,
            env: taskflowEnv,
            cols,
            rows,
            onData: (data, sequence) => {
                void taskStore.appendSessionOutput(
                    task?.id ?? project.id,
                    sessionId,
                    sequence,
                    data,
                );
                broadcast({
                    type: MSG.TERMINAL_OUTPUT,
                    payload: { sessionId, data, sequence },
                });
            },
            onExit: (exitCode) => {
                broadcast({
                    type: MSG.SESSION_EXITED,
                    payload: { sessionId, exitCode },
                });
                void removeSessionFromOwner(sessionId, { taskId: task?.id, projectId: project.id });
            },
        });

        const sessionRef = {
            id: sessionId,
            type,
            label: label ?? getDefaultSessionLabel(type),
            createdAt: new Date().toISOString(),
        };
        if (task) {
            await taskStore.updateTask(task.id, (currentTask) => ({
                sessions: [...currentTask.sessions, sessionRef],
            }));
        } else {
            await taskStore.updateProject(project.id, (currentProject) => ({
                sessions: [...currentProject.sessions, sessionRef],
            }));
        }

        if (type !== "shell") {
            broadcast({
                type: MSG.SESSION_STATUS,
                payload: { sessionId, status: "working" },
            });
        }

        return { sessionId };
    });

    router.register(MSG.SESSION_INPUT, async (payload) => {
        const { sessionId, data } = payload as SessionInputPayload;
        ptyManager.write(sessionId, data);
        return { success: true };
    });

    router.register(MSG.SESSION_CLOSE, async (payload) => {
        const { sessionId } = payload as SessionClosePayload;
        await removeSessionFromOwner(sessionId);
        ptyManager.close(sessionId);
        return { success: true };
    });

    router.register(MSG.SESSION_RENAME, async (payload) => {
        const { sessionId, label } = payload as SessionRenamePayload;

        const updateLabel = (sessions: { id: string; label: string }[]) =>
            sessions.map((s) => (s.id === sessionId ? { ...s, label } : s));

        const tasks = await taskStore.listTasks();
        const ownerTask = tasks.find((t) => t.sessions.some((s) => s.id === sessionId));
        if (ownerTask) {
            await taskStore.updateTask(ownerTask.id, (task) => ({
                sessions: updateLabel(task.sessions),
            }));
            return { success: true };
        }

        const projects = await taskStore.listProjects();
        const ownerProject = projects.find((p) => p.sessions.some((s) => s.id === sessionId));
        if (ownerProject) {
            await taskStore.updateProject(ownerProject.id, (project) => ({
                sessions: updateLabel(project.sessions),
            }));
            return { success: true };
        }

        throw new Error(`Session not found: ${sessionId}`);
    });

    router.register(MSG.TERMINAL_RESIZE, async (payload) => {
        const { sessionId, cols, rows } = payload as TerminalResizePayload;
        ptyManager.resize(sessionId, cols, rows);
        return { success: true };
    });

    router.register(MSG.SESSION_HISTORY, async (payload) => {
        const { taskId, projectId, sessionId } = payload as SessionHistoryPayload;
        const ownerId = taskId ?? projectId;
        if (!ownerId || (taskId && projectId)) {
            throw new Error("Exactly one of taskId or projectId is required");
        }
        return taskStore.getSessionHistory(ownerId, sessionId);
    });
}
