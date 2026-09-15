import { MSG, buildReorderedProjectIds } from "@taskflow/shared";
import type {
    Project,
    ProjectAddPayload,
    ProjectRemovePayload,
    ProjectReorderPayload,
    ProjectUpdatePayload,
} from "@taskflow/shared";
import type { NetLike } from "../net/client";
import type { Store } from "../state/store";

/**
 * Project changes made from this TUI. Over WebSocket the backend broadcasts
 * only a reorder, so every response is applied to the `Store` here.
 */
class ProjectStore {
    constructor(
        private readonly net: NetLike,
        private readonly store: Store,
    ) {}

    async add(path: string, name?: string): Promise<Project> {
        const payload: ProjectAddPayload = name === undefined ? { path } : { path, name };
        const project = await this.net.request<Project>(MSG.PROJECT_ADD, payload);
        this.store.applyProject(project);
        return project;
    }

    hide(id: string): Promise<Project> {
        return this.update({ id, hidden: true });
    }

    async remove(id: string): Promise<void> {
        const payload: ProjectRemovePayload = { id };
        await this.net.request(MSG.PROJECT_REMOVE, payload);
        this.store.removeProject(id);
    }

    /**
     * Applies the new order at once and restores the previous one if the request
     * fails. `orderedIds` may list only the visible projects: hidden ones keep
     * their positions in the order that is sent.
     *
     * The rollback only undoes this call's own change. If the order moved on
     * while the request was in flight (another client's broadcast, or a later
     * reorder from here), that newer order is left in place.
     */
    async reorder(orderedIds: string[]): Promise<void> {
        const previous = this.store.projectOrder;
        const next = buildReorderedProjectIds(previous, orderedIds);
        this.store.setProjectOrder(next);
        const payload: ProjectReorderPayload = { orderedIds: next };
        try {
            await this.net.request(MSG.PROJECT_REORDER, payload);
        } catch (error) {
            if (sameOrder(this.store.projectOrder, next)) this.store.setProjectOrder(previous);
            throw error;
        }
    }

    setLinks(id: string, linkedProjects: Project["linkedProjects"]): Promise<Project> {
        return this.update({ id, linkedProjects });
    }

    private async update(payload: ProjectUpdatePayload): Promise<Project> {
        const project = await this.net.request<Project>(MSG.PROJECT_UPDATE, payload);
        this.store.applyProject(project);
        return project;
    }
}

function sameOrder(left: readonly string[], right: readonly string[]): boolean {
    return left.length === right.length && left.every((id, index) => id === right[index]);
}

export { ProjectStore };
