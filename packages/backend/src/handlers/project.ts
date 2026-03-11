import { MSG } from "@taskflow/shared";
import type {
    ProjectAddPayload,
    ProjectRemovePayload,
    ProjectUpdatePayload,
} from "@taskflow/shared";
import type { Router } from "../ws/router";
import type { TaskStore } from "../services/task-store";
import type { GitService } from "../services/git-service";

export function registerProjectHandlers(
    router: Router,
    store: TaskStore,
    gitService: GitService,
): void {
    router.register(MSG.PROJECT_LIST, async () => {
        const projects = await store.listProjects();
        return { projects };
    });

    router.register(MSG.PROJECT_ADD, async (payload) => {
        const { name, path } = payload as ProjectAddPayload;
        let resolvedName = name;
        if (!resolvedName) {
            const segments = path.split("/").filter(Boolean).slice(-2).join("/");
            const branch = await gitService.getBranch(path).catch(() => null);
            resolvedName = branch ? `${segments} (${branch})` : segments;
        }
        return store.addProject({ name: resolvedName, path });
    });

    router.register(MSG.PROJECT_REMOVE, async (payload) => {
        const { id } = payload as ProjectRemovePayload;
        await store.removeProject(id);
        return { success: true };
    });

    router.register(MSG.PROJECT_UPDATE, async (payload) => {
        const { id, name } = payload as ProjectUpdatePayload;
        return store.updateProject(id, { name });
    });
}
