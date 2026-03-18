import { join } from "path";
import type { TaskStore } from "./task-store";
import type { GitService } from "./git-service";
import type { WsEvent } from "@taskflow/shared";
import { MSG } from "@taskflow/shared";
import { buildShellPath } from "./shell-path";
import { slugify } from "../utils/slugify";
import { filterTaskSessions } from "./instance-filter";
import { config } from "../config";

interface TitleGeneratorDeps {
    taskStore: TaskStore;
    gitService: GitService;
    broadcast: (event: WsEvent) => void;
}

export function createTitleGenerator(deps: TitleGeneratorDeps) {
    const { taskStore, gitService, broadcast } = deps;

    async function createWorktreeForTask(taskId: string, title: string): Promise<void> {
        const task = await taskStore.getTask(taskId);
        if (!task || !task.worktree.enabled || task.worktree.path) return;

        const project = await taskStore.getProject(task.projectId);
        if (!project) return;

        const slug = slugify(title);
        if (!slug) return;

        const branch = `task/${slug}`;
        const worktreePath = join(project.path, ".worktrees", slug);

        try {
            await gitService.createWorktree(project.path, branch, worktreePath);
            const updated = await taskStore.updateTask(taskId, {
                worktree: { enabled: true, path: worktreePath, branch, pr: null },
            });
            broadcast({ type: MSG.TASK_UPDATED, payload: filterTaskSessions(updated, config.instanceId) });
        } catch (error) {
            console.error(`Failed to create worktree for task ${taskId}:`, error);
        }
    }

    async function generate(taskId: string, description: string): Promise<void> {
        const prompt = `Generate a concise task title (3-7 words) for this task description. Output ONLY the title, nothing else. No quotes, no punctuation at the end.\n\nDescription: ${description}`;

        try {
            // Must strip CLAUDECODE and CLAUDE_CODE_ENTRYPOINT from env
            const { CLAUDECODE: _a, CLAUDE_CODE_ENTRYPOINT: _b, ...cleanEnv } = process.env;

            const proc = Bun.spawn(["claude", "-p", "--model", "haiku"], {
                stdin: "pipe",
                stdout: "pipe",
                stderr: "pipe",
                env: { ...cleanEnv, PATH: buildShellPath() },
            });
            void proc.stdin.write(prompt);
            void proc.stdin.end();

            const output = await new Response(proc.stdout).text();
            const exitCode = await proc.exited;

            if (exitCode !== 0 || !output.trim()) {
                return;
            }

            const title = output.trim().replace(/^["']|["']$/g, "");
            if (!title) return;

            const updated = await taskStore.updateTask(taskId, { title });
            broadcast({ type: MSG.TASK_UPDATED, payload: filterTaskSessions(updated, config.instanceId) });

            await createWorktreeForTask(taskId, title);
        } catch {
            // Silently fail — the description is shown as fallback
        }
    }

    return { generate };
}
