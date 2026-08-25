import type { AttrDeletePayload, AttrUpdatePayload, Project, ResolvedAttribute, Task } from "@taskflow/shared";
import type { SessionOwner } from "../sessions/owner";

interface TaskModelSource {
    readonly projects: readonly Project[];
    readonly tasks: readonly Task[];
}

function taskForOwner(owner: SessionOwner, source: TaskModelSource): Task | null {
    if (owner.kind !== "task") return null;
    return source.tasks.find((task) => task.id === owner.taskId) ?? null;
}

function repositoryPathForOwner(owner: SessionOwner, source: TaskModelSource): string | null {
    if (owner.kind === "master") return null;
    if (owner.kind === "project") {
        return source.projects.find((project) => project.id === owner.projectId)?.path ?? null;
    }

    const task = taskForOwner(owner, source);
    if (task?.worktree.enabled && task.worktree.path) return task.worktree.path;
    return source.projects.find((project) => project.id === owner.projectId)?.path ?? null;
}

function resolvedTaskAttributes(task: Task, source: TaskModelSource): ResolvedAttribute[] {
    const project = source.projects.find((candidate) => candidate.id === task.projectId);
    const parent = task.parentId
        ? source.tasks.find((candidate) => candidate.id === task.parentId)
        : undefined;
    const resolved = new Map<string, ResolvedAttribute>();

    for (const attribute of project?.attributes ?? []) {
        resolved.set(attribute.name, { ...attribute, scope: "project" });
    }
    for (const attribute of parent?.attributes ?? []) {
        resolved.set(attribute.name, { ...attribute, scope: "parent" });
    }
    for (const attribute of task.attributes) {
        resolved.set(attribute.name, { ...attribute, scope: "task" });
    }
    return [...resolved.values()];
}

function ownAttributeUpdate(
    task: Task,
    attribute: ResolvedAttribute,
    updates: { name?: string; value?: string },
): AttrUpdatePayload | null {
    if (attribute.scope !== "task") return null;
    if (!task.attributes.some((candidate) => candidate.id === attribute.id)) return null;
    return { taskId: task.id, attrId: attribute.id, ...updates };
}

function ownAttributeDelete(task: Task, attribute: ResolvedAttribute): AttrDeletePayload | null {
    if (attribute.scope !== "task") return null;
    if (!task.attributes.some((candidate) => candidate.id === attribute.id)) return null;
    return { taskId: task.id, attrId: attribute.id };
}

export {
    ownAttributeDelete,
    ownAttributeUpdate,
    repositoryPathForOwner,
    resolvedTaskAttributes,
    taskForOwner,
};
export type { TaskModelSource };
