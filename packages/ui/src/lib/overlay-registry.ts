import { useCallback, useLayoutEffect, type Ref, type RefObject } from "react";

const overlays = new Set<HTMLElement>();
const subscribers = new Set<() => void>();
export function notifyOverlaysChanged(): void {
    for (const cb of subscribers) cb();
}
export function registerOverlay(el: HTMLElement): () => void {
    overlays.add(el);
    const resize = new ResizeObserver(notifyOverlaysChanged);
    resize.observe(el);
    const changes = new MutationObserver(notifyOverlaysChanged);
    const options = { attributes: true, attributeFilter: ["style", "data-state", "hidden"] };
    changes.observe(el, options);
    if (el.parentElement) changes.observe(el.parentElement, options);
    notifyOverlaysChanged();
    return () => {
        resize.disconnect();
        changes.disconnect();
        if (overlays.delete(el)) notifyOverlaysChanged();
    };
}
export function subscribeOverlays(cb: () => void): () => void {
    subscribers.add(cb);
    return () => {
        subscribers.delete(cb);
    };
}
export function overlayRects(): DOMRect[] {
    return [...overlays]
        .filter((el) => el.dataset.state !== "closed" && !el.hidden)
        .map((el) => el.getBoundingClientRect());
}
export function useRegisterOverlay(ref: RefObject<HTMLElement | null>, open: boolean): void {
    useLayoutEffect(() => {
        if (open && ref.current) return registerOverlay(ref.current);
    }, [ref, open]);
}

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
    if (typeof ref === "function") return ref(value);
    if (ref) ref.current = value;
}

// Radix mounts its content inside a portal after the wrapper's effects ran.
// A callback ref follows that element's actual lifetime, including exit animations.
export function useOverlayRef<T extends HTMLElement>(forwardedRef?: Ref<T>) {
    return useCallback(
        (el: T | null) => {
            let cleanup: (() => void) | undefined;
            if (el) cleanup = registerOverlay(el);
            const forwardedCleanup = assignRef(forwardedRef, el);
            return () => {
                cleanup?.();
                if (typeof forwardedCleanup === "function") forwardedCleanup();
                else assignRef(forwardedRef, null);
            };
        },
        [forwardedRef],
    );
}
