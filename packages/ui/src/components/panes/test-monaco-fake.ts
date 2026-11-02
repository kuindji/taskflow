/**
 * Just enough of `monaco-editor` for EditorPaneImpl tests, to hand to
 * `mock.module("monaco-editor", () => fake.module)`. Models live in one
 * registry keyed by URI and are shared by every editor on them, as Monaco's are.
 */

type ChangeListener = (e: { isFlush: boolean }) => void;
type FakeUri = { toString(): string };

interface FakeModel {
    uri: string;
    isDisposed(): boolean;
    dispose(): void;
    getValue(): string;
    /** A flush replaces the whole text, as `setValue` does; typing does not. */
    change(next: string, isFlush: boolean): void;
    onChange(listener: ChangeListener): void;
    getAlternativeVersionId(): number;
    getFullModelRange(): object;
    pushStackElement(): void;
    /** An edit, not a flush: the whole-range replacement a reload from disk makes. */
    pushEditOperations(selections: unknown, operations: { text: string }[]): null;
}

interface FakeEditor {
    setValue(text: string): void;
    getValue(): string;
    getModel(): FakeModel;
    restoreViewState(): void;
    saveViewState(): null;
    revealLineInCenter(): void;
    setPosition(): void;
    focus(): void;
    onDidChangeModelContent(listener: ChangeListener): { dispose(): void };
    addCommand(keys: number, handler: () => void): void;
    updateOptions(): void;
    layout(): void;
    dispose(): void;
}

interface FakeMonacoState {
    models: Map<string, FakeModel>;
    editors: Set<FakeEditor>;
    setValueCalls: number;
    /** The newest editor's Cmd+S. */
    pressSave: () => void;
}

function createModel(state: FakeMonacoState, key: string): FakeModel {
    let disposed = false;
    let value = "";
    let version = 1;
    const listeners: ChangeListener[] = [];
    return {
        uri: key,
        isDisposed: () => disposed,
        dispose: () => {
            disposed = true;
            state.models.delete(key);
        },
        getValue: () => value,
        change: (next: string, isFlush: boolean) => {
            value = next;
            version += 1;
            for (const listener of listeners) listener({ isFlush });
        },
        onChange: (listener: ChangeListener) => listeners.push(listener),
        getAlternativeVersionId: () => version,
        getFullModelRange: () => ({}),
        pushStackElement: () => {},
        pushEditOperations: (_selections, operations) => {
            value = operations.map((operation) => operation.text).join("");
            version += 1;
            for (const listener of listeners) listener({ isFlush: false });
            return null;
        },
    };
}

function createEditor(state: FakeMonacoState, model: FakeModel): FakeEditor {
    const editor: FakeEditor = {
        setValue: (text) => {
            state.setValueCalls += 1;
            model.change(text, true);
        },
        getValue: () => model.getValue(),
        getModel: () => model,
        restoreViewState: () => {},
        saveViewState: () => null,
        revealLineInCenter: () => {},
        setPosition: () => {},
        focus: () => {},
        onDidChangeModelContent: (listener) => {
            model.onChange(listener);
            return { dispose: () => {} };
        },
        addCommand: (_keys, handler) => {
            state.pressSave = handler;
        },
        updateOptions: () => {},
        layout: () => {},
        dispose: () => {
            state.editors.delete(editor);
        },
    };
    state.editors.add(editor);
    return editor;
}

export function createMonacoFake() {
    const state: FakeMonacoState = {
        models: new Map(),
        editors: new Set(),
        setValueCalls: 0,
        pressSave: () => {},
    };
    const tsDefaults = { setCompilerOptions: () => {}, setDiagnosticsOptions: () => {} };
    const module = {
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
            getModel: (uri: FakeUri) => state.models.get(uri.toString()) ?? null,
            getModels: () => [...state.models.values()],
            createModel: (_value: string, _language: string, uri: FakeUri) => {
                const model = createModel(state, uri.toString());
                state.models.set(uri.toString(), model);
                return model;
            },
            create: (_container: unknown, options: { model: FakeModel }) =>
                createEditor(state, options.model),
            getEditors: () => [...state.editors],
            remeasureFonts: () => {},
            defineTheme: () => {},
        },
        Uri: { from: (parts: object) => ({ ...parts, toString: () => JSON.stringify(parts) }) },
        KeyMod: { CtrlCmd: 0 },
        KeyCode: { KeyS: 0 },
    };
    return {
        module,
        state,
        /** The live editors, oldest first, as `monaco.editor.getEditors()` lists them. */
        editors: () => [...state.editors],
        /** Typing in the newest editor: changes its model's text as a keystroke would. */
        typeInEditor: (text: string) => [...state.editors].at(-1)?.getModel().change(text, false),
        pressSave: () => state.pressSave(),
        reset: () => {
            state.models.clear();
            state.editors.clear();
            state.setValueCalls = 0;
            state.pressSave = () => {};
        },
    };
}
