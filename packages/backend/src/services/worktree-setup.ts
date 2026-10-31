import { existsSync } from "fs";
import { join, win32 } from "path";
import type { TaskStore } from "./task-store";
import type { GitService } from "./git-service";
import type { TaskWorktree, WsEvent } from "@taskflow/shared";
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

/**
 * The line typed into the init shell: run the command, then exit with its
 * status so the setup can tell success from failure.
 */
function initCommandLine(shellPath: string, command: string): string {
    // win32.basename splits on both separators, so it also handles POSIX paths
    const shell = win32
        .basename(shellPath)
        .replace(/\.exe$/i, "")
        .toLowerCase();
    if (shell === "cmd") return `${command} && exit 0 || exit 1`;
    if (shell === "powershell" || shell === "pwsh") {
        return `${command}; if ($?) { exit 0 } else { exit 1 }`;
    }
    return `${command}; exit $?`;
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
                        ptyManager.write(
                            sessionId,
                            `${initCommandLine(systemShellPath, initCommand)}\r`,
                        );
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
            await logToTask?.(taskId, "warning", `Init command timed out after 5m: ${initCommand}`);
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
        // A subtask works in its parent's worktree; setWorktree hands it over.
        if (!task || task.parentId || !task.worktree.enabled || task.worktree.path) return;

        const project = await taskStore.getProject(task.projectId);
        if (!project) return;

        // A title without ASCII letters or digits slugifies to nothing
        const baseSlug = slugify(nameSource) || `task-${task.id.slice(0, 8)}`;
        // Another task with the same title (or a kept branch or folder) may
        // already hold the name; git would refuse it and the task would run
        // in the main checkout.
        const taken = async (slug: string): Promise<boolean> =>
            existsSync(join(project.path, ".worktrees", slug)) ||
            (await gitService.branchExists(project.path, `task/${slug}`));

        try {
            let slug = baseSlug;
            for (let n = 2; await taken(slug); n += 1) slug = `${baseSlug}-${n}`;
            const branch = `task/${slug}`;
            const worktreePath = join(project.path, ".worktrees", slug);

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
            await setWorktree(taskId, { enabled: true, path: worktreePath, branch, pr: null });
        } catch (error) {
            console.error(`Failed to create worktree for task ${taskId}:`, error);
            await setWorktree(taskId, { enabled: false, path: null, branch: null, pr: null });
        }
    }

    /**
     * Persist the task's finished worktree and broadcast it, together with
     * any subtasks added while it was pending (they copied the pending state).
     */
    async function setWorktree(taskId: string, worktree: TaskWorktree): Promise<void> {
        const updated = await taskStore.updateTask(taskId, { worktree });
        const subtasks = await taskStore.syncSubtaskWorktrees(taskId, worktree);
        for (const task of [updated, ...subtasks]) {
            broadcast({
                type: MSG.TASK_UPDATED,
                payload: filterTaskSessions(task, config.instanceId),
            });
        }
    }

    return { createWorktreeForTask };
}
