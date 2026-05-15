import { join } from "path";
import type { TaskStore } from "./task-store";
import type { GitService } from "./git-service";
import type { WsEvent } from "@taskflow/shared";
import type { ChangeTracker } from "./change-tracker";
import type { PtyManager } from "./pty-manager";
import type { CreateSessionOpts } from "./session-lifecycle";
import { MSG } from "@taskflow/shared";
import { slugify } from "../utils/slugify";
import { filterTaskSessions } from "./instance-filter";
import { config } from "../config";

interface WorktreeSetupDeps {
    taskStore: TaskStore;
    gitService: GitService;
    broadcast: (event: WsEvent) => void;
    changeTracker?: ChangeTracker;
    createSession?: (opts: CreateSessionOpts) => Promise<string>;
    ptyManager?: PtyManager;
    systemShellPath?: string | null;
    logToTask?: (taskId: string, type: "info" | "warning", message: string) => Promise<void>;
}

export function createWorktreeSetup(deps: WorktreeSetupDeps) {
    const {
        taskStore,
        gitService,
        broadcast,
        changeTracker,
        createSession,
        ptyManager,
        systemShellPath,
        logToTask,
    } = deps;

    async function runInitCommand(
        taskId: string,
        worktreePath: string,
        initCommand: string,
    ): Promise<void> {
        if (!createSession || !ptyManager || !systemShellPath) return;

        const exitPromise = new Promise<number>((resolve) => {
            let resolved = false;
            void createSession({
                owner: { taskId },
                type: "shell",
                shell: systemShellPath,
                cwd: worktreePath,
                label: "Init",
                onSessionExited: (_sessionId, exitCode) => {
                    if (!resolved) {
                        resolved = true;
                        resolve(exitCode);
                    }
                },
            }).then((sessionId) => {
                // Small delay to let the PTY initialize before writing
                setTimeout(() => {
                    try {
                        ptyManager.write(sessionId, `${initCommand}; exit $?\r`);
                    } catch {
                        // Session may have already exited
                        if (!resolved) {
                            resolved = true;
                            resolve(1);
                        }
                    }
                }, 100);
            });
        });

        const TIMEOUT_MS = 5 * 60_000;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeoutPromise = new Promise<"timeout">((resolve) => {
            timer = setTimeout(() => resolve("timeout"), TIMEOUT_MS);
        });

        const result = await Promise.race([exitPromise, timeoutPromise]);
        clearTimeout(timer);

        if (result === "timeout") {
            await logToTask?.(
                taskId,
                "warning",
                `Init command timed out after 5m: ${initCommand}`,
            );
        } else if (result !== 0) {
            await logToTask?.(
                taskId,
                "warning",
                `Init command exited with code ${result}: ${initCommand}`,
            );
        } else {
            await logToTask?.(taskId, "info", `Init command completed: ${initCommand}`);
        }
    }

    async function createWorktreeForTask(
        taskId: string,
        nameSource: string,
        initCommand?: string,
    ): Promise<void> {
        const task = await taskStore.getTask(taskId);
        if (!task || !task.worktree.enabled || task.worktree.path) return;

        const project = await taskStore.getProject(task.projectId);
        if (!project) return;

        const slug = slugify(nameSource);
        if (!slug) return;

        const branch = `task/${slug}`;
        const worktreePath = join(project.path, ".worktrees", slug);

        try {
            await gitService.createWorktree(project.path, branch, worktreePath);
            changeTracker?.track(taskId, worktreePath);

            // IMPORTANT: Do NOT persist worktree.path yet. If we do,
            // createSession (for the init shell) will broadcast TASK_UPDATED
            // with the path set, causing the UI to start the agent prematurely.
            // Instead, run the init command first using explicit `cwd`, then
            // persist the path and broadcast in one step.
            const cmd =
                typeof initCommand === "string" && initCommand.trim()
                    ? initCommand.trim()
                    : task.initCommand;
            if (cmd) {
                await runInitCommand(taskId, worktreePath, cmd);
            }

            // Now persist the worktree path and broadcast — this unblocks
            // the UI's pending agent start.
            const updated = await taskStore.updateTask(taskId, {
                worktree: { enabled: true, path: worktreePath, branch, pr: null },
            });
            broadcast({
                type: MSG.TASK_UPDATED,
                payload: filterTaskSessions(updated, config.instanceId),
            });
        } catch (error) {
            console.error(`Failed to create worktree for task ${taskId}:`, error);
            const updated = await taskStore.updateTask(taskId, {
                worktree: { enabled: false, path: null, branch: null, pr: null },
            });
            broadcast({
                type: MSG.TASK_UPDATED,
                payload: filterTaskSessions(updated, config.instanceId),
            });
        }
    }

    return { createWorktreeForTask };
}
