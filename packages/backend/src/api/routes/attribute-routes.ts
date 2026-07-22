import type { ApiRouter } from "../router";
import type { TaskStore } from "../../services/task-store";
import type { AttributeLayer, Project, Task, WsEvent } from "@taskflow/shared";
import { MSG, resolveAttributes } from "@taskflow/shared";
import { filterProjectSessions, filterTaskSessions } from "../../services/instance-filter";
import { foreignAttributeError } from "../../services/attribute-guards";
import { config } from "../../config";
import { jsonResponse, errorResponse } from "./response-helpers";
import { NotFoundError } from "../../services/errors";

interface AttributeRouteDeps {
    apiRouter: ApiRouter;
    taskStore: TaskStore;
    broadcast: (event: WsEvent) => void;
}

type OwnerKind = "task" | "project";

function statusForError(err: unknown): number {
    return err instanceof NotFoundError ? 404 : 400;
}

async function readJsonBody(req: Request): Promise<Record<string, unknown> | null> {
    try {
        return (await req.json()) as Record<string, unknown>;
    } catch {
        return null;
    }
}

function registerAttributeRoutes(deps: AttributeRouteDeps): void {
    const { apiRouter, taskStore, broadcast } = deps;

    function publish(kind: OwnerKind, owner: Task | Project): Response {
        if (kind === "task") {
            const filtered = filterTaskSessions(owner as Task, config.instanceId);
            broadcast({ type: MSG.TASK_UPDATED, payload: filtered });
            return jsonResponse(filtered);
        }
        const filtered = filterProjectSessions(owner as Project, config.instanceId);
        broadcast({ type: MSG.PROJECT_UPDATED, payload: filtered });
        return jsonResponse(filtered);
    }

    async function layersFor(kind: OwnerKind, ownerId: string): Promise<AttributeLayer[]> {
        return kind === "task"
            ? taskStore.resolveTaskAttributeLayers(ownerId)
            : taskStore.resolveProjectAttributeLayers(ownerId);
    }

    function register(kind: OwnerKind): void {
        const collection = kind === "task" ? "tasks" : "projects";
        const idParam = kind === "task" ? "taskId" : "projectId";
        const basePath = `/api/${collection}/:${idParam}/attributes`;

        apiRouter.register("GET", basePath, async (req, params) => {
            const ownerId = params[idParam];
            try {
                const layers = await layersFor(kind, ownerId);
                const url = new URL(req.url);
                const ownOnly = url.searchParams.get("own") === "1";
                const selected = ownOnly ? layers.filter((l) => l.scope === kind) : layers;
                return jsonResponse({ attributes: resolveAttributes(selected) });
            } catch (err) {
                const message = err instanceof Error ? err.message : "Unknown error";
                return errorResponse(message, statusForError(err));
            }
        });

        apiRouter.register("GET", `${basePath}/:attrId`, async (_req, params) => {
            const ownerId = params[idParam];
            try {
                const layers = await layersFor(kind, ownerId);
                // Search every layer, not the resolved view: a shadowed attribute
                // is still addressable by its id.
                for (const layer of layers) {
                    const found = layer.attributes.find((a) => a.id === params.attrId);
                    if (found) {
                        return jsonResponse({ attribute: { ...found, scope: layer.scope } });
                    }
                }
                return errorResponse(`Attribute not found: ${params.attrId}`, 404);
            } catch (err) {
                const message = err instanceof Error ? err.message : "Unknown error";
                return errorResponse(message, statusForError(err));
            }
        });

        apiRouter.register("POST", basePath, async (req, params) => {
            const body = await readJsonBody(req);
            if (!body) return errorResponse("Invalid JSON body", 400);

            const name = body.name;
            if (typeof name !== "string") {
                return errorResponse('Field "name" is required and must be a string', 400);
            }
            const value = body.value;
            if (value !== undefined && typeof value !== "string") {
                return errorResponse('Field "value" must be a string', 400);
            }

            const ownerId = params[idParam];
            try {
                const updated =
                    kind === "task"
                        ? await taskStore.createTaskAttribute(ownerId, name, value ?? "")
                        : await taskStore.createProjectAttribute(ownerId, name, value ?? "");
                return publish(kind, updated);
            } catch (err) {
                const message = err instanceof Error ? err.message : "Unknown error";
                return errorResponse(message, statusForError(err));
            }
        });

        apiRouter.register("PATCH", `${basePath}/:attrId`, async (req, params) => {
            const body = await readJsonBody(req);
            if (!body) return errorResponse("Invalid JSON body", 400);

            const updates: { name?: string; value?: string } = {};
            if ("name" in body) {
                if (typeof body.name !== "string") {
                    return errorResponse('Field "name" must be a string', 400);
                }
                updates.name = body.name;
            }
            if ("value" in body) {
                if (typeof body.value !== "string") {
                    return errorResponse('Field "value" must be a string', 400);
                }
                updates.value = body.value;
            }
            if (Object.keys(updates).length === 0) {
                return errorResponse("No valid fields to update", 400);
            }

            const ownerId = params[idParam];
            try {
                const foreign = await foreignAttributeError(
                    taskStore,
                    kind,
                    ownerId,
                    params.attrId,
                );
                if (foreign) return errorResponse(foreign, 400);

                const updated =
                    kind === "task"
                        ? await taskStore.updateTaskAttribute(ownerId, params.attrId, updates)
                        : await taskStore.updateProjectAttribute(ownerId, params.attrId, updates);
                return publish(kind, updated);
            } catch (err) {
                const message = err instanceof Error ? err.message : "Unknown error";
                return errorResponse(message, statusForError(err));
            }
        });

        apiRouter.register("DELETE", `${basePath}/:attrId`, async (_req, params) => {
            const ownerId = params[idParam];
            try {
                const foreign = await foreignAttributeError(
                    taskStore,
                    kind,
                    ownerId,
                    params.attrId,
                );
                if (foreign) return errorResponse(foreign, 400);

                const updated =
                    kind === "task"
                        ? await taskStore.deleteTaskAttribute(ownerId, params.attrId)
                        : await taskStore.deleteProjectAttribute(ownerId, params.attrId);
                return publish(kind, updated);
            } catch (err) {
                const message = err instanceof Error ? err.message : "Unknown error";
                return errorResponse(message, statusForError(err));
            }
        });
    }

    register("task");
    register("project");
}

export { registerAttributeRoutes };
