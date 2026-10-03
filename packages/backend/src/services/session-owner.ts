import type { SessionOwnerRef } from "@taskflow/shared";

const OWNER_REQUIRED = "Exactly one of taskId, projectId, or master is required";

function normalizeOwner(owner: SessionOwnerRef): SessionOwnerRef {
    const count = (owner.taskId ? 1 : 0) + (owner.projectId ? 1 : 0) + (owner.master ? 1 : 0);
    if (count !== 1) throw new Error(OWNER_REQUIRED);
    if (owner.master) return { master: true };
    if (owner.taskId) return { taskId: owner.taskId };
    return { projectId: owner.projectId };
}

/** The key session logs are filed under: the task id, the project id, or "master". */
function ownerIdOf(owner: SessionOwnerRef): string {
    if (owner.master) return "master";
    const id = owner.taskId ?? owner.projectId;
    if (!id) throw new Error(OWNER_REQUIRED);
    return id;
}

/** The owner-lock key; unlike the log id it says which kind of owner it is. */
function ownerKey(owner: SessionOwnerRef): string {
    if (owner.master) return "master";
    return owner.taskId ? `task:${owner.taskId}` : `project:${owner.projectId ?? ""}`;
}

function sameOwner(a: SessionOwnerRef, b: SessionOwnerRef): boolean {
    return ownerKey(a) === ownerKey(b);
}

export { normalizeOwner, ownerIdOf, ownerKey, sameOwner };
