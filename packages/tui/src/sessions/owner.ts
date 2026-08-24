import type { Project, SessionRef, Task } from "@taskflow/shared";

type SessionOwner =
    | { kind: "master" }
    | { kind: "project"; projectId: string }
    | { kind: "task"; taskId: string; projectId: string };

interface OwnerStoreView {
    readonly masterSessions: readonly SessionRef[];
    readonly projects: readonly Project[];
    readonly tasks: readonly Task[];
}

const MASTER_OWNER: SessionOwner = { kind: "master" };

function ownerKey(owner: SessionOwner): string {
    switch (owner.kind) {
        case "master":
            return "master";
        case "project":
            return `project:${owner.projectId}`;
        case "task":
            return `task:${owner.taskId}`;
    }
}

function ownerRequest(
    owner: SessionOwner,
): { master: true } | { projectId: string } | { taskId: string } {
    switch (owner.kind) {
        case "master":
            return { master: true };
        case "project":
            return { projectId: owner.projectId };
        case "task":
            return { taskId: owner.taskId };
    }
}

function sessionsForOwner(store: OwnerStoreView, owner: SessionOwner): readonly SessionRef[] {
    switch (owner.kind) {
        case "master":
            return store.masterSessions;
        case "project":
            return store.projects.find((project) => project.id === owner.projectId)?.sessions ?? [];
        case "task":
            return store.tasks.find((task) => task.id === owner.taskId)?.sessions ?? [];
    }
}

function resolveOwner(store: OwnerStoreView, previous: SessionOwner): SessionOwner {
    const visibleProjects = new Set(store.projects.map((project) => project.id));
    if (previous.kind === "master") return MASTER_OWNER;
    if (previous.kind === "project") {
        return visibleProjects.has(previous.projectId) ? previous : MASTER_OWNER;
    }

    const task = store.tasks.find(
        (candidate) =>
            candidate.id === previous.taskId &&
            candidate.status === "active" &&
            visibleProjects.has(candidate.projectId),
    );
    if (task) return { kind: "task", taskId: task.id, projectId: task.projectId };
    if (visibleProjects.has(previous.projectId)) {
        return { kind: "project", projectId: previous.projectId };
    }
    return MASTER_OWNER;
}

export { MASTER_OWNER, ownerKey, ownerRequest, resolveOwner, sessionsForOwner };
export type { OwnerStoreView, SessionOwner };
