import type { TaskStore } from "./task-store";
import type { WsEvent } from "@taskflow/shared";
import { MSG } from "@taskflow/shared";
import { buildShellPath } from "./shell-path";
import { filterTaskSessions } from "./instance-filter";
import { config } from "../config";

interface TitleGeneratorDeps {
    taskStore: TaskStore;
    broadcast: (event: WsEvent) => void;
    createWorktree?: (taskId: string, nameSource: string, initCommand?: string) => Promise<void>;
}

export function createTitleGenerator(deps: TitleGeneratorDeps) {
    const { taskStore, broadcast, createWorktree } = deps;

    async function generate(taskId: string, description: string, initCommand?: string): Promise<void> {
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
                // Title generation failed — still create worktree using description
                await createWorktree?.(taskId, description, initCommand);
                return;
            }

            const title = output.trim().replace(/^["']|["']$/g, "");
            if (!title) {
                await createWorktree?.(taskId, description, initCommand);
                return;
            }

            const updated = await taskStore.updateTask(taskId, { title });
            broadcast({
                type: MSG.TASK_UPDATED,
                payload: filterTaskSessions(updated, config.instanceId),
            });

            await createWorktree?.(taskId, title, initCommand);
        } catch {
            // Title generation failed — still try to create worktree
            await createWorktree?.(taskId, description, initCommand).catch(() => {});
        }
    }

    return { generate };
}
