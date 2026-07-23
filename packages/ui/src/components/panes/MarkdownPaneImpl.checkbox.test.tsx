import { expect, test, beforeEach, afterEach, mock } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * Repro for the task-list checkbox write being a read-modify-write over the
 * pane's own React state rather than over the file on disk.
 *
 * Two markdown panes showing the same file (a split, or the same doc opened in
 * two workspaces) each hold their own `content` snapshot. A pane only refreshes
 * when the backend's FILE_CHANGED watcher event arrives, which is asynchronous.
 * A click landing in the second pane inside that window writes its stale
 * snapshot over the first pane's change.
 */

const files = new Map<string, string>();
const writes: string[] = [];

// Reads of `heldPath` park until `releaseReads()` — the only way to hold a
// pane inside the read half of a checkbox write long enough to do something
// else to it (navigate the tab, click again).
let heldPath: string | null = null;
const heldReads: Array<() => void> = [];

function releaseReads() {
    const pending = heldReads.splice(0, heldReads.length);
    for (const resolve of pending) resolve();
}

// One frozen store object, as zustand hands out: fresh function identities on
// every render would make `loadContent` unstable and re-read the file on each
// re-render, which is not how the pane behaves in the app.
const fileStore = {
    readFile: (path: string) => {
        if (path !== heldPath) return Promise.resolve(files.get(path) ?? "");
        return new Promise<string>((resolve) => {
            heldReads.push(() => resolve(files.get(path) ?? ""));
        });
    },
    writeFile: (path: string, content: string) => {
        files.set(path, content);
        writes.push(content);
        return Promise.resolve();
    },
};

await mock.module("@/stores/file-store", () => ({
    useFileStore: (selector: (s: unknown) => unknown) => selector(fileStore),
}));

// onEvent is a no-op: this models the window *before* the file watcher's
// FILE_CHANGED event reaches the other pane, not a broken subscription.
await mock.module("@/hooks/useWebSocket", () => ({
    onEvent: () => () => {},
    getBackendPort: () => 7100,
    sendRequest: () => Promise.resolve({}),
    sendFireAndForget: () => {},
    onStatusChange: () => () => {},
    connectWebSocket: () => Promise.resolve(),
}));

await mock.module("@/hooks/useActiveWorkspace", () => ({
    MASTER_WORKSPACE_KEY: "master",
    getTaskWorkspaceKey: (id: string) => `task:${id}`,
    getProjectWorkspaceKey: (id: string) => `project:${id}`,
    useActiveWorkspace: () => ({
        scope: "project" as const,
        task: null,
        project: { id: "p1", path: "/w" },
        workingDir: "/w",
        workspaceKey: "project:p1",
    }),
}));

const { useSessionStore } = await import("@/stores/session-store");
const MarkdownPaneImpl = (await import("./MarkdownPaneImpl")).default;

// @ts-expect-error react act env flag, no upstream type for this global
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PATH = "/w/todo.md";

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
    writes.length = 0;
    heldPath = null;
    heldReads.length = 0;
    useSessionStore.setState({
        tabsByWorkspace: {
            "project:p1": [
                { id: "left", type: "markdown", label: "todo.md", filePath: PATH, mode: "preview" },
                {
                    id: "right",
                    type: "markdown",
                    label: "todo.md",
                    filePath: PATH,
                    mode: "preview",
                },
            ],
        },
        activeTabByWorkspace: {},
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
});

// Per test, not once at the end: a pane left mounted keeps its async work —
// and its writes — alive into the next test.
afterEach(() => {
    act(() => root.unmount());
    container.remove();
});

function checkboxesIn(paneIndex: number): HTMLInputElement[] {
    const panes = container.children;
    const pane = panes[paneIndex];
    return Array.from(pane.querySelectorAll('input[type="checkbox"]'));
}

test("a checkbox click in one pane does not discard another pane's earlier click", async () => {
    files.set(PATH, "- [ ] a\n- [ ] b\n");

    act(() => {
        root.render(
            <>
                <MarkdownPaneImpl filePath={PATH} tabId="left" workspaceKey="project:p1" />
                <MarkdownPaneImpl filePath={PATH} tabId="right" workspaceKey="project:p1" />
            </>,
        );
    });
    await settle();

    // Both panes have loaded the same two unchecked items.
    expect(checkboxesIn(0)).toHaveLength(2);
    expect(checkboxesIn(1)).toHaveLength(2);

    // Left pane checks "a".
    act(() => {
        checkboxesIn(0)[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();
    expect(files.get(PATH)).toBe("- [x] a\n- [ ] b\n");

    // Right pane checks "b" before the watcher event reaches it.
    act(() => {
        checkboxesIn(1)[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();

    // Both boxes should now be checked.
    expect(files.get(PATH)).toBe("- [x] a\n- [x] b\n");
});

test("simultaneous clicks in two panes both land", async () => {
    files.set(PATH, "- [ ] a\n- [ ] b\n");

    act(() => {
        root.render(
            <>
                <MarkdownPaneImpl filePath={PATH} tabId="left" workspaceKey="project:p1" />
                <MarkdownPaneImpl filePath={PATH} tabId="right" workspaceKey="project:p1" />
            </>,
        );
    });
    await settle();

    // Neither pane's write has finished when the other pane is clicked, so
    // both would otherwise read the same pre-click bytes.
    act(() => {
        checkboxesIn(0)[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
        checkboxesIn(1)[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();

    expect(files.get(PATH)).toBe("- [x] a\n- [x] b\n");
});

test("a click still in flight when the tab navigates does not resurrect the old page", async () => {
    const OTHER = "/w/other.md";
    files.set(PATH, "- [ ] a\n- [ ] b\n");
    files.set(OTHER, "# elsewhere\n");

    act(() => {
        root.render(<MarkdownPaneImpl filePath={PATH} tabId="left" workspaceKey="project:p1" />);
    });
    await settle();

    // Two clicks, so one write is still queued behind the other, then hold the
    // pane inside the read half of the first one.
    heldPath = PATH;
    act(() => {
        checkboxesIn(0)[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
        checkboxesIn(0)[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();

    // The tab navigates while that write is parked.
    act(() => {
        root.render(<MarkdownPaneImpl filePath={OTHER} tabId="left" workspaceKey="project:p1" />);
    });
    await settle();
    expect(container.textContent).toContain("elsewhere");

    // The queued write now runs with the pane already showing another file.
    heldPath = null;
    releaseReads();
    await settle();

    // The clicks belonged to todo.md and are still applied there...
    expect(files.get(PATH)).toBe("- [x] a\n- [x] b\n");
    // ...but it must not push todo.md's text back into a pane showing other.md.
    expect(container.textContent).toContain("elsewhere");
    expect(checkboxesIn(0)).toHaveLength(0);
});

test("a click whose item changed on disk is dropped, and the pane refreshes", async () => {
    files.set(PATH, "- [ ] a\n- [ ] b\n");

    act(() => {
        root.render(<MarkdownPaneImpl filePath={PATH} tabId="left" workspaceKey="project:p1" />);
    });
    await settle();
    expect(checkboxesIn(0)).toHaveLength(2);

    // Someone else rewrote the very item about to be clicked.
    files.set(PATH, "- [ ] a renamed\n- [ ] b\n");

    act(() => {
        checkboxesIn(0)[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();

    // The click is discarded rather than applied to bytes it never described.
    expect(files.get(PATH)).toBe("- [ ] a renamed\n- [ ] b\n");
    expect(writes).toHaveLength(0);
    // ...and the pane now shows what is actually on disk.
    expect(container.textContent).toContain("a renamed");
});

test("two fast clicks in one pane both land", async () => {
    files.set(PATH, "- [ ] a\n- [ ] b\n");

    act(() => {
        root.render(<MarkdownPaneImpl filePath={PATH} tabId="left" workspaceKey="project:p1" />);
    });
    await settle();

    act(() => {
        checkboxesIn(0)[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
        checkboxesIn(0)[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();

    expect(files.get(PATH)).toBe("- [x] a\n- [x] b\n");
});
