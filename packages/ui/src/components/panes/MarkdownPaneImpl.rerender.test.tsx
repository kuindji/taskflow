import { expect, test, beforeEach, afterEach, mock } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { create } from "zustand";

/**
 * Repro for the preview re-parsing its whole document on unrelated re-renders.
 *
 * react-markdown builds a fresh processor and parses on every render. The pane
 * re-renders whenever the task or project lists change (a session starting, a
 * title being generated), and markdown tabs stay mounted while hidden, so one
 * such update re-parsed and re-highlighted every open document.
 */

// The mock wraps the real plugin so each processor construction (= one parse
// of the document) is counted. Capture the function *value*: bun's
// mock.module also rewrites the live bindings of an already-imported
// namespace, so going through `real.rehypeTaskListLine` inside the wrapper
// would call the wrapper itself, forever.
const realTaskListLine = (await import("@/lib/markdown/rehype-task-list-line")).rehypeTaskListLine;
let parses = 0;
await mock.module("@/lib/markdown/rehype-task-list-line", () => ({
    rehypeTaskListLine: function (this: unknown, ...args: unknown[]) {
        parses += 1;
        return (realTaskListLine as (...a: unknown[]) => unknown).apply(this, args);
    },
}));

const files = new Map<string, string>();
const fileStore = {
    readFile: (path: string) => Promise.resolve(files.get(path) ?? ""),
    writeFile: (path: string, content: string) => {
        files.set(path, content);
        return Promise.resolve();
    },
};

await mock.module("@/stores/file-store", () => ({
    useFileStore: (selector: (s: unknown) => unknown) => selector(fileStore),
}));

await mock.module("@/hooks/useWebSocket", () => ({
    onEvent: () => () => {},
    getBackendPort: () => 7100,
    sendRequest: () => Promise.resolve({}),
    sendFireAndForget: () => {},
    onStatusChange: () => () => {},
    connectWebSocket: () => Promise.resolve(),
}));

// Stands in for the task/project stores the real hook subscribes to. Like the
// real hook, it hands back a fresh object once its inputs change.
const useChurn = create<{ tick: number }>(() => ({ tick: 0 }));

await mock.module("@/hooks/useActiveWorkspace", () => ({
    MASTER_WORKSPACE_KEY: "master",
    getTaskWorkspaceKey: (id: string) => `task:${id}`,
    getProjectWorkspaceKey: (id: string) => `project:${id}`,
    useActiveWorkspace: () => {
        useChurn((s) => s.tick);
        return {
            scope: "project" as const,
            task: null,
            project: { id: "p1", path: "/w" },
            workingDir: "/w",
            workspaceKey: "project:p1",
        };
    },
}));

const { useSessionStore } = await import("@/stores/session-store");
const MarkdownPaneImpl = (await import("./MarkdownPaneImpl")).default;

// @ts-expect-error react act env flag, no upstream type for this global
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PATH = "/w/doc.md";

let container: HTMLDivElement;
let root: Root;

async function settle() {
    for (let i = 0; i < 4; i++) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        act(() => {});
    }
}

beforeEach(() => {
    files.clear();
    parses = 0;
    useChurn.setState({ tick: 0 });
    useSessionStore.setState({
        tabsByWorkspace: {
            "project:p1": [
                { id: "t", type: "markdown", label: "doc.md", filePath: PATH, mode: "preview" },
            ],
        },
        activeTabByWorkspace: {},
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
});

test("an unrelated store update does not re-parse the document", async () => {
    files.set(PATH, "# Title\n\n- [ ] a\n");
    act(() => {
        root.render(<MarkdownPaneImpl filePath={PATH} tabId="t" workspaceKey="project:p1" />);
    });
    await settle();
    expect(container.querySelector("h1")?.textContent).toBe("Title");
    const parsesAfterLoad = parses;
    expect(parsesAfterLoad).toBeGreaterThan(0);

    act(() => useChurn.setState({ tick: 1 }));
    await settle();

    expect(parses).toBe(parsesAfterLoad);
});
