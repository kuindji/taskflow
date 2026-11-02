import { expect, test, beforeAll, afterAll, beforeEach, afterEach, mock } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MSG } from "@taskflow/shared";
import type { FileChangeEvent, FileWritePayload } from "@taskflow/shared";
import { createMonacoFake } from "./test-monaco-fake";

/**
 * An editor follows its file on disk: a clean buffer takes an outside edit, a
 * dirty one asks, and a save refuses to bury an edit it never saw. Reads and
 * writes go through the real file-store to a backend whose disk names each
 * text by a hash, as the real one does.
 */

const monaco = createMonacoFake();
await mock.module("monaco-editor", () => monaco.module);

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

await mock.module("@/hooks/useWorkspaceBackend", () => ({
    useWorkspaceBackend: () => "desktop",
}));

await mock.module("@/lib/monaco-import-navigation", () => ({
    syncCompilerOptions: () => Promise.resolve(),
    registerImportNavigation: () => {},
}));

const { startTestServer } = await import("@/lib/test-ws-server");
const { openConnection, closeConnection } = await import("@/lib/connection-registry");
const { resetBackend } = await import("@/stores/store-reset");
const { default: EditorPaneImpl } = await import("./EditorPaneImpl");
const { isEditorDirty, clearEditorDirty, clearDiskBaseline } = await import("./editor-dirty-state");

// @ts-expect-error react act env flag, no upstream type for this global
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PATH = "/repo/src/a.ts";
const disk = new Map<string, string>();
const hashOf = (content: string) => `hash:${content}`;
/** Every write that reached the disk, in order. */
const diskWrites: string[] = [];

const desktop = startTestServer("desktop", (type, payload) => {
    if (type === MSG.FILE_READ) {
        const content = disk.get((payload as { path: string }).path) ?? "";
        return { content, hash: hashOf(content) };
    }
    if (type === MSG.FILE_WRITE) {
        const { path, content, expected } = payload as FileWritePayload;
        if (expected !== undefined && expected !== hashOf(disk.get(path) ?? "")) {
            return { success: false, conflict: true };
        }
        disk.set(path, content);
        diskWrites.push(content);
        return { success: true, hash: hashOf(content) };
    }
    return {};
});

beforeAll(async () => {
    await openConnection("desktop", desktop.origin);
});

afterAll(() => {
    closeConnection("desktop", "detach");
    resetBackend("desktop");
    desktop.stop();
});

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    monaco.reset();
    disk.clear();
    diskWrites.length = 0;
    clearEditorDirty("desktop", PATH);
    clearDiskBaseline("desktop", PATH);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
});

async function settle() {
    for (let i = 0; i < 4; i++) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        act(() => {});
    }
}

async function openEditor(content: string) {
    disk.set(PATH, content);
    act(() => {
        root.render(<EditorPaneImpl filePath={PATH} />);
    });
    await settle();
}

/** Something outside the editor (an agent, a terminal) rewrites the file. */
async function editOnDisk(
    content: string,
    event: FileChangeEvent = { type: "modify", path: PATH },
) {
    disk.set(PATH, content);
    desktop.broadcast(MSG.FILE_CHANGED, event);
    await settle();
}

async function type(text: string) {
    act(() => {
        monaco.typeInEditor(text);
    });
    await settle();
}

async function save() {
    act(() => {
        monaco.pressSave();
    });
    await settle();
}

function bar(pane: Element = container): string | null {
    return pane.querySelector('[role="alert"]')?.textContent ?? null;
}

async function click(label: string, pane: Element = container) {
    const button = Array.from(pane.querySelectorAll("button")).find((b) => b.textContent === label);
    if (!button) throw new Error(`No "${label}" button`);
    act(() => {
        button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();
}

const shown = () => monaco.editors()[0].getValue();

test("a clean buffer takes an outside edit of its file", async () => {
    await openEditor("v1");
    await editOnDisk("agent");

    expect(shown()).toBe("agent");
    expect(bar()).toBeNull();
    expect(isEditorDirty("desktop", PATH)).toBe(false);
});

test("a clean buffer takes an edit named only by a collapsed event on an ancestor", async () => {
    await openEditor("v1");
    // A sibling directory sharing the prefix does not cover the file.
    await editOnDisk("not yet", { type: "modify", path: "/repo/sr", recursive: true });
    expect(shown()).toBe("v1");

    await editOnDisk("checkout", { type: "modify", path: "/repo", recursive: true });
    expect(shown()).toBe("checkout");
});

test("a dirty buffer keeps its text and asks; Reload takes the disk's", async () => {
    await openEditor("v1");
    await type("mine");
    await editOnDisk("agent");

    expect(shown()).toBe("mine");
    expect(bar()).toContain("Changed on disk");
    expect(isEditorDirty("desktop", PATH)).toBe(true);

    await click("Reload");
    expect(shown()).toBe("agent");
    expect(bar()).toBeNull();
    expect(isEditorDirty("desktop", PATH)).toBe(false);
});

test("a dirty buffer asked about an edit can keep its text and save over that edit", async () => {
    await openEditor("v1");
    await type("mine");
    await editOnDisk("agent", { type: "modify", path: "/repo/src", recursive: true });
    expect(bar()).toContain("Changed on disk");

    await click("Keep mine");
    expect(bar()).toBeNull();
    await save();

    expect(disk.get(PATH)).toBe("mine");
    expect(isEditorDirty("desktop", PATH)).toBe(false);
});

test("a save over an edit the editor never saw is refused and keeps the buffer unsaved", async () => {
    await openEditor("v1");
    await type("mine");
    // Changed with no event reaching the editor yet.
    disk.set(PATH, "agent");
    await save();

    expect(disk.get(PATH)).toBe("agent");
    expect(diskWrites).toEqual([]);
    expect(isEditorDirty("desktop", PATH)).toBe(true);
    expect(bar()).toContain("Not saved");

    await click("Overwrite");
    expect(disk.get(PATH)).toBe("mine");
    expect(isEditorDirty("desktop", PATH)).toBe(false);
    expect(bar()).toBeNull();
});

test("two saves in quick succession both go through", async () => {
    await openEditor("v1");
    await type("v2");
    act(() => {
        monaco.pressSave();
        monaco.pressSave();
    });
    await settle();

    expect(diskWrites).toEqual(["v2", "v2"]);
    expect(bar()).toBeNull();
    expect(isEditorDirty("desktop", PATH)).toBe(false);
});

test("the change event of the editor's own save neither reloads nor asks", async () => {
    await openEditor("v1");
    await type("v2");
    await save();
    // Typed after the save, before its event arrives.
    await type("v3");
    await editOnDisk("v2");

    expect(shown()).toBe("v3");
    expect(bar()).toBeNull();
    expect(isEditorDirty("desktop", PATH)).toBe(true);
});

test("a dirty buffer unmounted and remounted still refuses to save over an outside edit", async () => {
    await openEditor("v1");
    await type("mine");
    act(() => root.unmount());
    root = createRoot(container);
    // Changed while no editor was showing the file.
    disk.set(PATH, "agent");

    act(() => {
        root.render(<EditorPaneImpl filePath={PATH} />);
    });
    await settle();
    expect(shown()).toBe("mine");
    await save();

    expect(disk.get(PATH)).toBe("agent");
    expect(bar()).toContain("Not saved");
    expect(isEditorDirty("desktop", PATH)).toBe(true);
});

test("split panes on one file share what the disk last held", async () => {
    disk.set(PATH, "v1");
    act(() => {
        root.render(
            <>
                <EditorPaneImpl key="left" filePath={PATH} />
                <EditorPaneImpl key="right" filePath={PATH} />
            </>,
        );
    });
    await settle();
    const [leftPane, rightPane] = Array.from(container.children);

    // The right pane saves; its event reaches both.
    await type("v2");
    await save();
    await editOnDisk("v2");
    expect(bar(leftPane)).toBeNull();
    expect(bar(rightPane)).toBeNull();

    // The left pane's save names the text the right pane wrote, not its own load.
    await type("v3");
    await click("Save", leftPane);
    expect(disk.get(PATH)).toBe("v3");
    expect(bar(leftPane)).toBeNull();

    // An outside edit of the clean model reaches both panes as one text.
    await editOnDisk("agent");
    expect(monaco.editors().map((editor) => editor.getValue())).toEqual(["agent", "agent"]);
    expect(bar()).toBeNull();
});
