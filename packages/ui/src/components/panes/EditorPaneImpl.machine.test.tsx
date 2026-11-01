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
type FakeModel = ReturnType<typeof fakeModel>;
const fakeModel = () => {
    let disposed = false;
    let value = "";
    let version = 1;
    return {
        isDisposed: () => disposed,
        dispose: () => {
            disposed = true;
        },
        getValue: () => value,
        setValue: (next: string) => {
            value = next;
            version += 1;
        },
        getAlternativeVersionId: () => version,
    };
};
/** The newest editor's typing: changes its model's text as a keystroke would. */
let typeInEditor: (text: string) => void = () => {};
/** The newest editor's Cmd+S. */
let pressSave: () => void = () => {};
const fakeEditor = (options: { model: FakeModel }) => {
    const { model } = options;
    const listeners: (() => void)[] = [];
    typeInEditor = (text) => {
        model.setValue(text);
        for (const listener of listeners) listener();
    };
    return {
        setValue: (text: string) => {
            setValueCalls += 1;
            model.setValue(text);
        },
        getValue: () => model.getValue(),
        getModel: () => model,
        restoreViewState: () => {},
        saveViewState: () => null,
        revealLineInCenter: () => {},
        setPosition: () => {},
        focus: () => {},
        onDidChangeModelContent: (listener: () => void) => {
            listeners.push(listener);
            return { dispose: () => {} };
        },
        addCommand: (_keys: number, handler: () => void) => {
            pressSave = handler;
        },
        updateOptions: () => {},
        layout: () => {},
        dispose: () => {},
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
        create: (_container: unknown, options: { model: FakeModel }) => fakeEditor(options),
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
    writeFile: (_backendId: string, _path: string, content: string) => {
        writes.push(content);
        return writeHold;
    },
};
/** What each save sent; a save's answer waits for `writeHold`. */
const writes: string[] = [];
let writeHold: Promise<void> = Promise.resolve();
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
const { isEditorDirty, clearEditorDirty } = await import("./editor-dirty-state");

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    setValueCalls = 0;
    writes.length = 0;
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
    expect(setValueCalls).toBe(0);
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
