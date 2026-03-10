import { MSG } from '@taskflow/shared';
import type { ProjectAddPayload, ProjectRemovePayload } from '@taskflow/shared';
import type { Router } from '../ws/router';
import type { TaskStore } from '../services/task-store';

export function registerProjectHandlers(router: Router, store: TaskStore): void {
  router.register(MSG.PROJECT_LIST, async () => {
    const projects = await store.listProjects();
    return { projects };
  });

  router.register(MSG.PROJECT_ADD, async (payload) => {
    const { name, path } = payload as ProjectAddPayload;
    return store.addProject({ name, path });
  });

  router.register(MSG.PROJECT_REMOVE, async (payload) => {
    const { id } = payload as ProjectRemovePayload;
    await store.removeProject(id);
    return { success: true };
  });
}
