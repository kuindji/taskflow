import { MSG } from '@taskflow/shared';
import type {
  SessionCreatePayload, SessionClosePayload,
  SessionInputPayload, TerminalResizePayload, WsEvent,
} from '@taskflow/shared';
import type { Router } from '../ws/router';
import type { PtyManager } from '../services/pty-manager';
import type { TaskStore } from '../services/task-store';

interface SessionHandlerDeps {
  router: Router;
  ptyManager: PtyManager;
  taskStore: TaskStore;
  broadcast: (event: WsEvent) => void;
}

export function registerSessionHandlers(deps: SessionHandlerDeps): void {
  const { router, ptyManager, taskStore, broadcast } = deps;

  async function removeSessionFromTask(sessionId: string, taskId?: string): Promise<void> {
    const tasks = taskId
      ? [await taskStore.getTask(taskId)].filter(Boolean)
      : await taskStore.listTasks();

    const owner = tasks.find((task) => task?.sessions.some((session) => session.id === sessionId));
    if (!owner) return;

    await taskStore.updateTask(owner.id, {
      sessions: owner.sessions.filter((session) => session.id !== sessionId),
    });
  }

  router.register(MSG.SESSION_CREATE, async (payload) => {
    const { taskId, type, label } = payload as SessionCreatePayload;
    const task = await taskStore.getTask(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);

    const project = (await taskStore.listProjects()).find((p) => p.id === task.projectId);
    if (!project) throw new Error(`Project not found: ${task.projectId}`);
    const cwd = task.worktree.enabled && task.worktree.path
      ? task.worktree.path : project.path;

    const command = type === 'claude' ? 'claude' : 'codex';

    const sessionId = ptyManager.spawn({
      command, args: [], cwd,
      onData: (data) => {
        broadcast({
          type: MSG.TERMINAL_OUTPUT,
          payload: { sessionId, data },
        });
      },
      onExit: () => {
        void removeSessionFromTask(sessionId, taskId);
      },
    });

    const sessionRef = {
      id: sessionId, type,
      label: label ?? `${type} session`,
      createdAt: new Date().toISOString(),
    };
    await taskStore.updateTask(taskId, {
      sessions: [...task.sessions, sessionRef],
    });

    return { sessionId };
  });

  router.register(MSG.SESSION_INPUT, async (payload) => {
    const { sessionId, data } = payload as SessionInputPayload;
    ptyManager.write(sessionId, data);
    return { success: true };
  });

  router.register(MSG.SESSION_CLOSE, async (payload) => {
    const { sessionId } = payload as SessionClosePayload;
    await removeSessionFromTask(sessionId);
    ptyManager.close(sessionId);
    return { success: true };
  });

  router.register(MSG.TERMINAL_RESIZE, async (payload) => {
    const { sessionId, cols, rows } = payload as TerminalResizePayload;
    ptyManager.resize(sessionId, cols, rows);
    return { success: true };
  });
}
