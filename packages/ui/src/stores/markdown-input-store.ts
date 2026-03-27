// packages/ui/src/stores/markdown-input-store.ts
import { create } from "zustand";

interface EditorState {
    buffer: string;
    isOpen: boolean;
}

interface MarkdownInputState {
    editors: Record<string, EditorState>;
    position: { x: number; y: number } | null;
    size: { width: number; height: number } | null;
    open: (sessionId: string) => void;
    close: (sessionId: string) => void;
    toggle: (sessionId: string) => void;
    setBuffer: (sessionId: string, text: string) => void;
    clearBuffer: (sessionId: string) => void;
    setPosition: (position: { x: number; y: number }) => void;
    setSize: (size: { width: number; height: number }) => void;
    hydrateLayout: (
        position: { x: number; y: number } | undefined,
        size: { width: number; height: number } | undefined,
    ) => void;
    cleanup: (sessionId: string) => void;
}

function getEditor(state: MarkdownInputState, sessionId: string): EditorState {
    return state.editors[sessionId] ?? { buffer: "", isOpen: false };
}

const useMarkdownInputStore = create<MarkdownInputState>((set) => ({
    editors: {},
    position: null,
    size: null,

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

    setPosition(position) {
        set({ position });
    },

    setSize(size) {
        set({ size });
    },

    hydrateLayout(position, size) {
        set({
            position: position ?? null,
            size: size ?? null,
        });
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
