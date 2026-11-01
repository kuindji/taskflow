import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Task, TaskLogEntry } from "@taskflow/shared";
import { useSessionStore } from "@/stores/session-store";
import { EditedFilesList } from "./EditedFilesList";

// @ts-expect-error react act env flag, no upstream type for this global
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const task: Task = {
    id: "t1",
    projectId: "p1",
    title: "Task",
    description: "",
    notes: "",
    archivedAt: null,
    pinned: false,
    status: "active",
    sessions: [],
    attributes: [],
    worktree: { enabled: false, path: null, branch: null, pr: null },
    createdAt: "2026-11-01T00:00:00.000Z",
};

const originalSessionState = useSessionStore.getState();
let root: Root | null = null;
afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
    useSessionStore.setState(originalSessionState, true);
});

function entry(message: string): TaskLogEntry {
    return {
        id: message,
        sessionId: "s1",
        type: "file",
        message,
        timestamp: "2026-11-01T00:00:00.000Z",
    };
}

/** Clicks the only listed file and returns the path of the tab it opens. */
async function openedPath(logged: string): Promise<string | undefined> {
    const opened: string[] = [];
    useSessionStore.setState({
        tabsByWorkspace: {},
        addTab: (_key, tab) => {
            if (tab.filePath) opened.push(tab.filePath);
        },
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const mounted = createRoot(container);
    root = mounted;
    await act(async () =>
        mounted.render(
            <EditedFilesList
                files={[entry(logged)]}
                workingDir="/repo/app"
                workspaceKey="edited-files"
                task={task}
            />,
        ),
    );
    await act(async () => {
        container.querySelector<HTMLButtonElement>("button")?.click();
        await new Promise((resolve) => setTimeout(resolve, 0));
    });
    return opened[0];
}

test("a file logged relative to the project opens under the working directory", async () => {
    expect(await openedPath("src/app.ts")).toBe("/repo/app/src/app.ts");
});

test("a file logged with an absolute path outside the project opens at that path", async () => {
    expect(await openedPath("/repo/shared/src/schema.ts")).toBe("/repo/shared/src/schema.ts");
});
