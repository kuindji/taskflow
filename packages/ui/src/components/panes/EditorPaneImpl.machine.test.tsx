import { expect, test, beforeEach, afterEach, mock } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { create } from "zustand";
import { createMonacoFake } from "./test-monaco-fake";

/**
 * The pane's model identity includes its machine, so while the workspace names
 * no machine (primary closed under the master workspace) there is no model to
 * show. The pane must say it is loading, and a read started for the old machine
 * must not land in the editor it already disposed.
 */

const monaco = createMonacoFake();
await mock.module("monaco-editor", () => monaco.module);
const { typeInEditor, pressSave } = monaco;

/** Reads not yet answered; `resolveRead` answers them all. */
const pendingReads: ((content: string) => void)[] = [];
const resolveRead = (content: string) => {
    for (const resolve of pendingReads.splice(0)) resolve(content);
};
/** Watches held by the panes, as "backend path"; a release removes one. */
const heldWatches: string[] = [];
const fileStore = {
    retainWatch: (backendId: string, path: string) => {
        const key = `${backendId} ${path}`;
        heldWatches.push(key);
        let released = false;
        return () => {
            if (released) return;
            released = true;
            heldWatches.splice(heldWatches.indexOf(key), 1);
        };
    },
    readFile: () =>
        new Promise<{ content: string; hash: string }>((resolve) => {
            pendingReads.push((content) => resolve({ content, hash: content }));
        }),
    writeFile: (_backendId: string, _path: string, content: string) => {
        writes.push(content);
        return writeHold.then(() => ({ success: true as const, hash: content }));
    },
};
/** What each save sent; a save's answer waits for `writeHold`. */
const writes: string[] = [];
let writeHold: Promise<void> = Promise.resolve();
await mock.module("@/stores/file-store", () => ({
    useFileStore: (selector?: (s: typeof fileStore) => unknown) =>
        selector ? selector(fileStore) : fileStore,
}));

await mock.module("@/hooks/useActiveWorkspace", () => ({
    MASTER_WORKSPACE_KEY: "master",
    getTaskWorkspaceKey: (id: string) => `task:${id}`,
    getProjectWorkspaceKey: (id: string) => `project:${id}`,
    workspaceBackendId: () => "desktop",
    workspaceOwner: () => ({}),
    useActiveWorkspace: () => ({
        scope: "project" as const,
        task: null,
        project: { id: "p1", path: "/repo", backendId: "desktop" },
        workingDir: "/repo",
        workspaceKey: "project:p1",
    }),
}));

const useBackend = create<{ id: string | null }>(() => ({ id: "desktop" }));
await mock.module("@/hooks/useWorkspaceBackend", () => ({
    useWorkspaceBackend: () => useBackend((s) => s.id),
}));

await mock.module("@/lib/monaco-import-navigation", () => ({
    syncCompilerOptions: () => Promise.resolve(),
    registerImportNavigation: () => {},
}));

const { default: EditorPaneImpl } = await import("./EditorPaneImpl");
const { isEditorDirty, clearEditorDirty } = await import("./editor-dirty-state");

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    monaco.reset();
    pendingReads.length = 0;
    writes.length = 0;
    heldWatches.length = 0;
    writeHold = Promise.resolve();
    clearEditorDirty("desktop", "/repo/a.ts");
    useBackend.setState({ id: "desktop" });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
});

const showsLoading = () => container.textContent?.includes("Loading...") ?? false;

test("an editor whose workspace loses its machine shows loading again", async () => {
    await act(async () => {
        root.render(<EditorPaneImpl filePath="/repo/a.ts" />);
    });
    await act(async () => {
        resolveRead("content");
    });
    expect(showsLoading()).toBe(false);

    await act(async () => {
        useBackend.setState({ id: null });
    });
    expect(showsLoading()).toBe(true);
});

test("a read that lands after the machine is gone does not touch the disposed editor", async () => {
    await act(async () => {
        root.render(<EditorPaneImpl filePath="/repo/a.ts" />);
    });
    await act(async () => {
        useBackend.setState({ id: null });
    });
    await act(async () => {
        resolveRead("content");
    });
    expect(monaco.state.setValueCalls).toBe(0);
    expect(showsLoading()).toBe(true);
});

test("typing while a save is answered keeps the buffer unsaved", async () => {
    await act(async () => {
        root.render(<EditorPaneImpl filePath="/repo/a.ts" />);
    });
    await act(async () => {
        resolveRead("v1");
    });
    let answerWrite = () => {};
    writeHold = new Promise<void>((resolve) => {
        answerWrite = resolve;
    });
    await act(async () => {
        typeInEditor("v2");
        pressSave();
    });
    await act(async () => {
        typeInEditor("v3");
        answerWrite();
    });

    expect(writes).toEqual(["v2"]);
    expect(isEditorDirty("desktop", "/repo/a.ts")).toBe(true);
});

test("a save with no typing during it marks the buffer saved", async () => {
    await act(async () => {
        root.render(<EditorPaneImpl filePath="/repo/a.ts" />);
    });
    await act(async () => {
        resolveRead("v1");
    });
    await act(async () => {
        typeInEditor("v2");
        pressSave();
    });

    expect(writes).toEqual(["v2"]);
    expect(isEditorDirty("desktop", "/repo/a.ts")).toBe(false);
});

test("closing one of two panes on the same file keeps the other's buffer", async () => {
    await act(async () => {
        root.render(
            <>
                <EditorPaneImpl key="left" filePath="/repo/a.ts" />
                <EditorPaneImpl key="right" filePath="/repo/a.ts" />
            </>,
        );
    });
    await act(async () => {
        resolveRead("v1");
    });
    const [left, right] = monaco.editors();
    expect(left.getModel()).toBe(right.getModel());
    // The second pane's load replaced the text on the shared model: not an edit.
    expect(isEditorDirty("desktop", "/repo/a.ts")).toBe(false);

    await act(async () => {
        root.render(
            <>
                <EditorPaneImpl key="left" filePath="/repo/b.ts" />
                <EditorPaneImpl key="right" filePath="/repo/a.ts" />
            </>,
        );
    });

    expect(right.getModel().isDisposed()).toBe(false);
    expect(right.getValue()).toBe("v1");
});

test("a second pane's read answered after typing in the first keeps the typed text", async () => {
    await act(async () => {
        root.render(<EditorPaneImpl key="left" filePath="/repo/a.ts" />);
    });
    await act(async () => {
        resolveRead("v1");
    });
    await act(async () => {
        root.render(
            <>
                <EditorPaneImpl key="left" filePath="/repo/a.ts" />
                <EditorPaneImpl key="right" filePath="/repo/a.ts" />
            </>,
        );
    });
    // Typed in the left pane on the shared model while the right one's read is out.
    await act(async () => {
        monaco.editors()[0].getModel().change("unsaved edit", false);
    });
    await act(async () => {
        resolveRead("v1");
    });

    const [left, right] = monaco.editors();
    expect(left.getValue()).toBe("unsaved edit");
    expect(isEditorDirty("desktop", "/repo/a.ts")).toBe(true);
    // Both panes offer to save it.
    expect(right.getModel()).toBe(left.getModel());
    expect(container.textContent?.match(/Save/g)?.length).toBe(2);
});

test("an editor holds its workspace root's watch while mounted, following its machine and path", async () => {
    await act(async () => {
        root.render(<EditorPaneImpl filePath="/repo/a.ts" />);
    });
    expect(heldWatches).toEqual(["desktop /repo"]);

    // Same root: the watch is kept, not released and taken again.
    await act(async () => {
        root.render(<EditorPaneImpl filePath="/repo/src/b.ts" />);
    });
    expect(heldWatches).toEqual(["desktop /repo"]);

    await act(async () => {
        useBackend.setState({ id: "laptop" });
    });
    expect(heldWatches).toEqual(["laptop /repo"]);

    // A file outside the workspace has no root of it to watch.
    await act(async () => {
        root.render(<EditorPaneImpl filePath="/elsewhere/c.ts" />);
    });
    expect(heldWatches).toEqual([]);

    await act(async () => {
        root.render(<EditorPaneImpl filePath="/repo/a.ts" />);
    });
    expect(heldWatches).toEqual(["laptop /repo"]);
    act(() => root.unmount());
    expect(heldWatches).toEqual([]);
    root = createRoot(container);
});

test("split panes on one file each hold the watch", async () => {
    await act(async () => {
        root.render(
            <>
                <EditorPaneImpl key="left" filePath="/repo/a.ts" />
                <EditorPaneImpl key="right" filePath="/repo/a.ts" />
            </>,
        );
    });
    expect(heldWatches).toEqual(["desktop /repo", "desktop /repo"]);

    await act(async () => {
        root.render(<EditorPaneImpl key="right" filePath="/repo/a.ts" />);
    });
    expect(heldWatches).toEqual(["desktop /repo"]);
});
