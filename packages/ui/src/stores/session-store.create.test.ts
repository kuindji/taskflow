import { beforeEach, describe, expect, it } from "bun:test";
import type { SessionRef, Task } from "@taskflow/shared";
import { BackendDetachedError } from "@/lib/connection-registry";
import { useSessionStore } from "./session-store";

const target: Task = {
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
};

const movedIn: SessionRef = {
    id: "moved-in",
    type: "claude",
    label: "Claude",
    createdAt: "2026-10-03T00:00:00.000Z",
    state: "live",
};

beforeEach(() => {
    useSessionStore.setState({ tabsByWorkspace: {}, activeTabByWorkspace: {} });
});

describe("createSession", () => {
    it("lets syncs place the owner's sessions after a targeted create fails", async () => {
        const error = await useSessionStore
            .getState()
            .createSession(
                { taskId: "target", backendId: "detached" },
                "editor",
                "nvim: a.ts",
                undefined,
                undefined,
                undefined,
                { editorId: "nvim", filePath: "/repo/a.ts" },
                undefined,
                "task:target:right",
            )
            .then(
                () => null,
                (reason: unknown) => reason,
            );
        expect(error).toBeInstanceOf(BackendDetachedError);

        useSessionStore.getState().syncWithTasks("local", [{ ...target, sessions: [movedIn] }]);

        expect(
            useSessionStore.getState().tabsByWorkspace["task:target"]?.map((t) => t.sessionId),
        ).toEqual(["moved-in"]);
    });
});
