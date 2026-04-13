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
import type { FlowStore } from "../services/flow-store";
import type { FlowRunner } from "../services/flow-runner";
import type { ChangeTracker } from "../services/change-tracker";
import { filterTaskSessions } from "../services/instance-filter";
import { config } from "../config";

interface TaskHandlerDeps {
    router: Router;
    store: TaskStore;
    gitService: GitService;
    closeSession?: (sessionId: string) => void;
    generateTitle?: (taskId: string, description: string, initCommand?: string) => void;
    createWorktree?: (taskId: string, nameSource: string, initCommand?: string) => void;
    flowStore?: FlowStore;
    flowRunner?: FlowRunner;
    changeTracker?: ChangeTracker;
}

export function registerTaskHandlers(deps: TaskHandlerDeps): void {
    const {
        router,
        store,
        gitService,
        closeSession,
        generateTitle,
        createWorktree,
        flowStore,
        flowRunner,
        changeTracker,
    } = deps;

    async function failActiveFlows(taskId: string): Promise<void> {
        if (!flowStore || !flowRunner) return;
        const runs = await flowStore.getFlowRunsForOwner(taskId);
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
        return { tasks: tasks.map((t) => filterTaskSessions(t, config.instanceId)) };
    });

    router.register(MSG.TASK_CREATE, async (payload) => {
        const { projectId, parentId, title, description, worktree, initCommand } =
            payload as TaskCreatePayload;

        let resolvedProjectId = projectId;
        let resolvedWorktree: TaskWorktree | undefined = worktree
            ? { enabled: true, path: null, branch: null, pr: null }
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
            resolvedWorktree = { ...parent.worktree };
        }

        let resolvedInitCommand: string | undefined;
        if (worktree && !parentId) {
            const requestedInitCommand =
                typeof initCommand === "string" && initCommand.trim()
                    ? initCommand.trim()
                    : undefined;
            if (requestedInitCommand) {
                resolvedInitCommand = requestedInitCommand;
            } else {
                resolvedInitCommand = (await store.getProject(resolvedProjectId))
                    ?.defaultInitCommand;
            }
        }

        const task = await store.createTask({
            projectId: resolvedProjectId,
            parentId,
            title: title ?? "",
            description,
            worktree: resolvedWorktree,
            initCommand: resolvedInitCommand,
        });
        if (task.worktree.enabled && task.worktree.path && !task.parentId) {
            changeTracker?.track(task.id, task.worktree.path);
        }
        if (!title && description && generateTitle) {
            generateTitle(task.id, description, task.initCommand);
        } else if (title && task.worktree.enabled && !task.worktree.path && !task.parentId) {
            // Title was provided so generateTitle won't run — trigger worktree creation directly
            createWorktree?.(task.id, title, task.initCommand);
        }
        return task;
    });

    router.register(MSG.TASK_UPDATE, async (payload) => {
        const { id, ...updates } = payload as TaskUpdatePayload;
        const updated = await store.updateTask(id, updates);
        return filterTaskSessions(updated, config.instanceId);
    });

    router.register(MSG.TASK_ARCHIVE, async (payload) => {
        const { id } = payload as TaskArchivePayload;
        const task = await store.getTask(id);
        if (!task) throw new Error(`Task not found: ${id}`);

        // Cascade: stop sessions and archive subtasks before parent
        if (!task.parentId) {
            const subtasks = await store.getSubtasks(id);
            for (const subtask of subtasks) {
                await stopTaskSessions(subtask, true);
                await store.archiveTask(subtask.id);
            }
        }

        await failActiveFlows(id);
        await stopTaskSessions(task, true);
        const archived = await store.archiveTask(id);
        changeTracker?.untrack(id);
        return filterTaskSessions(archived, config.instanceId);
    });

    router.register(MSG.TASK_LIST_ARCHIVED, async () => {
        const tasks = await store.listArchived();
        return { tasks: tasks.map((t) => filterTaskSessions(t, config.instanceId)) };
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

        if (task.worktree.enabled && task.worktree.path && !task.parentId) {
            changeTracker?.track(task.id, task.worktree.path);
        }

        return filterTaskSessions(task, config.instanceId);
    });

    router.register(MSG.TASK_DELETE, async (payload) => {
        const { id, deleteWorktree } = payload as TaskDeletePayload;
        const task = (await store.getTask(id)) ?? (await store.getArchived(id));
        if (!task) throw new Error(`Task not found: ${id}`);

        // Cascade: delete all subtasks for top-level tasks
        if (!task.parentId) {
            const [subtasks, archivedSubtasks] = await Promise.all([
                store.getSubtasks(id),
                store.getArchivedSubtasks(id),
            ]);
            for (const subtask of subtasks) {
                await stopTaskSessions(subtask, false);
                await store.deleteTask(subtask.id);
            }
            for (const subtask of archivedSubtasks) {
                await store.deleteArchived(subtask.id);
            }
        }

        if (task.status === "active") {
            await failActiveFlows(id);
            await stopTaskSessions(task, false);
            await store.deleteTask(id);
        } else {
            await store.deleteArchived(id);
        }
        changeTracker?.untrack(id);

        // Clean up worktree in the background — don't block the response
        if (
            !task.parentId &&
            deleteWorktree &&
            task.worktree.enabled &&
            task.worktree.path &&
            task.worktree.branch
        ) {
            const worktreePath = task.worktree.path;
            const branch = task.worktree.branch;
            void store.getProject(task.projectId).then((project) => {
                if (!project) return;
                gitService
                    .removeWorktree(project.path, worktreePath)
                    .then(() => gitService.deleteBranch(project.path, branch))
                    .catch((error: unknown) =>
                        console.error(`Failed to clean up worktree for task ${id}:`, error),
                    );
            });
        }

        return { success: true };
    });

    router.register(MSG.TASK_LOG_LIST, async (payload) => {
        const { taskId } = payload as TaskLogListPayload;
        const entries = await store.getTaskLog(taskId);
        return { entries };
    });
}
