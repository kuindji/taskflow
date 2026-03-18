import { MSG } from "@taskflow/shared";
import type {
    Project,
    ProjectAddPayload,
    ProjectForkPayload,
    ProjectRemovePayload,
    ProjectUpdatePayload,
} from "@taskflow/shared";
import type { Router } from "../ws/router";
import type { TaskStore } from "../services/task-store";
import type { GitService } from "../services/git-service";
import type { ChangeTracker } from "../services/change-tracker";
import { stat, rm } from "fs/promises";
import { dirname, join } from "path";
import { filterProjectSessions } from "../services/instance-filter";
import { config } from "../config";

function slugify(branch: string): string {
    return branch
        .toLowerCase()
        .replace(/[/ ]/g, "-")
        .replace(/[^a-z0-9\-.]/g, "");
}

export function registerProjectHandlers(
    router: Router,
    store: TaskStore,
    gitService: GitService,
    closeSession?: (sessionId: string) => void,
    changeTracker?: ChangeTracker,
): void {
    router.register(MSG.PROJECT_LIST, async () => {
        const projects = await store.listProjects();
        return { projects: projects.map((p) => filterProjectSessions(p, config.instanceId)) };
    });

    router.register(MSG.PROJECT_ADD, async (payload) => {
        const { name, path } = payload as ProjectAddPayload;
        let resolvedName = name;
        if (!resolvedName) {
            const segments = path.split("/").filter(Boolean).slice(-2).join("/");
            const branch = await gitService.getBranch(path).catch(() => null);
            resolvedName = branch ? `${segments} (${branch})` : segments;
        }
        const project = await store.addProject({ name: resolvedName, path });
        changeTracker?.track(project.id, project.path);
        return project;
    });

    router.register(MSG.PROJECT_REMOVE, async (payload) => {
        const { id } = payload as ProjectRemovePayload;
        const project = await store.getProject(id);
        const tasks = await store.listTasks(id);
        for (const session of project?.sessions ?? []) {
            closeSession?.(session.id);
        }
        for (const task of tasks) {
            for (const session of task.sessions) {
                closeSession?.(session.id);
            }
        }
        await store.removeProject(id);
        changeTracker?.untrack(id);
        return { success: true };
    });

    router.register(MSG.PROJECT_UPDATE, async (payload) => {
        const { id, name, path, hidden } = payload as ProjectUpdatePayload;
        if (!name && !path && hidden === undefined) {
            throw new Error("At least one of name, path, or hidden must be provided");
        }
        const updates: Partial<Pick<Project, "name" | "path" | "hidden">> = {};
        if (name) updates.name = name;
        if (path) updates.path = path;
        if (hidden !== undefined) updates.hidden = hidden;
        const updated = await store.updateProject(id, updates);
        return filterProjectSessions(updated, config.instanceId);
    });

    router.register(MSG.PROJECT_FORK, async (payload) => {
        const { projectId, branch, folderName } = payload as ProjectForkPayload;

        const project = await store.getProject(projectId);
        if (!project) {
            throw new Error("Project not found");
        }

        const derivedFolder = folderName?.trim() || slugify(branch);
        if (!derivedFolder) {
            throw new Error("Could not derive folder name from branch");
        }

        const targetPath = join(dirname(project.path), derivedFolder);

        // Check target doesn't exist
        const exists = await stat(targetPath).then(
            () => true,
            () => false,
        );
        if (exists) {
            throw new Error(`Folder already exists: ${targetPath}`);
        }

        const currentBranch = await gitService.getBranch(project.path);
        if (!currentBranch) {
            throw new Error("Could not determine current branch");
        }

        const remoteUrl = await gitService.getRemoteUrl(project.path);

        // Clone and set up — clean up on failure
        try {
            await gitService.clone(project.path, targetPath, currentBranch);
            await gitService.createBranch(targetPath, branch);
            if (remoteUrl) {
                await gitService.setRemoteUrl(targetPath, remoteUrl);
            }
        } catch (err) {
            // Clean up partial clone
            await rm(targetPath, { recursive: true, force: true }).catch(() => {});
            throw err;
        }

        // Derive name same as PROJECT_ADD handler
        const segments = targetPath.split("/").filter(Boolean).slice(-2).join("/");
        const newName = `${segments} (${branch})`;

        const newProject = await store.addProject({ name: newName, path: targetPath });

        return { project: newProject, targetPath, branch };
    });
}
