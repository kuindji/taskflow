import { afterEach, expect, test } from "bun:test";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
    registerOverlay,
    overlayRects,
    subscribeOverlays,
    notifyOverlaysChanged,
    useRegisterOverlay,
} from "./overlay-registry";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const cleanups: (() => void)[] = [];
let root: Root | undefined;
afterEach(() => {
    if (root) act(() => root?.unmount());
    root = undefined;
    cleanups.splice(0).forEach((fn) => fn());
    document.body.replaceChildren();
});
test("register adds a rect and the cleanup removes it", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    el.getBoundingClientRect = () => new DOMRect(10, 20, 30, 40);
    const unregister = registerOverlay(el);
    cleanups.push(unregister);
    expect(overlayRects()).toEqual([new DOMRect(10, 20, 30, 40)]);
    unregister();
    expect(overlayRects()).toEqual([]);
});
test("subscribers fire on register and unregister", () => {
    let calls = 0;
    cleanups.push(subscribeOverlays(() => calls++));
    const unregister = registerOverlay(document.createElement("div"));
    cleanups.push(unregister);
    expect(calls).toBe(1);
    unregister();
    expect(calls).toBe(2);
});
test("useRegisterOverlay registers only while open", () => {
    const ref = { current: document.createElement("div") };
    function Overlay({ open }: { open: boolean }) {
        useRegisterOverlay(ref, open);
        return null;
    }
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root?.render(createElement(Overlay, { open: false })));
    expect(overlayRects()).toHaveLength(0);
    act(() => root?.render(createElement(Overlay, { open: true })));
    expect(overlayRects()).toHaveLength(1);
    act(() => root?.render(createElement(Overlay, { open: false })));
    expect(overlayRects()).toHaveLength(0);
});
test("notifyOverlaysChanged fires subscribers", () => {
    let calls = 0;
    cleanups.push(subscribeOverlays(() => calls++));
    notifyOverlaysChanged();
    expect(calls).toBe(1);
});
