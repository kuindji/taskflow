import type { ApiRouter } from "../router";
import type { TaskStore } from "../../services/task-store";
import type { PtyManager } from "../../services/pty-manager";
import type { GitService } from "../../services/git-service";
import type { ChangeTracker } from "../../services/change-tracker";
import type { Project, WsEvent } from "@taskflow/shared";
import { MSG } from "@taskflow/shared";
import { filterProjectSessions } from "../../services/instance-filter";
import { config } from "../../config";
import { jsonResponse, errorResponse } from "./response-helpers";

interface ProjectRouteDeps {
    apiRouter: ApiRouter;
    taskStore: TaskStore;
    ptyManager: PtyManager;
    broadcast: (event: WsEvent) => void;
    gitService: GitService;
    changeTracker?: ChangeTracker;
}

function registerProjectRoutes(deps: ProjectRouteDeps): void {
    const { apiRouter, taskStore, ptyManager, broadcast, gitService, changeTracker } = deps;

    apiRouter.register("POST", "/api/projects/:projectId/browser", async (req, params) => {
        let body: Record<string, unknown>;
        try {
            body = (await req.json()) as Record<string, unknown>;
        } catch {
            return errorResponse("Invalid JSON body", 400);
        }

        const url = body.url;
        if (typeof url !== "string" || !url.trim()) {
            return errorResponse('Field "url" is required and must be a non-empty string', 400);
        }

        const label = typeof body.label === "string" ? body.label : undefined;

        broadcast({
            type: MSG.BROWSER_OPEN,
            payload: { projectId: params.projectId, url, label },
        });

        return jsonResponse({ success: true });
    });

    apiRouter.register("GET", "/api/projects", async () => {
        const projects = await taskStore.listProjects();
        return jsonResponse({
            projects: projects.map((p) => filterProjectSessions(p, config.instanceId)),
        });
    });

    apiRouter.register("POST", "/api/projects", async (req) => {
        let body: Record<string, unknown>;
        try {
            body = (await req.json()) as Record<string, unknown>;
        } catch {
            return errorResponse("Invalid JSON body", 400);
        }

        const { path, name } = body;
        if (typeof path !== "string" || !path.trim()) {
            return errorResponse('Field "path" is required and must be a non-empty string', 400);
        }

        let resolvedName = typeof name === "string" && name.trim() ? name.trim() : undefined;
        if (!resolvedName) {
            const segments = path.split("/").filter(Boolean).slice(-2).join("/");
            const branch = await gitService.getBranch(path).catch(() => null);
            resolvedName = branch ? `${segments} (${branch})` : segments;
        }

        try {
            const project = await taskStore.addProject({ name: resolvedName, path: path.trim() });
            changeTracker?.track(project.id, project.path);
            return jsonResponse(project, 201);
        } catch (err) {
            const message = err instanceof Error ? err.message : "Unknown error";
            return errorResponse(message, 500);
        }
    });

    apiRouter.register("DELETE", "/api/projects/:id", async (_req, params) => {
        try {
            const project = await taskStore.getProject(params.id);
            if (!project) return errorResponse("Project not found", 404);

            const tasks = await taskStore.listTasks(params.id);
            for (const session of project.sessions) {
                ptyManager.close(session.id);
            }
            for (const task of tasks) {
                for (const session of task.sessions) {
                    ptyManager.close(session.id);
                }
            }
            await taskStore.removeProject(params.id);
            changeTracker?.untrack(params.id);
            return jsonResponse({ success: true });
        } catch (err) {
            const message = err instanceof Error ? err.message : "Unknown error";
            return errorResponse(message, 500);
        }
    });

    apiRouter.register("PATCH", "/api/projects/:id", async (req, params) => {
        let body: Record<string, unknown>;
        try {
            body = (await req.json()) as Record<string, unknown>;
        } catch {
            return errorResponse("Invalid JSON body", 400);
        }

        const updates: Partial<
            Pick<
                Project,
                "name" | "path" | "hidden" | "defaultInitCommand" | "prompt" | "linkedProjects"
            >
        > = {};
        if (typeof body.name === "string") updates.name = body.name;
        if (typeof body.path === "string") updates.path = body.path;
        if (typeof body.hidden === "boolean") updates.hidden = body.hidden;
        if (Object.prototype.hasOwnProperty.call(body, "defaultInitCommand")) {
            updates.defaultInitCommand =
                typeof body.defaultInitCommand === "string" ? body.defaultInitCommand : undefined;
        }
        if (Object.prototype.hasOwnProperty.call(body, "prompt")) {
            updates.prompt = typeof body.prompt === "string" ? body.prompt : undefined;
        }
        if (Object.prototype.hasOwnProperty.call(body, "linkedProjects")) {
            updates.linkedProjects = Array.isArray(body.linkedProjects)
                ? body.linkedProjects
                : undefined;
        }

        if (Object.keys(updates).length === 0) {
            return errorResponse("At least one updatable field must be provided", 400);
        }

        try {
            const updated = await taskStore.updateProject(params.id, updates);
            if (updates.path) {
                changeTracker?.untrack(params.id);
                changeTracker?.track(params.id, updates.path);
            }
            broadcast({
                type: MSG.PROJECT_UPDATED,
                payload: filterProjectSessions(updated, config.instanceId),
            });
            return jsonResponse(filterProjectSessions(updated, config.instanceId));
        } catch (err) {
            const message = err instanceof Error ? err.message : "Unknown error";
            if (message.includes("not found")) return errorResponse(message, 404);
            return errorResponse(message, 500);
        }
    });

    apiRouter.register("POST", "/api/projects/:id/fork", async (req, params) => {
        let body: Record<string, unknown>;
        try {
            body = (await req.json()) as Record<string, unknown>;
        } catch {
            return errorResponse("Invalid JSON body", 400);
        }

        const { branch, folderName } = body;
        if (typeof branch !== "string" || !branch.trim()) {
            return errorResponse('Field "branch" is required and must be a non-empty string', 400);
        }

        try {
            const project = await taskStore.getProject(params.id);
            if (!project) return errorResponse("Project not found", 404);

            const { dirname, join } = await import("path");
            const { stat, rm } = await import("fs/promises");

            const slugify = (b: string) =>
                b
                    .toLowerCase()
                    .replace(/[/ ]/g, "-")
                    .replace(/[^a-z0-9\-.]/g, "");

            const derivedFolder =
                typeof folderName === "string" && folderName.trim()
                    ? folderName.trim()
                    : slugify(branch);
            if (!derivedFolder)
                return errorResponse("Could not derive folder name from branch", 400);

            const targetPath = join(dirname(project.path), derivedFolder);

            const exists = await stat(targetPath).then(
                () => true,
                () => false,
            );
            if (exists) return errorResponse(`Folder already exists: ${targetPath}`, 409);

            const currentBranch = await gitService.getBranch(project.path);
            if (!currentBranch) return errorResponse("Could not determine current branch", 500);

            const remoteUrl = await gitService.getRemoteUrl(project.path);

            try {
                await gitService.clone(project.path, targetPath, currentBranch);
                await gitService.createBranch(targetPath, branch);
                if (remoteUrl) await gitService.setRemoteUrl(targetPath, remoteUrl);
            } catch (err) {
                await rm(targetPath, { recursive: true, force: true }).catch(() => {});
                throw err;
            }

            const segments = targetPath.split("/").filter(Boolean).slice(-2).join("/");
            const newName = `${segments} (${branch})`;

            const newProject = await taskStore.addProject({ name: newName, path: targetPath });
            changeTracker?.track(newProject.id, newProject.path);

            return jsonResponse({ project: newProject, targetPath, branch }, 201);
        } catch (err) {
            const message = err instanceof Error ? err.message : "Unknown error";
            return errorResponse(message, 500);
        }
    });
}

export { registerProjectRoutes };
export type { ProjectRouteDeps };
