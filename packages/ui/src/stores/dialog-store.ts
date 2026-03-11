import { create } from "zustand";

type DialogVariant = "default" | "destructive";

interface ConfirmOptions {
    title: string;
    description: string;
    confirmLabel?: string;
    cancelLabel?: string;
    variant?: DialogVariant;
    onConfirm?: () => void | Promise<void>;
}

interface AlertOptions {
    title: string;
    description: string;
    confirmLabel?: string;
    onConfirm?: () => void | Promise<void>;
}

interface DialogState {
    open: boolean;
    mode: "alert" | "confirm";
    title: string;
    description: string;
    confirmLabel: string;
    cancelLabel: string;
    variant: DialogVariant;
    loading: boolean;
    error: string | null;
    resolve: ((confirmed: boolean) => void) | null;
    onConfirm: (() => void | Promise<void>) | null;
}

type DialogRequest = Omit<DialogState, "open" | "loading" | "error">;

interface DialogStore extends DialogState {
    queue: DialogRequest[];
    show(state: DialogRequest): void;
    setLoading(loading: boolean): void;
    setError(error: string | null): void;
    dismiss(): void;
}

const initialState: DialogState = {
    open: false,
    mode: "alert",
    title: "",
    description: "",
    confirmLabel: "OK",
    cancelLabel: "Cancel",
    variant: "default",
    loading: false,
    error: null,
    resolve: null,
    onConfirm: null,
};

function activateDialog(state: DialogRequest): DialogState {
    return { ...initialState, ...state, open: true };
}

const useDialogStore = create<DialogStore>((set) => ({
    ...initialState,
    queue: [],
    show(state) {
        set((current) => {
            if (current.open) {
                return { queue: [...current.queue, state] };
            }
            return { ...current, ...activateDialog(state) };
        });
    },
    setLoading(loading) {
        set({ loading });
    },
    setError(error) {
        set({ error });
    },
    dismiss() {
        set((current) => {
            const [next, ...rest] = current.queue;
            if (next) {
                return { ...activateDialog(next), queue: rest };
            }
            return { ...initialState, queue: [] };
        });
    },
}));

function confirm(options: ConfirmOptions): Promise<boolean> {
    return new Promise<boolean>((outerResolve) => {
        useDialogStore.getState().show({
            mode: "confirm",
            title: options.title,
            description: options.description,
            confirmLabel: options.confirmLabel ?? "Confirm",
            cancelLabel: options.cancelLabel ?? "Cancel",
            variant: options.variant ?? "default",
            onConfirm: options.onConfirm ?? null,
            resolve: outerResolve,
        });
    });
}

function alert(options: AlertOptions): Promise<void> {
    return new Promise<void>((outerResolve) => {
        useDialogStore.getState().show({
            mode: "alert",
            title: options.title,
            description: options.description,
            confirmLabel: options.confirmLabel ?? "OK",
            cancelLabel: "",
            variant: "default",
            onConfirm: options.onConfirm ?? null,
            resolve: () => outerResolve(),
        });
    });
}

export { useDialogStore, confirm, alert };
export type { ConfirmOptions, AlertOptions, DialogVariant };
