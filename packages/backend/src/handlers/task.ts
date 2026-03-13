import { MSG } from "@taskflow/shared";
import type {
    TaskListPayload,
    TaskCreatePayload,
    TaskUpdatePayload,
    TaskArchivePayload,
    TaskUnarchivePayload,
    TaskDeletePayload,
    TaskLogListPayload,
} from "@taskflow/shared";
import type { Router } from "../ws/router";
import type { TaskStore } from "../services/task-store";
import type { GitService } from "../services/git-service";
import type { FlowStore } from "../services/flow-store";
import type { FlowRunner } from "../services/flow-runner";
import type { Task } from "@taskflow/shared";

interface TaskHandlerDeps {
    router: Router;
    store: TaskStore;
    gitService: GitService;
    closeSession?: (sessionId: string) => void;
    generateTitle?: (taskId: string, description: string) => void;
    flowStore?: FlowStore;
    flowRunner?: FlowRunner;
}

export function registerTaskHandlers(deps: TaskHandlerDeps): void {
    const { router, store, gitService, closeSession, generateTitle, flowStore, flowRunner } = deps;

    async function failActiveFlows(taskId: string): Promise<void> {
        if (!flowStore || !flowRunner) return;
        const runs = await flowStore.getFlowRunsForTask(taskId);
        for (const run of runs) {
            if (run.status === "running" || run.status === "paused") {
                await flowRunner.failFlowByIds(taskId, run.flowId);
            }
        }
    }

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
        await failActiveFlows(id);
        await stopTaskSessions(task, true);
        return store.archiveTask(id);
    });

    router.register(MSG.TASK_LIST_ARCHIVED, async () => {
        const tasks = await store.listArchived();
        return { tasks };
    });

    router.register(MSG.TASK_UNARCHIVE, async (payload) => {
        const { id } = payload as TaskUnarchivePayload;
        return store.unarchiveTask(id);
    });

    router.register(MSG.TASK_DELETE, async (payload) => {
        const { id, deleteWorktree } = payload as TaskDeletePayload;
        const task = (await store.getTask(id)) ?? (await store.getArchived(id));
        if (!task) throw new Error(`Task not found: ${id}`);

        if (task.status === "active") {
            await failActiveFlows(id);
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
