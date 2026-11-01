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
type ChangeListener = (e: { isFlush: boolean }) => void;
type FakeModel = ReturnType<typeof fakeModel>;
type FakeUri = { toString(): string };
/** Monaco's model registry: one model per URI, shared by every editor on it. */
const models = new Map<string, FakeModel>();
const fakeModel = (key: string) => {
    let disposed = false;
    let value = "";
    let version = 1;
    const listeners: ChangeListener[] = [];
    return {
        isDisposed: () => disposed,
        dispose: () => {
            disposed = true;
            models.delete(key);
        },
        getValue: () => value,
        /** A flush replaces the whole text, as `setValue` does; typing does not. */
        change: (next: string, isFlush: boolean) => {
            value = next;
            version += 1;
            for (const listener of listeners) listener({ isFlush });
        },
        onChange: (listener: ChangeListener) => listeners.push(listener),
        getAlternativeVersionId: () => version,
    };
};
/** The live editors, as `monaco.editor.getEditors()` lists them. */
const editors = new Set<FakeEditor>();
type FakeEditor = ReturnType<typeof fakeEditor>;
/** The newest editor's typing: changes its model's text as a keystroke would. */
let typeInEditor: (text: string) => void = () => {};
/** The newest editor's Cmd+S. */
let pressSave: () => void = () => {};
const fakeEditor = (options: { model: FakeModel }) => {
    const { model } = options;
    typeInEditor = (text) => model.change(text, false);
    const editor = {
        setValue: (text: string) => {
            setValueCalls += 1;
            model.change(text, true);
        },
        getValue: () => model.getValue(),
        getModel: () => model,
        restoreViewState: () => {},
        saveViewState: () => null,
        revealLineInCenter: () => {},
        setPosition: () => {},
        focus: () => {},
        onDidChangeModelContent: (listener: ChangeListener) => {
            model.onChange(listener);
            return { dispose: () => {} };
        },
        addCommand: (_keys: number, handler: () => void) => {
            pressSave = handler;
        },
        updateOptions: () => {},
        layout: () => {},
        dispose: () => {
            editors.delete(editor);
        },
    };
    editors.add(editor);
    return editor;
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
        getModel: (uri: FakeUri) => models.get(uri.toString()) ?? null,
        getModels: () => [...models.values()],
        createModel: (_value: string, _language: string, uri: FakeUri) => {
            const model = fakeModel(uri.toString());
            models.set(uri.toString(), model);
            return model;
        },
        create: (_container: unknown, options: { model: FakeModel }) => fakeEditor(options),
        getEditors: () => [...editors],
        remeasureFonts: () => {},
        defineTheme: () => {},
    },
    Uri: { from: (parts: object) => ({ ...parts, toString: () => JSON.stringify(parts) }) },
    KeyMod: { CtrlCmd: 0 },
    KeyCode: { KeyS: 0 },
}));

/** Reads not yet answered; `resolveRead` answers them all. */
const pendingReads: ((content: string) => void)[] = [];
const resolveRead = (content: string) => {
    for (const resolve of pendingReads.splice(0)) resolve(content);
};
const fileStore = {
    readFile: () =>
        new Promise<string>((resolve) => {
            pendingReads.push(resolve);
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
    models.clear();
    editors.clear();
    pendingReads.length = 0;
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
    const [left, right] = [...editors];
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
