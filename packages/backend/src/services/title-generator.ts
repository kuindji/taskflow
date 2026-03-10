import type { TaskStore } from './task-store';
import type { WsEvent } from '@taskflow/shared';
import { MSG } from '@taskflow/shared';

interface TitleGeneratorDeps {
  taskStore: TaskStore;
  broadcast: (event: WsEvent) => void;
}

export function createTitleGenerator(deps: TitleGeneratorDeps) {
  const { taskStore, broadcast } = deps;

  async function generate(taskId: string, description: string): Promise<void> {
    const prompt = `Generate a concise task title (3-7 words) for this task description. Output ONLY the title, nothing else. No quotes, no punctuation at the end.\n\nDescription: ${description}`;

    try {
      // Must strip CLAUDECODE and CLAUDE_CODE_ENTRYPOINT from env
      const { CLAUDECODE: _a, CLAUDE_CODE_ENTRYPOINT: _b, ...cleanEnv } = process.env;

      const proc = Bun.spawn(['claude', '-p', prompt], {
        stdout: 'pipe',
        stderr: 'pipe',
        env: cleanEnv,
      });

      const output = await new Response(proc.stdout).text();
      const exitCode = await proc.exited;

      if (exitCode !== 0 || !output.trim()) {
        return;
      }

      const title = output.trim().replace(/^["']|["']$/g, '');
      if (!title) return;

      const updated = await taskStore.updateTask(taskId, { title });
      broadcast({ type: MSG.TASK_UPDATED, payload: updated });
    } catch {
      // Silently fail — the description is shown as fallback
    }
  }

  return { generate };
}
