import { expect, test, afterAll, beforeAll, mock } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MSG } from "@taskflow/shared";

/**
 * A markdown preview follows its file on disk with the file explorer closed:
 * the pane holds the workspace root's watch itself, so FILE_CHANGED arrives.
 */

const WORKING_DIR = "/w";
const PATH = `${WORKING_DIR}/notes.md`;
let fileContent = "# Before\n";

await mock.module("@/hooks/useActiveWorkspace", () => ({
    MASTER_WORKSPACE_KEY: "master",
    getTaskWorkspaceKey: (id: string) => `task:${id}`,
    getProjectWorkspaceKey: (id: string) => `project:${id}`,
    workspaceBackendId: () => "desktop",
    workspaceOwner: () => ({}),
    useActiveWorkspace: () => ({
        scope: "project" as const,
        task: null,
        project: { id: "p1", path: WORKING_DIR, backendId: "desktop" },
        workingDir: WORKING_DIR,
        workspaceKey: "project:p1",
    }),
}));

const { startTestServer } = await import("@/lib/test-ws-server");
const { openConnection, closeConnection } = await import("@/lib/connection-registry");
const { resetBackend } = await import("@/stores/store-reset");
const { useSessionStore } = await import("@/stores/session-store");
const MarkdownPaneImpl = (await import("./MarkdownPaneImpl")).default;

// @ts-expect-error react act env flag, no upstream type for this global
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const desktop = startTestServer("desktop", (type) =>
    type === MSG.FILE_READ ? { content: fileContent, hash: fileContent } : {},
);

beforeAll(async () => {
    await openConnection("desktop", desktop.origin);
});

afterAll(() => {
    closeConnection("desktop", "detach");
    resetBackend("desktop");
    desktop.stop();
});

async function settle() {
    for (let i = 0; i < 4; i++) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        act(() => {});
    }
}

function watchRequests(type: string): unknown[] {
    return desktop.received.filter((m) => m.type === type).map((m) => m.payload);
}

test("a preview reloads on FILE_CHANGED with the explorer closed, and releases its watch", async () => {
    useSessionStore.setState({
        tabsByWorkspace: {
            "project:p1": [
                { id: "t", type: "markdown", label: "notes.md", filePath: PATH, mode: "preview" },
            ],
        },
        activeTabByWorkspace: {},
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
        root.render(<MarkdownPaneImpl filePath={PATH} tabId="t" workspaceKey="project:p1" />);
    });
    await settle();
    expect(container.querySelector("h1")?.textContent).toBe("Before");
    expect(watchRequests(MSG.FILE_WATCH)).toEqual([{ path: WORKING_DIR }]);

    fileContent = "# After\n";
    desktop.broadcast(MSG.FILE_CHANGED, { type: "modify", path: PATH });
    await settle();
    expect(container.querySelector("h1")?.textContent).toBe("After");

    act(() => root.unmount());
    container.remove();
    await settle();
    expect(watchRequests(MSG.FILE_UNWATCH)).toEqual([{ path: WORKING_DIR }]);
});
