import { MSG } from "@taskflow/shared";
import type {
    TaskListPayload,
    TaskCreatePayload,
    TaskUpdatePayload,
    TaskArchivePayload,
    TaskDeletePayload,
} from "@taskflow/shared";
import type { Router } from "../ws/router";
import type { TaskStore } from "../services/task-store";
import type { Task } from "@taskflow/shared";

interface TaskHandlerDeps {
    router: Router;
    store: TaskStore;
    closeSession?: (sessionId: string) => void;
    generateTitle?: (taskId: string, description: string) => void;
}

export function registerTaskHandlers(deps: TaskHandlerDeps): void {
    const { router, store, closeSession, generateTitle } = deps;

    async function stopTaskSessions(task: Task, clearPersistedSessions: boolean): Promise<void> {
        if (task.sessions.length === 0) {
            return;
        }

        if (clearPersistedSessions) {
            await store.updateTask(task.id, { sessions: [] });
        }

        for (const session of task.sessions) {
            closeSession?.(session.id);
        }
    }

    router.register(MSG.TASK_LIST, async (payload) => {
        const { projectId } = (payload ?? {}) as TaskListPayload;
        const tasks = await store.listTasks(projectId);
        return { tasks };
    });

    router.register(MSG.TASK_CREATE, async (payload) => {
        const { projectId, title, description, worktree } = payload as TaskCreatePayload;
        const task = await store.createTask({
            projectId,
            title: title ?? "",
            description,
            worktree: worktree ? { enabled: true, path: null, branch: null } : undefined,
        });
        if (!title && description && generateTitle) {
            generateTitle(task.id, description);
        }
        return task;
    });

    router.register(MSG.TASK_UPDATE, async (payload) => {
        const { id, ...updates } = payload as TaskUpdatePayload;
        return store.updateTask(id, updates);
    });

    router.register(MSG.TASK_ARCHIVE, async (payload) => {
        const { id } = payload as TaskArchivePayload;
        const task = await store.getTask(id);
        if (!task) throw new Error(`Task not found: ${id}`);
        await stopTaskSessions(task, true);
        return store.archiveTask(id);
    });

    router.register(MSG.TASK_DELETE, async (payload) => {
        const { id } = payload as TaskDeletePayload;
        const task = await store.getTask(id);
        if (!task) throw new Error(`Task not found: ${id}`);
        await stopTaskSessions(task, false);
        await store.deleteTask(id);
        return { success: true };
    });
}
