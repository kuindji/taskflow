import { describe, it, expect } from "bun:test";
import { filterTaskSessions, filterProjectSessions } from "../../src/services/instance-filter";
import type { Task } from "@taskflow/shared";
import type { Project } from "@taskflow/shared";

function makeSessionRef(id: string, instance?: string) {
    return {
        id,
        type: "claude" as const,
        label: "Test",
        createdAt: new Date().toISOString(),
        ...(instance !== undefined ? { instance } : {}),
    };
}

describe("filterTaskSessions", () => {
    const baseTask: Task = {
        id: "task-1",
        projectId: "proj-1",
        title: "Test",
        description: "",
        notes: "",
        worktree: { enabled: false, path: null, branch: null, pr: null },
        sessions: [],
        attributes: [],
        createdAt: new Date().toISOString(),
        status: "active",
        archivedAt: null,
        pinned: false,
    };

    it("keeps sessions matching the instanceId", () => {
        const task: Task = {
            ...baseTask,
            sessions: [
                makeSessionRef("s1", "main"),
                makeSessionRef("s2", "dev-feature"),
                makeSessionRef("s3", "main"),
            ],
        };
        const filtered = filterTaskSessions(task, "main");
        expect(filtered.sessions).toHaveLength(2);
        expect(filtered.sessions.map((s) => s.id)).toEqual(["s1", "s3"]);
    });

    it("removes sessions with no instance field (legacy)", () => {
        const task: Task = {
            ...baseTask,
            sessions: [makeSessionRef("s1"), makeSessionRef("s2", "main")],
        };
        const filtered = filterTaskSessions(task, "main");
        expect(filtered.sessions).toHaveLength(1);
        expect(filtered.sessions[0].id).toBe("s2");
    });

    it("returns empty sessions when none match", () => {
        const task: Task = {
            ...baseTask,
            sessions: [makeSessionRef("s1", "dev-feature")],
        };
        const filtered = filterTaskSessions(task, "main");
        expect(filtered.sessions).toEqual([]);
    });

    it("does not mutate the original task", () => {
        const task: Task = {
            ...baseTask,
            sessions: [makeSessionRef("s1", "main"), makeSessionRef("s2", "dev-feature")],
        };
        const filtered = filterTaskSessions(task, "main");
        expect(task.sessions).toHaveLength(2);
        expect(filtered.sessions).toHaveLength(1);
    });
});

describe("filterProjectSessions", () => {
    const baseProject: Project = {
        id: "proj-1",
        name: "Test",
        path: "/tmp/test",
        sessions: [],
        attributes: [],
        createdAt: new Date().toISOString(),
    };

    it("keeps only sessions matching the instanceId", () => {
        const project: Project = {
            ...baseProject,
            sessions: [makeSessionRef("s1", "main"), makeSessionRef("s2", "dev-main")],
        };
        const filtered = filterProjectSessions(project, "main");
        expect(filtered.sessions).toHaveLength(1);
        expect(filtered.sessions[0].id).toBe("s1");
    });

    it("does not mutate the original project", () => {
        const project: Project = {
            ...baseProject,
            sessions: [makeSessionRef("s1", "main"), makeSessionRef("s2", "dev-main")],
        };
        const filtered = filterProjectSessions(project, "main");
        expect(project.sessions).toHaveLength(2);
        expect(filtered.sessions).toHaveLength(1);
    });
});
