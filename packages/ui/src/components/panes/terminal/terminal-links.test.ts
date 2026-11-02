import { beforeEach, describe, expect, it } from "bun:test";
import type { Project, Task } from "@taskflow/shared";
import { useBackendStore } from "@/stores/backend-store";
import { useProjectStore } from "@/stores/project-store";
import { useSessionStore } from "@/stores/session-store";
import { useTaskStore } from "@/stores/task-store";
import type { Tab } from "@/stores/session-helpers";
import {
    droppedPaths,
    droppedText,
    droppedUris,
    getWorkingDir,
    sessionWorkspace,
} from "./terminal-links";

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

describe("droppedPaths", () => {
    beforeEach(() => {
        useProjectStore.setState({ projects: [project] });
        useTaskStore.setState({ tasks: [target] });
    });

    it("keeps a path outside a moved session's cwd absolute", () => {
        // Started in task "source", now shown in task "target".
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

        expect(droppedPaths(["/repo/.worktrees/target/src/app.ts"], "s1", "target")).toBe(
            "/repo/.worktrees/target/src/app.ts",
        );
        expect(droppedPaths(["/repo/.worktrees/source/src/app.ts"], "s1", "target")).toBe(
            "src/app.ts",
        );
    });

    it("makes a path relative to the owner's directory for a tab without a cwd", () => {
        useSessionStore.setState({
            tabsByWorkspace: {
                "task:target": [{ id: "s1", type: "claude", label: "Claude", sessionId: "s1" }],
            },
        });

        expect(droppedPaths(["/repo/.worktrees/target/src/app.ts"], "s1", "target")).toBe(
            "src/app.ts",
        );
        expect(droppedPaths(["/elsewhere/a.ts"], "s1", "target")).toBe("/elsewhere/a.ts");
    });
});

const windowsProject: Project & { backendId: string } = {
    id: "pw",
    name: "repo",
    path: "C:\\Repo",
    sessions: [],
    attributes: [],
    createdAt: "2026-10-03T00:00:00.000Z",
    backendId: "win",
};

/** A session in the Windows project, on a Windows machine attached from this UI. */
function windowsSession(tab: Partial<Tab>): void {
    useBackendStore.setState({
        machines: [
            {
                id: "win",
                displayName: "Windows box",
                host: "win.local",
                instanceId: "main",
                state: "attached",
                isLocal: false,
                keepAttached: true,
                os: "win32",
            },
        ],
    });
    useProjectStore.setState({ projects: [windowsProject] });
    useSessionStore.setState({
        tabsByWorkspace: {
            "project:pw": [{ id: "s1", type: "shell", label: "Shell", sessionId: "s1", ...tab }],
        },
    });
}

describe("drops on a Windows session", () => {
    const inRepo = "C:\\Repo\\My Docs\\it's.ts";

    it("quote cmd with double quotes, relative to the cwd without case", () => {
        windowsSession({ shell: "cmd", cwd: "c:\\repo" });

        // The explorer spells Windows paths with forward slashes.
        expect(droppedPaths([inRepo, "C:/Repo/src/a.ts"], "s1", undefined, "pw")).toBe(
            '"My Docs\\it\'s.ts" src\\a.ts',
        );
        expect(droppedPaths(["D:/other dir/a.ts"], "s1", undefined, "pw")).toBe(
            '"D:\\other dir\\a.ts"',
        );
    });

    it("quote PowerShell with single quotes, doubling an apostrophe", () => {
        windowsSession({ shell: "pwsh" });

        expect(droppedPaths([inRepo], "s1", undefined, "pw")).toBe("'My Docs\\it''s.ts'");
        expect(droppedText("it's here", "s1", undefined, "pw")).toBe("'it''s here'");
    });

    it("quote bash on Windows as POSIX", () => {
        windowsSession({ shell: "bash" });

        expect(droppedPaths([inRepo], "s1", undefined, "pw")).toBe("'My Docs\\it'\\''s.ts'");
    });

    it("quote an agent session with double quotes", () => {
        windowsSession({ type: "claude", label: "Claude" });

        expect(droppedPaths([inRepo], "s1", undefined, "pw")).toBe('"My Docs\\it\'s.ts"');
    });

    it("read a drive-letter file URI as a Windows path", () => {
        windowsSession({ shell: "pwsh" });

        expect(
            droppedUris(
                "file:///C:/Repo/My%20Docs/a.ts\r\nfile:///D:/x.ts\r\n",
                "s1",
                undefined,
                "pw",
            ),
        ).toBe("'My Docs\\a.ts' D:\\x.ts");
        expect(droppedUris("https://example.com/", "s1", undefined, "pw")).toBeNull();
    });
});

describe("drops on a POSIX session", () => {
    it("quote POSIX whatever the shell, and read a file URI's path", () => {
        useBackendStore.setState({ machines: [] });
        useProjectStore.setState({ projects: [project] });
        useSessionStore.setState({
            tabsByWorkspace: {
                "project:p1": [
                    { id: "s1", type: "shell", label: "Shell", sessionId: "s1", shell: "pwsh" },
                ],
            },
        });

        expect(droppedUris("file:///repo/My%20Docs/it's.ts", "s1", undefined, "p1")).toBe(
            "'My Docs/it'\\''s.ts'",
        );
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
