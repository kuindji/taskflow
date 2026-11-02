import * as monaco from "monaco-editor";

/** Models whose text is being replaced from disk: the change events this raises are not edits. */
const syncing = new WeakSet<monaco.editor.ITextModel>();

/**
 * Puts the disk's text in a model as one undoable step, so the user can step
 * back to what they had. Every editor showing the model (split panes share
 * one) keeps its cursor and scroll where the new text allows.
 */
function replaceFromDisk(model: monaco.editor.ITextModel, text: string): void {
    const editors = monaco.editor.getEditors().filter((editor) => editor.getModel() === model);
    const viewStates = editors.map((editor) => editor.saveViewState());
    syncing.add(model);
    try {
        model.pushStackElement();
        model.pushEditOperations([], [{ range: model.getFullModelRange(), text }], () => null);
        model.pushStackElement();
    } finally {
        syncing.delete(model);
    }
    editors.forEach((editor, index) => {
        const viewState = viewStates[index];
        if (viewState) editor.restoreViewState(viewState);
    });
}

const saveChains = new WeakMap<monaco.editor.ITextModel, Promise<unknown>>();

/**
 * Saves of one model, from any pane on it, run one at a time: each names the
 * text the one before it wrote, where two saves in flight together would both
 * name the same text and the second would be refused as a conflict.
 */
function queueSave<T>(model: monaco.editor.ITextModel, save: () => Promise<T>): Promise<T> {
    const previous = saveChains.get(model) ?? Promise.resolve();
    const result = previous.then(save, save);
    saveChains.set(
        model,
        result.catch(() => undefined),
    );
    return result;
}

/** True while `replaceFromDisk` is changing `model`, so its change listeners can tell. */
function isDiskSync(model: monaco.editor.ITextModel): boolean {
    return syncing.has(model);
}

export { replaceFromDisk, isDiskSync, queueSave };
