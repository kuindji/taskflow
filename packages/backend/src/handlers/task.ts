import { MSG } from "@taskflow/shared";
import type {
    TaskListPayload,
    TaskCreatePayload,
    TaskUpdatePayload,
    TaskArchivePayload,
    TaskUnarchivePayload,
    TaskDeletePayload,
    TaskLogListPayload,
    Task,
    TaskWorktree,
} from "@taskflow/shared";
import type { Router } from "../ws/router";
import type { TaskStore } from "../services/task-store";
import type { GitService } from "../services/git-service";

interface TaskHandlerDeps {
    router: Router;
    store: TaskStore;
    gitService: GitService;
    closeSession?: (sessionId: string) => void;
    generateTitle?: (taskId: string, description: string) => void;
}

export function registerTaskHandlers(deps: TaskHandlerDeps): void {
    const { router, store, gitService, closeSession, generateTitle } = deps;

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
        const { projectId, parentId, title, description, worktree } = payload as TaskCreatePayload;

        let resolvedProjectId = projectId;
        let resolvedWorktree: TaskWorktree | undefined = worktree
            ? { enabled: true, path: null, branch: null }
            : undefined;

        if (parentId) {
            const parent = await store.getTask(parentId);
            if (!parent) {
                throw new Error(`Parent task not found: ${parentId}`);
            }
            if (parent.parentId) {
                throw new Error("Cannot create a subtask of a subtask");
            }
            // Subtasks inherit parent's projectId and worktree config
            resolvedProjectId = parent.projectId;
            resolvedWorktree = parent.worktree;
        }

        const task = await store.createTask({
            projectId: resolvedProjectId,
            parentId,
            title: title ?? "",
            description,
            worktree: resolvedWorktree,
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

        // Cascade: archive all subtasks first
        if (!task.parentId) {
            const subtasks = await store.getSubtasks(id);
            for (const subtask of subtasks) {
                await stopTaskSessions(subtask, true);
                await store.archiveTask(subtask.id);
            }
        }

        return store.archiveTask(id);
    });

    router.register(MSG.TASK_LIST_ARCHIVED, async () => {
        const tasks = await store.listArchived();
        return { tasks };
    });

    router.register(MSG.TASK_UNARCHIVE, async (payload) => {
        const { id } = payload as TaskUnarchivePayload;
        const task = await store.unarchiveTask(id);

        // Cascade: unarchive all subtasks
        if (!task.parentId) {
            const archivedSubtasks = await store.getArchivedSubtasks(id);
            for (const subtask of archivedSubtasks) {
                await store.unarchiveTask(subtask.id);
            }
        }

        return task;
    });

    router.register(MSG.TASK_DELETE, async (payload) => {
        const { id, deleteWorktree } = payload as TaskDeletePayload;
        const task = (await store.getTask(id)) ?? (await store.getArchived(id));
        if (!task) throw new Error(`Task not found: ${id}`);

        if (task.status === "active") {
            await stopTaskSessions(task, false);
            await store.deleteTask(id);
        } else {
            await store.deleteArchived(id);
        }

        if (deleteWorktree && task.worktree.enabled && task.worktree.path && task.worktree.branch) {
            const project = await store.getProject(task.projectId);
            if (project) {
                try {
                    await gitService.removeWorktree(project.path, task.worktree.path);
                    await gitService.deleteBranch(project.path, task.worktree.branch);
                } catch (error) {
                    console.error(`Failed to clean up worktree for task ${id}:`, error);
                }
            }
        }

        return { success: true };
    });

    router.register(MSG.TASK_LOG_LIST, async (payload) => {
        const { taskId } = payload as TaskLogListPayload;
        const entries = await store.getTaskLog(taskId);
        return { entries };
    });
}
