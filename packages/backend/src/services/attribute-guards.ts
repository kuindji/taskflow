import type { TaskStore } from "./task-store";

type AttributeOwnerKind = "task" | "project";

/**
 * Writes are own-list only. When the id belongs to an inherited layer, say so
 * and name the flag that reaches it, instead of the store's generic
 * "Attribute not found". Shared by the HTTP routes and the WS handlers so
 * both paths report the identical message.
 */
async function foreignAttributeError(
    store: TaskStore,
    kind: AttributeOwnerKind,
    ownerId: string,
    attrId: string,
): Promise<string | null> {
    if (kind === "project") return null;

    const task = await store.getTask(ownerId);
    // A missing task is reported by the mutation itself, as a 404.
    if (!task) return null;
    if (task.attributes.some((a) => a.id === attrId)) return null;

    const project = await store.getProject(task.projectId);
    if (project?.attributes.some((a) => a.id === attrId)) {
        return `attribute ${attrId} belongs to project "${project.name}"; use --project-id ${project.id} to edit it`;
    }

    if (task.parentId) {
        const parent = await store.getTask(task.parentId);
        if (parent?.attributes.some((a) => a.id === attrId)) {
            return `attribute ${attrId} belongs to parent task "${parent.title}"; use --task-id ${parent.id} to edit it`;
        }
    }

    return null;
}

export { foreignAttributeError };
export type { AttributeOwnerKind };
