import { expect, test, beforeEach, afterEach, mock } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { create } from "zustand";

/**
 * The pane's model identity includes its machine, so while the workspace names
 * no machine (primary closed under the master workspace) there is no model to
 * show. The pane must say it is loading, and a read started for the old machine
 * must not land in the editor it already disposed.
 */

let setValueCalls = 0;
const fakeEditor = () => ({
    setValue: () => {
        setValueCalls += 1;
    },
    restoreViewState: () => {},
    saveViewState: () => null,
    revealLineInCenter: () => {},
    setPosition: () => {},
    focus: () => {},
    onDidChangeModelContent: () => ({ dispose: () => {} }),
    addCommand: () => {},
    updateOptions: () => {},
    layout: () => {},
    dispose: () => {},
});
const fakeModel = () => {
    let disposed = false;
    return {
        isDisposed: () => disposed,
        dispose: () => {
            disposed = true;
        },
    };
};
const tsDefaults = { setCompilerOptions: () => {}, setDiagnosticsOptions: () => {} };

await mock.module("monaco-editor", () => ({
    languages: {
        typescript: {
            JsxEmit: {},
            ScriptTarget: {},
            ModuleKind: {},
            ModuleResolutionKind: {},
            typescriptDefaults: tsDefaults,
            javascriptDefaults: tsDefaults,
        },
    },
    editor: {
        getModel: () => null,
        getModels: () => [],
        createModel: () => fakeModel(),
        create: () => fakeEditor(),
        remeasureFonts: () => {},
        defineTheme: () => {},
    },
    Uri: { from: (parts: object) => ({ ...parts, toString: () => JSON.stringify(parts) }) },
    KeyMod: { CtrlCmd: 0 },
    KeyCode: { KeyS: 0 },
}));

let resolveRead: (content: string) => void = () => {};
const fileStore = {
    readFile: () =>
        new Promise<string>((resolve) => {
            resolveRead = resolve;
        }),
    writeFile: () => Promise.resolve(),
};
await mock.module("@/stores/file-store", () => ({
    useFileStore: () => fileStore,
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

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    setValueCalls = 0;
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
    expect(setValueCalls).toBe(0);
    expect(showsLoading()).toBe(true);
});
