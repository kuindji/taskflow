import type { TaskStore } from "./task-store";
import type { WsEvent } from "@taskflow/shared";
import { MSG } from "@taskflow/shared";
import type { BuiltinActionRunner } from "./builtin-action-runner";
import { filterTaskSessions } from "./instance-filter";
import { config } from "../config";

interface TitleGeneratorDeps {
    taskStore: TaskStore;
    broadcast: (event: WsEvent) => void;
    builtinActionRunner: BuiltinActionRunner;
    createWorktree?: (taskId: string, nameSource: string, initCommand?: string) => Promise<void>;
}

export function createTitleGenerator(deps: TitleGeneratorDeps) {
    const { taskStore, broadcast, builtinActionRunner, createWorktree } = deps;

    async function generate(
        taskId: string,
        description: string,
        initCommand?: string,
    ): Promise<void> {
        try {
            const task = await taskStore.getTask(taskId);
            const project = task ? await taskStore.getProject(task.projectId) : null;

            let output: string;
            try {
                output = await builtinActionRunner.runHeadless(
                    "builtin:task-title",
                    { description },
                    { project },
                );
            } catch {
                // Title generation failed — still create worktree using description
                await createWorktree?.(taskId, description, initCommand);
                return;
            }

            const title = output.replace(/^["']|["']$/g, "");
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
