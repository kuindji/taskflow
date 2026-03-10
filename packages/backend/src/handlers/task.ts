import { MSG } from '@taskflow/shared';
import type {
  TaskListPayload,
  TaskCreatePayload,
  TaskUpdatePayload,
  TaskArchivePayload,
  TaskDeletePayload,
} from '@taskflow/shared';
import type { Router } from '../ws/router';
import type { TaskStore } from '../services/task-store';

export function registerTaskHandlers(router: Router, store: TaskStore): void {
  router.register(MSG.TASK_LIST, async (payload) => {
    const { projectId } = (payload ?? {}) as TaskListPayload;
    const tasks = await store.listTasks(projectId);
    return { tasks };
  });

  router.register(MSG.TASK_CREATE, async (payload) => {
    const { projectId, title, description } = payload as TaskCreatePayload;
    return store.createTask({ projectId, title, description });
  });

  router.register(MSG.TASK_UPDATE, async (payload) => {
    const { id, ...updates } = payload as TaskUpdatePayload;
    return store.updateTask(id, updates);
  });

  router.register(MSG.TASK_ARCHIVE, async (payload) => {
    const { id } = payload as TaskArchivePayload;
    return store.archiveTask(id);
  });

  router.register(MSG.TASK_DELETE, async (payload) => {
    const { id } = payload as TaskDeletePayload;
    await store.deleteTask(id);
    return { success: true };
  });
}
