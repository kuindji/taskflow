// packages/ui/src/stores/markdown-input-store.ts
import { create } from "zustand";

interface EditorState {
    buffer: string;
    isOpen: boolean;
    position: { x: number; y: number } | null;
    size: { width: number; height: number } | null;
}

interface MarkdownInputState {
    editors: Record<string, EditorState>;
    open: (sessionId: string) => void;
    close: (sessionId: string) => void;
    toggle: (sessionId: string) => void;
    setBuffer: (sessionId: string, text: string) => void;
    clearBuffer: (sessionId: string) => void;
    setPosition: (sessionId: string, position: { x: number; y: number }) => void;
    setSize: (sessionId: string, size: { width: number; height: number }) => void;
    cleanup: (sessionId: string) => void;
}

function getEditor(state: MarkdownInputState, sessionId: string): EditorState {
    return state.editors[sessionId] ?? { buffer: "", isOpen: false, position: null, size: null };
}

const useMarkdownInputStore = create<MarkdownInputState>((set) => ({
    editors: {},

    open(sessionId) {
        set((state) => ({
            editors: {
                ...state.editors,
                [sessionId]: { ...getEditor(state, sessionId), isOpen: true },
            },
        }));
    },

    close(sessionId) {
        set((state) => ({
            editors: {
                ...state.editors,
                [sessionId]: { ...getEditor(state, sessionId), isOpen: false },
            },
        }));
    },

    toggle(sessionId) {
        set((state) => {
            const editor = getEditor(state, sessionId);
            return {
                editors: {
                    ...state.editors,
                    [sessionId]: { ...editor, isOpen: !editor.isOpen },
                },
            };
        });
    },

    setBuffer(sessionId, text) {
        set((state) => ({
            editors: {
                ...state.editors,
                [sessionId]: { ...getEditor(state, sessionId), buffer: text },
            },
        }));
    },

    clearBuffer(sessionId) {
        set((state) => ({
            editors: {
                ...state.editors,
                [sessionId]: { ...getEditor(state, sessionId), buffer: "" },
            },
        }));
    },

    setPosition(sessionId, position) {
        set((state) => ({
            editors: {
                ...state.editors,
                [sessionId]: { ...getEditor(state, sessionId), position },
            },
        }));
    },

    setSize(sessionId, size) {
        set((state) => ({
            editors: {
                ...state.editors,
                [sessionId]: { ...getEditor(state, sessionId), size },
            },
        }));
    },

    cleanup(sessionId) {
        set((state) => {
            const { [sessionId]: _, ...rest } = state.editors;
            return { editors: rest };
        });
    },
}));

export { useMarkdownInputStore, getEditor };
export type { EditorState, MarkdownInputState };
