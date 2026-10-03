import { beforeEach, describe, expect, it } from "bun:test";
import type { Project, Task } from "@taskflow/shared";
import { useProjectStore } from "@/stores/project-store";
import { useSessionStore } from "@/stores/session-store";
import { useTaskStore } from "@/stores/task-store";
import { getWorkingDir, sessionWorkspace } from "./terminal-links";

const target: Task & { backendId: string } = {
    id: "target",
    projectId: "p1",
    title: "Target",
    description: "",
    notes: "",
    worktree: { enabled: true, path: "/repo/.worktrees/target", branch: "task/target", pr: null },
    sessions: [],
    attributes: [],
    createdAt: "2026-10-03T00:00:00.000Z",
    status: "active",
    archivedAt: null,
    pinned: false,
    backendId: "local",
};

const project: Project & { backendId: string } = {
    id: "p1",
    name: "repo",
    path: "/repo",
    sessions: [],
    attributes: [],
    createdAt: "2026-10-03T00:00:00.000Z",
    backendId: "local",
};

describe("getWorkingDir", () => {
    beforeEach(() => {
        useProjectStore.setState({ projects: [project] });
        useTaskStore.setState({ tasks: [target] });
    });

    it("prefers the session's own cwd, wherever its tab now is", () => {
        useSessionStore.setState({
            tabsByWorkspace: {
                "task:target": [
                    {
                        id: "s1",
                        type: "claude",
                        label: "Claude",
                        sessionId: "s1",
                        cwd: "/repo/.worktrees/source",
                    },
                ],
            },
        });

        // Captured owner ids from the first mount no longer matter.
        expect(getWorkingDir("s1", "some-old-task")).toBe("/repo/.worktrees/source");
        expect(getWorkingDir("s1", undefined, undefined, true)).toBe("/repo/.worktrees/source");
    });

    it("falls back to the owner's directory for a tab without a cwd", () => {
        useSessionStore.setState({
            tabsByWorkspace: {
                "task:target": [{ id: "s1", type: "claude", label: "Claude", sessionId: "s1" }],
            },
        });

        expect(getWorkingDir("s1", "target")).toBe("/repo/.worktrees/target");
    });
});

describe("sessionWorkspace", () => {
    it("follows the session's tab, including into a right pane", () => {
        useSessionStore.setState({
            tabsByWorkspace: {
                "task:target:right": [
                    { id: "s1", type: "claude", label: "Claude", sessionId: "s1" },
                ],
            },
        });

        expect(sessionWorkspace("s1", "some-old-task")).toEqual({
            workspaceKey: "task:target:right",
            owner: { taskId: "target" },
        });
    });

    it("falls back to the workspace the terminal was mounted in", () => {
        useSessionStore.setState({ tabsByWorkspace: {} });

        expect(sessionWorkspace("s1", undefined, "p1")).toEqual({
            workspaceKey: "project:p1",
            owner: { projectId: "p1" },
        });
        expect(sessionWorkspace("s1", undefined, undefined, true)).toEqual({
            workspaceKey: "master",
            owner: { master: true },
        });
    });

    it("reports Master for a session whose tab moved there", () => {
        useSessionStore.setState({
            tabsByWorkspace: {
                master: [{ id: "s1", type: "claude", label: "Claude", sessionId: "s1" }],
            },
        });

        expect(sessionWorkspace("s1", "some-old-task")).toEqual({
            workspaceKey: "master",
            owner: { master: true },
        });
    });
});
