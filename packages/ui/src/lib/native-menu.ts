export interface NativeMenuItem {
    id?: string;
    label?: string;
    enabled?: boolean;
    checked?: boolean;
    type?: "normal" | "separator" | "submenu" | "checkbox" | "label";
    submenu?: NativeMenuItem[];
}

export interface NativeMenuPosition {
    x: number;
    y: number;
}

export type NativeMenuActionMap = Record<string, () => void | Promise<void>>;

function roundPosition(position: NativeMenuPosition): NativeMenuPosition {
    return {
        x: Math.round(position.x),
        y: Math.round(position.y),
    };
}

function supportsNativeMenus(): boolean {
    return typeof window !== "undefined" && typeof window.taskflow?.showNativeMenu === "function";
}

async function showNativeMenu(
    items: NativeMenuItem[],
    position: NativeMenuPosition,
): Promise<string | null> {
    if (!supportsNativeMenus()) return null;
    return window.taskflow?.showNativeMenu(items, roundPosition(position)) ?? null;
}

async function showNativeMenuAndRun(
    items: NativeMenuItem[],
    actions: NativeMenuActionMap,
    position: NativeMenuPosition,
): Promise<void> {
    const selectedId = await showNativeMenu(items, position);
    if (!selectedId) return;
    await actions[selectedId]?.();
}

function getElementMenuPosition(
    element: HTMLElement,
    align: "start" | "end" = "start",
): NativeMenuPosition {
    const rect = element.getBoundingClientRect();
    return {
        x: align === "end" ? rect.right : rect.left,
        y: rect.bottom,
    };
}

function getEventMenuPosition(event: Pick<MouseEvent, "clientX" | "clientY">): NativeMenuPosition {
    return {
        x: event.clientX,
        y: event.clientY,
    };
}

export {
    getElementMenuPosition,
    getEventMenuPosition,
    showNativeMenu,
    showNativeMenuAndRun,
    supportsNativeMenus,
};
