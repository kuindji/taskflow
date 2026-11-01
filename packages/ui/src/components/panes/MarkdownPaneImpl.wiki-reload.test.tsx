import { expect, test, beforeEach, afterEach, mock } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { WikiIndexData, WikiPage } from "@taskflow/shared";

/**
 * A wiki page preview must follow edits made on disk while the Wiki panel is
 * open. Opening the panel closes the file explorer, which held the only
 * FILE_WATCH, so no FILE_CHANGED arrives; the wiki index push is all there is.
 */

const files = new Map<string, string>();
let reads = 0;
const fileStore = {
    readFile: (_backendId: string, path: string) => {
        reads += 1;
        return Promise.resolve(files.get(path) ?? "");
    },
    writeFile: (_backendId: string, path: string, content: string) => {
        files.set(path, content);
        return Promise.resolve();
    },
};

await mock.module("@/stores/file-store", () => ({
    useFileStore: (selector: (s: unknown) => unknown) => selector(fileStore),
}));

await mock.module("@/hooks/useActiveWorkspace", () => ({
    MASTER_WORKSPACE_KEY: "master",
    getTaskWorkspaceKey: (id: string) => `task:${id}`,
    getProjectWorkspaceKey: (id: string) => `project:${id}`,
    workspaceBackendId: () => "local",
    workspaceOwner: () => ({}),
    useActiveWorkspace: () => ({
        scope: "project" as const,
        task: null,
        project: { id: "p1", path: "/w", backendId: "local" },
        workingDir: "/w",
        workspaceKey: "project:p1",
    }),
}));

const WIKI = "/w/wiki";
await mock.module("@/hooks/useWikiRoot", () => ({ useWikiRoot: () => WIKI }));

const { useSessionStore } = await import("@/stores/session-store");
const { useWikiStore } = await import("@/stores/wiki-store");
const MarkdownPaneImpl = (await import("./MarkdownPaneImpl")).default;

// @ts-expect-error react act env flag, no upstream type for this global
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PATH = `${WIKI}/page.md`;

function page(id: string, mtimeMs: number): WikiPage {
    return {
        id,
        path: `${id}.md`,
        title: id,
        parents: [],
        children: [],
        relatedPages: [],
        headings: [],
        links: [],
        brokenLinks: [],
        mtimeMs,
    };
}

function pushIndex(pages: WikiPage[]) {
    const data: WikiIndexData = {
        root: WIKI,
        rootExists: true,
        pages,
        tree: [],
        backlinks: {},
        unresolved: [],
        orphans: [],
    };
    act(() => useWikiStore.setState({ indexByBackend: { local: { [WIKI]: data } } }));
}

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
    reads = 0;
    useWikiStore.setState({
        indexByBackend: {},
        errorByBackend: {},
        fetchIndex: () => Promise.resolve(),
    });
    useSessionStore.setState({
        tabsByWorkspace: {
            "project:p1": [
                { id: "t", type: "markdown", label: "page.md", filePath: PATH, mode: "preview" },
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

test("a wiki page reloads when the index reports a newer mtime for it", async () => {
    files.set(PATH, "# Before\n");
    pushIndex([page("page", 1), page("other", 1)]);
    act(() => {
        root.render(<MarkdownPaneImpl filePath={PATH} tabId="t" workspaceKey="project:p1" />);
    });
    await settle();
    expect(container.querySelector("h1")?.textContent).toBe("Before");

    files.set(PATH, "# After\n");
    pushIndex([page("page", 2), page("other", 1)]);
    await settle();

    expect(container.querySelector("h1")?.textContent).toBe("After");
});

test("another page's edit does not re-read this one", async () => {
    files.set(PATH, "# Page\n");
    pushIndex([page("page", 1), page("other", 1)]);
    act(() => {
        root.render(<MarkdownPaneImpl filePath={PATH} tabId="t" workspaceKey="project:p1" />);
    });
    await settle();
    const readsAfterLoad = reads;

    pushIndex([page("page", 1), page("other", 2)]);
    await settle();

    expect(reads).toBe(readsAfterLoad);
});
