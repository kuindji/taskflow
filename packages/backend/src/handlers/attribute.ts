import { MSG } from "@taskflow/shared";
import type { Project, Task, WsEvent } from "@taskflow/shared";
import type { Router } from "../ws/router";
import type { TaskStore } from "../services/task-store";
import { filterProjectSessions, filterTaskSessions } from "../services/instance-filter";
import { config } from "../config";

interface AttributeHandlerDeps {
    router: Router;
    store: TaskStore;
    broadcast: (event: WsEvent) => void;
}

interface OwnerRef {
    taskId?: string;
    projectId?: string;
}

function resolveOwner(payload: OwnerRef): { taskId: string } | { projectId: string } {
    // The payload type is exclusive, but a WS payload arrives as `unknown` — a
    // both-owner message must be rejected, not silently resolved to one side.
    if (payload.taskId && payload.projectId) {
        throw new Error("Attribute owner must be taskId or projectId, not both");
    }
    if (payload.taskId) return { taskId: payload.taskId };
    if (payload.projectId) return { projectId: payload.projectId };
    throw new Error("Attribute owner requires taskId or projectId");
}

/** Narrow a WS payload (`unknown`) to a plain object so its fields can be validated. */
function toRecord(payload: unknown): Record<string, unknown> {
    if (typeof payload !== "object" || payload === null) {
        return {};
    }
    return payload as Record<string, unknown>;
}

function requireString(value: unknown, field: string): string {
    if (typeof value !== "string") {
        throw new Error(`Field "${field}" is required and must be a string`);
    }
    return value;
}

function optionalString(value: unknown, field: string): string | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== "string") {
        throw new Error(`Field "${field}" must be a string`);
    }
    return value;
}

export function registerAttributeHandlers(deps: AttributeHandlerDeps): void {
    const { router, store, broadcast } = deps;

    function publishTask(task: Task): Task {
        const filtered = filterTaskSessions(task, config.instanceId);
        broadcast({ type: MSG.TASK_UPDATED, payload: filtered });
        return filtered;
    }

    function publishProject(project: Project): Project {
        const filtered = filterProjectSessions(project, config.instanceId);
        broadcast({ type: MSG.PROJECT_UPDATED, payload: filtered });
        return filtered;
    }

    router.register(MSG.ATTR_CREATE, async (payload) => {
        const record = toRecord(payload);
        const name = requireString(record.name, "name");
        const value = optionalString(record.value, "value");
        const owner = resolveOwner(payload as OwnerRef);
        if ("taskId" in owner) {
            return publishTask(await store.createTaskAttribute(owner.taskId, name, value ?? ""));
        }
        return publishProject(
            await store.createProjectAttribute(owner.projectId, name, value ?? ""),
        );
    });

    router.register(MSG.ATTR_UPDATE, async (payload) => {
        const record = toRecord(payload);
        const attrId = requireString(record.attrId, "attrId");
        const name = optionalString(record.name, "name");
        const value = optionalString(record.value, "value");
        const owner = resolveOwner(payload as OwnerRef);
        const updates = { name, value };
        if ("taskId" in owner) {
            return publishTask(await store.updateTaskAttribute(owner.taskId, attrId, updates));
        }
        return publishProject(await store.updateProjectAttribute(owner.projectId, attrId, updates));
    });

    router.register(MSG.ATTR_DELETE, async (payload) => {
        const record = toRecord(payload);
        const attrId = requireString(record.attrId, "attrId");
        const owner = resolveOwner(payload as OwnerRef);
        if ("taskId" in owner) {
            return publishTask(await store.deleteTaskAttribute(owner.taskId, attrId));
        }
        return publishProject(await store.deleteProjectAttribute(owner.projectId, attrId));
    });
}
