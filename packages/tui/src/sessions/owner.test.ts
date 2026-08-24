import { describe, expect, it } from "bun:test";
import type { Project, SessionRef, Task } from "@taskflow/shared";
import {
    MASTER_OWNER,
    ownerKey,
    ownerRequest,
    resolveOwner,
    sessionsForOwner,
    type OwnerStoreView,
} from "./owner";

const session = (id: string): SessionRef => ({
    id,
    type: "shell",
    label: id,
    createdAt: "now",
});
const project = (id: string, sessions: SessionRef[] = []): Project => ({
    id,
    name: id,
    path: `/tmp/${id}`,
    sessions,
    attributes: [],
    createdAt: "now",
});
const task = (id: string, projectId: string, sessions: SessionRef[] = []): Task => ({
    id,
    projectId,
    title: id,
    description: "",
    notes: "",
    worktree: { enabled: false, path: null, branch: null, pr: null },
    sessions,
    attributes: [],
    createdAt: "now",
    status: "active",
    archivedAt: null,
    pinned: false,
});

function store(): OwnerStoreView {
    return {
        masterSessions: [session("m")],
        projects: [project("p", [session("p-s")])],
        tasks: [task("t", "p", [session("t-s")])],
    };
}

describe("session owners", () => {
    it("uses stable keys and exactly one request owner field", () => {
        expect(ownerKey(MASTER_OWNER)).toBe("master");
        expect(ownerKey({ kind: "project", projectId: "p" })).toBe("project:p");
        expect(ownerKey({ kind: "task", taskId: "t", projectId: "p" })).toBe("task:t");
        expect(ownerRequest(MASTER_OWNER)).toEqual({ master: true });
        expect(ownerRequest({ kind: "project", projectId: "p" })).toEqual({ projectId: "p" });
        expect(ownerRequest({ kind: "task", taskId: "t", projectId: "p" })).toEqual({
            taskId: "t",
        });
    });

    it("returns backend-owned session records without copying them", () => {
        const view = store();
        expect(sessionsForOwner(view, MASTER_OWNER)).toBe(view.masterSessions);
        expect(sessionsForOwner(view, { kind: "project", projectId: "p" })).toBe(
            view.projects[0].sessions,
        );
        expect(sessionsForOwner(view, { kind: "task", taskId: "t", projectId: "p" })).toBe(
            view.tasks[0].sessions,
        );
    });

    it("keeps a visible owner and falls back from a missing task to its project", () => {
        const view = store();
        const selected = { kind: "task" as const, taskId: "t", projectId: "p" };
        expect(resolveOwner(view, selected)).toEqual(selected);
        expect(resolveOwner({ ...view, tasks: [] }, selected)).toEqual({
            kind: "project",
            projectId: "p",
        });
    });

    it("falls back to master when the selected project is no longer visible", () => {
        const view = store();
        expect(resolveOwner({ ...view, projects: [] }, { kind: "project", projectId: "p" })).toBe(
            MASTER_OWNER,
        );
        expect(
            resolveOwner({ ...view, projects: [] }, { kind: "task", taskId: "t", projectId: "p" }),
        ).toBe(MASTER_OWNER);
    });
});
