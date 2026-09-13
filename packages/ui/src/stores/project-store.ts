import { create } from "zustand";
import type {
    LinkedProject,
    Project,
    ProjectForkResponse,
    ProjectListResponse,
} from "@taskflow/shared";
import { MSG, orderProjectsByIds } from "@taskflow/shared";
import { createSlices, type Scoped } from "@/lib/backend-scope";
import { onEvent, sendRequest } from "@/lib/connection-registry";
import { registerBackendReset } from "./store-reset";
import { useTaskStore } from "./task-store";
import { useUIStore } from "./ui-store";

interface ProjectUpdate {
    name?: string;
    path?: string;
    hidden?: boolean;
    defaultInitCommand?: string;
    prompt?: string;
    linkedProjects?: LinkedProject[];
}

/**
 * Mutations take the whole record rather than its id: the record's own
 * `backendId` is the only target a mutation may go to.
 */
interface ProjectStore {
    projects: Scoped<Project>[];
    loading: boolean;
    showArchivedProjects: boolean;
    /** Rejects when the request fails, so a bootstrap can tell the machine is unusable. */
    fetchProjects(backendId: string): Promise<void>;
    addProject(backendId: string, path: string): Promise<Scoped<Project>>;
    updateProject(project: Scoped<Project>, updates: ProjectUpdate): Promise<Scoped<Project>>;
    setShowArchivedProjects(show: boolean): void;
    archiveProject(project: Scoped<Project>): Promise<void>;
    unarchiveProject(project: Scoped<Project>): Promise<void>;
    removeProject(project: Scoped<Project>): Promise<void>;
    forkProject(
        project: Scoped<Project>,
        branch: string,
        folderName?: string,
    ): Promise<ProjectForkResponse>;
    /** Ordering is per machine, so the machine is named explicitly. */
    reorderProjects(backendId: string, orderedIds: string[]): Promise<void>;
}

const slices = createSlices<Project>();

function publish(): void {
    useProjectStore.setState({ projects: slices.read() });
}

function upsert(backendId: string, project: Project): Scoped<Project> {
    const scoped = { ...project, backendId };
    slices.apply(backendId, (items) =>
        items.some((p) => p.id === project.id)
            ? items.map((p) => (p.id === project.id ? scoped : p))
            : [...items, scoped],
    );
    publish();
    return scoped;
}

function replaceExisting(backendId: string, project: Project): Scoped<Project> {
    const scoped = { ...project, backendId };
    slices.apply(backendId, (items) => items.map((p) => (p.id === project.id ? scoped : p)));
    publish();
    return scoped;
}

function clearActiveProject(id: string): void {
    if (useUIStore.getState().activeProjectId === id) {
        useUIStore.getState().setActiveProject(null);
    }
}

export const useProjectStore = create<ProjectStore>((set) => ({
    projects: [],
    loading: false,
    showArchivedProjects: false,
    async fetchProjects(backendId) {
        set({ loading: true });
        try {
            const before = useProjectStore
                .getState()
                .projects.filter((p) => p.backendId === backendId);
            const landed = await slices.load(backendId, async () => {
                const { projects } = await sendRequest<ProjectListResponse>(
                    backendId,
                    MSG.PROJECT_LIST,
                );
                return projects;
            });
            if (!landed) return;
            publish();
            // Only a project this machine held can have vanished from it; an
            // active project on another machine is not this response's to clear.
            const activeProjectId = useUIStore.getState().activeProjectId;
            if (
                activeProjectId &&
                before.some((p) => p.id === activeProjectId) &&
                !slices.read().some((p) => p.backendId === backendId && p.id === activeProjectId)
            ) {
                useUIStore.getState().setActiveProject(null);
            }
        } finally {
            set({ loading: false });
        }
    },
    async addProject(backendId, path) {
        const project = await sendRequest<Project>(backendId, MSG.PROJECT_ADD, { path });
        // PROJECT_CREATED may have landed first.
        return upsert(backendId, project);
    },
    async updateProject(project, updates) {
        const updated = await sendRequest<Project>(project.backendId, MSG.PROJECT_UPDATE, {
            id: project.id,
            ...updates,
        });
        return replaceExisting(project.backendId, updated);
    },
    setShowArchivedProjects(show) {
        set({ showArchivedProjects: show });
    },
    async archiveProject(project) {
        const updated = await sendRequest<Project>(project.backendId, MSG.PROJECT_UPDATE, {
            id: project.id,
            hidden: true,
        });
        replaceExisting(project.backendId, updated);
        if (!useProjectStore.getState().showArchivedProjects) clearActiveProject(project.id);
    },
    async unarchiveProject(project) {
        const updated = await sendRequest<Project>(project.backendId, MSG.PROJECT_UPDATE, {
            id: project.id,
            hidden: false,
        });
        replaceExisting(project.backendId, updated);
    },
    async removeProject(project) {
        await sendRequest(project.backendId, MSG.PROJECT_REMOVE, { id: project.id });
        slices.apply(project.backendId, (items) => items.filter((p) => p.id !== project.id));
        publish();
        clearActiveProject(project.id);
        useUIStore.getState().setProjectCollapsed(project.id, false);
        await useTaskStore.getState().fetchTasks(project.backendId);
    },
    async forkProject(project, branch, folderName) {
        const response = await sendRequest<ProjectForkResponse>(
            project.backendId,
            MSG.PROJECT_FORK,
            { projectId: project.id, branch, folderName },
        );
        upsert(project.backendId, response.project);
        return response;
    },
    async reorderProjects(backendId, orderedIds) {
        // Optimistic local reorder, then confirm with the server.
        slices.apply(backendId, (items) => orderProjectsByIds(items, orderedIds));
        publish();
        const landed = await slices.load(backendId, async () => {
            const { projects } = await sendRequest<ProjectListResponse>(
                backendId,
                MSG.PROJECT_REORDER,
                { orderedIds },
            );
            return projects;
        });
        if (landed) publish();
    },
}));

registerBackendReset("project-store", (backendId) => {
    const dropped = new Set(
        slices
            .read()
            .filter((p) => p.backendId === backendId)
            .map((p) => p.id),
    );
    slices.drop(backendId);
    publish();
    // Here rather than in a reset of its own: resets run in registration order,
    // and a later one could no longer tell which project ids were this machine's.
    useUIStore.getState().forgetRecords({ projectIds: dropped, taskIds: new Set() });
});

function isProject(payload: unknown): payload is Project {
    return !!payload && typeof payload === "object" && "id" in payload;
}

// Listen for new projects broadcast by the backend (e.g., added via CLI).
const _unsubProjectCreated = onEvent(MSG.PROJECT_CREATED, (payload, backendId) => {
    if (!isProject(payload)) return;
    if (slices.read().some((p) => p.backendId === backendId && p.id === payload.id)) return;
    upsert(backendId, payload);
});

// Listen for project removals broadcast by the backend (e.g., removed via CLI).
const _unsubProjectRemoved = onEvent(MSG.PROJECT_REMOVED, (payload, backendId) => {
    if (!isProject(payload)) return;
    slices.apply(backendId, (items) => items.filter((p) => p.id !== payload.id));
    publish();
    clearActiveProject(payload.id);
});

// Listen for project updates broadcast by the backend (e.g., new session added by a flow step).
const _unsubProjectUpdated = onEvent(MSG.PROJECT_UPDATED, (payload, backendId) => {
    if (!isProject(payload)) return;
    replaceExisting(backendId, payload);
});

// Listen for project reorder broadcast from another window.
const _unsubProjectReordered = onEvent(MSG.PROJECT_REORDERED, (payload, backendId) => {
    if (!payload || typeof payload !== "object" || !("orderedIds" in payload)) return;
    const { orderedIds } = payload as { orderedIds: string[] };
    slices.apply(backendId, (items) => orderProjectsByIds(items, orderedIds));
    publish();
});

if (import.meta.hot) {
    import.meta.hot.dispose(() => {
        _unsubProjectCreated();
        _unsubProjectRemoved();
        _unsubProjectUpdated();
        _unsubProjectReordered();
    });
}
