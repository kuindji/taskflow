import { expect, test, beforeEach, afterAll, mock } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * Repro tests for fragment (`#heading`) navigation in the markdown preview.
 *
 * happy-dom has no layout, so these do not assert a scroll *offset*; they assert
 * that the preview called `scrollIntoView` on the element whose id the link
 * pointed at. That is the observable the user experiences as "the page jumped
 * to the heading".
 */

const files = new Map<string, string>();

// One hoisted store object, as zustand does: a selector that builds a fresh
// object per call hands out new `readFile`/`writeFile` identities every render,
// which makes the pane's `loadContent` unstable and re-read the file forever.
const fileStore = {
    readFile: (path: string) => Promise.resolve(files.get(path) ?? ""),
    writeFile: (path: string, content: string) => {
        files.set(path, content);
        return Promise.resolve();
    },
};

await mock.module("@/stores/file-store", () => ({
    useFileStore: (selector: (s: typeof fileStore) => unknown) => selector(fileStore),
}));

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

const KEY = "project:p1";
const TAB = "tab-1";

let container: HTMLDivElement;
let root: Root;
const scrolledIds: string[] = [];

/** Mirrors TabContent: re-renders the pane with whatever filePath the tab holds. */
function Harness() {
    const filePath = useSessionStore(
        (s) => s.tabsByWorkspace[KEY]?.find((t) => t.id === TAB)?.filePath ?? "",
    );
    return <MarkdownPaneImpl filePath={filePath} tabId={TAB} workspaceKey={KEY} />;
}

function seedTab(filePath: string) {
    useSessionStore.setState({
        tabsByWorkspace: {
            [KEY]: [
                {
                    id: TAB,
                    type: "markdown",
                    label: filePath.split("/").pop() ?? filePath,
                    filePath,
                    mode: "preview",
                    history: [filePath],
                    historyIndex: 0,
                },
            ],
        },
        activeTabByWorkspace: { [KEY]: TAB },
    });
}

/**
 * Flush the pane's async `readFile` and the re-render it triggers.
 *
 * `await act(async () => {})` never resolves against this component under
 * happy-dom, so the promise chain is drained on a real timer *outside* act and
 * the resulting React work is then committed by a synchronous `act`.
 */
async function settle() {
    for (let i = 0; i < 4; i++) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        act(() => {});
    }
}

beforeEach(() => {
    files.clear();
    scrolledIds.length = 0;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    // happy-dom's scrollIntoView is a no-op; record which element it hit.
    Object.defineProperty(Element.prototype, "scrollIntoView", {
        configurable: true,
        writable: true,
        value: function scrollIntoView(this: Element) {
            scrolledIds.push(this.id);
        },
    });
});

afterAll(() => {
    act(() => root.unmount());
    container.remove();
});

function clickLink(text: string) {
    const anchor = Array.from(container.querySelectorAll("a")).find((a) => a.textContent === text);
    if (!anchor) throw new Error(`No link labelled "${text}" in:\n${container.innerHTML}`);
    act(() => {
        anchor.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
}

// Control: proves the harness (click dispatch, rehype-slug ids, scrollIntoView
// spy) works. If this one fails, the two below prove nothing.
test("a bare #fragment link scrolls to that heading", async () => {
    files.set("/w/doc.md", "[jump](#target)\n\n## Target\n\nbody\n");
    seedTab("/w/doc.md");

    act(() => {
        root.render(<Harness />);
    });
    await settle();

    clickLink("jump");
    await settle();

    expect(scrolledIds).toEqual(["target"]);
});

test("a same-file link with a fragment scrolls to that heading", async () => {
    files.set("/w/doc.md", "[jump](./doc.md#target)\n\n## Target\n\nbody\n");
    seedTab("/w/doc.md");

    act(() => {
        root.render(<Harness />);
    });
    await settle();

    expect(container.querySelector("#target")).not.toBeNull();
    clickLink("jump");
    await settle();

    expect(scrolledIds).toEqual(["target"]);
});

test("a cross-file link with a fragment scrolls to that heading in the new file", async () => {
    files.set("/w/a.md", "[go](./b.md#target)\n");
    files.set("/w/b.md", "# B\n\nfiller\n\n## Target\n\nbody\n");
    seedTab("/w/a.md");

    act(() => {
        root.render(<Harness />);
    });
    await settle();

    clickLink("go");
    await settle();

    // The tab did navigate...
    expect(useSessionStore.getState().tabsByWorkspace[KEY]?.[0]?.filePath).toBe("/w/b.md");
    expect(container.querySelector("#target")).not.toBeNull();
    // ...but did it scroll to the fragment?
    expect(scrolledIds).toEqual(["target"]);
});
