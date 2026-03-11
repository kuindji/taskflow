import { MSG } from "@taskflow/shared";
import type {
    SessionCreatePayload,
    SessionClosePayload,
    SessionInputPayload,
    SessionHistoryPayload,
    TerminalResizePayload,
    WsEvent,
} from "@taskflow/shared";
import type { Router } from "../ws/router";
import type { PtyManager } from "../services/pty-manager";
import type { TaskStore } from "../services/task-store";

interface SessionHandlerDeps {
    router: Router;
    ptyManager: PtyManager;
    taskStore: TaskStore;
    broadcast: (event: WsEvent) => void;
    getPort: () => number;
}

export function registerSessionHandlers(deps: SessionHandlerDeps): void {
    const { router, ptyManager, taskStore, broadcast, getPort } = deps;

    async function removeSessionFromTask(sessionId: string, taskId?: string): Promise<void> {
        const targetTask = taskId ? await taskStore.getTask(taskId) : null;
        if (targetTask?.sessions.some((session) => session.id === sessionId)) {
            await taskStore.updateTask(targetTask.id, (task) => ({
                sessions: task.sessions.filter((session) => session.id !== sessionId),
            }));
            return;
        }

        const activeOwner = (taskId ? [] : await taskStore.listTasks()).find((task) =>
            task.sessions.some((session) => session.id === sessionId),
        );
        if (activeOwner) {
            await taskStore.updateTask(activeOwner.id, (task) => ({
                sessions: task.sessions.filter((session) => session.id !== sessionId),
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
        const { taskId, type, label, prompt, shell } = payload as SessionCreatePayload;
        const task = await taskStore.getTask(taskId);
        if (!task) throw new Error(`Task not found: ${taskId}`);

        const project = (await taskStore.listProjects()).find((p) => p.id === task.projectId);
        if (!project) throw new Error(`Project not found: ${task.projectId}`);
        const cwd = task.worktree.enabled && task.worktree.path ? task.worktree.path : project.path;

        let command: string;
        const args: string[] = [];
        if (type === "shell") {
            if (!shell) throw new Error("shell path is required for shell sessions");
            command = shell;
        } else {
            const bin = type === "claude" ? "claude" : "codex";
            const escaped = prompt ? `${bin} '${prompt.replace(/'/g, "'\\''")}'` : bin;
            const userShell = process.env.SHELL ?? "/bin/zsh";
            command = userShell;
            args.push("-lc", escaped);
        }

        const sessionId = crypto.randomUUID();
        const taskflowEnv = {
            TASKFLOW_API_URL: `http://localhost:${getPort()}`,
            TASKFLOW_TASK_ID: taskId,
            TASKFLOW_SESSION_ID: sessionId,
        };

        ptyManager.spawn({
            id: sessionId,
            command,
            args,
            cwd,
            env: taskflowEnv,
            onData: (data, sequence) => {
                void taskStore.appendSessionOutput(taskId, sessionId, sequence, data);
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
                void removeSessionFromTask(sessionId, taskId);
            },
        });

        const sessionRef = {
            id: sessionId,
            type,
            label: label ?? `${type} session`,
            createdAt: new Date().toISOString(),
        };
        await taskStore.updateTask(taskId, (currentTask) => ({
            sessions: [...currentTask.sessions, sessionRef],
        }));

        return { sessionId };
    });

    router.register(MSG.SESSION_INPUT, async (payload) => {
        const { sessionId, data } = payload as SessionInputPayload;
        ptyManager.write(sessionId, data);
        return { success: true };
    });

    router.register(MSG.SESSION_CLOSE, async (payload) => {
        const { sessionId } = payload as SessionClosePayload;
        await removeSessionFromTask(sessionId);
        ptyManager.close(sessionId);
        return { success: true };
    });

    router.register(MSG.TERMINAL_RESIZE, async (payload) => {
        const { sessionId, cols, rows } = payload as TerminalResizePayload;
        ptyManager.resize(sessionId, cols, rows);
        return { success: true };
    });

    router.register(MSG.SESSION_HISTORY, async (payload) => {
        const { taskId, sessionId } = payload as SessionHistoryPayload;
        return taskStore.getSessionHistory(taskId, sessionId);
    });
}
