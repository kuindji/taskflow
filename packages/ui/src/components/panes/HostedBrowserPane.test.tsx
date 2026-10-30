import { afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { act, Activity } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { BrowserTab } from "@taskflow/shared";
import { registerOverlay } from "@/lib/overlay-registry";
import { HostedBrowserPane } from "./HostedBrowserPane";

type Bridge = NonNullable<Window["taskflow"]>["browser"];
let nav: Parameters<Bridge["onNavState"]>[0];
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const bridge = {
    show: mock(async () => {}),
    hide: mock(async () => {}),
    navigate: mock(async () => {}),
    back: mock(async () => {}),
    reload: mock(async () => {}),
    forward: mock(async () => {}),
    freeze: mock(async () => "data:image/png;base64,cGlj"),
    onNavState: mock((cb: typeof nav) => {
        nav = cb;
        return () => {};
    }),
} satisfies Bridge;
const tab: BrowserTab = {
    id: "a",
    scope: { kind: "master" },
    label: "Page",
    url: "https://example.com",
    createdAt: "2026-10-30T00:00:00Z",
    loaded: true,
    agentConnections: 0,
};
const rect = new DOMRect(0, 40, 500, 400);
let container: HTMLDivElement;
let root: Root;
let rectSpy: ReturnType<typeof spyOn<HTMLElement, "getBoundingClientRect">>;
const cleanups: (() => void)[] = [];
function requiredElement(selector: string): HTMLInputElement | HTMLButtonElement {
    const el = container.querySelector(selector);
    if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLButtonElement))
        throw new Error(`Missing element: ${selector}`);
    return el;
}
async function settle() {
    await act(async () => {
        await Bun.sleep(40);
    });
}
async function render() {
    act(() => root.render(<HostedBrowserPane tab={tab} />));
    await settle();
}
beforeEach(() => {
    for (const fn of Object.values(bridge)) fn.mockClear();
    bridge.freeze.mockImplementation(async () => "data:image/png;base64,cGlj");
    Object.defineProperty(window, "taskflow", { configurable: true, value: { browser: bridge } });
    rectSpy = spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
        this: HTMLElement,
    ) {
        return this.classList.contains("w-fit") ? new DOMRect(10, 45, 70, 20) : rect;
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
});
afterEach(() => {
    act(() => root.unmount());
    cleanups.splice(0).forEach((fn) => fn());
    rectSpy.mockRestore();
    container.remove();
});
test("shows with the placeholder rect on mount", async () => {
    await render();
    expect(bridge.show).toHaveBeenCalledWith("a", tab.url, {
        x: 0,
        y: 40,
        width: 500,
        height: 400,
    });
});
test("hides on unmount", async () => {
    await render();
    act(() => root.unmount());
    expect(bridge.hide).toHaveBeenCalledWith("a");
    root = createRoot(container);
});
test("a url change from navigation keeps the view shown", async () => {
    await render();
    act(() => root.render(<HostedBrowserPane tab={{ ...tab, url: "https://example.com/next" }} />));
    await settle();
    expect(bridge.hide).not.toHaveBeenCalled();
    expect(container.querySelector("input")?.value).toBe("https://example.com/next");
});
test("an intersecting overlay freezes and renders the image; removing it shows again", async () => {
    await render();
    const unregister = registerOverlay(document.createElement("div"));
    cleanups.push(unregister);
    await settle();
    expect(bridge.freeze).toHaveBeenCalledWith("a");
    expect(container.querySelector("img")?.src).toBe("data:image/png;base64,cGlj");
    const shows = bridge.show.mock.calls.length;
    unregister();
    await settle();
    expect(bridge.show.mock.calls.length).toBeGreaterThan(shows);
    expect(container.querySelector("img")).toBeNull();
});
test("a non-intersecting overlay does not freeze", async () => {
    await render();
    const el = document.createElement("div");
    el.getBoundingClientRect = () => new DOMRect(900, 900, 20, 20);
    cleanups.push(registerOverlay(el));
    await settle();
    expect(bridge.freeze).not.toHaveBeenCalled();
});
test("Enter in the url input navigates through the bridge", async () => {
    await render();
    const input = requiredElement("input");
    act(() => {
        input.value = "https://new.test";
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(bridge.navigate).toHaveBeenCalledWith("a", "https://new.test");
});
test("back is disabled until nav state says canGoBack", async () => {
    await render();
    const back = requiredElement('[aria-label="Go back"]');
    expect(back.disabled).toBe(true);
    act(() => nav("other", { canGoBack: true, canGoForward: false }));
    expect(back.disabled).toBe(true);
    act(() => nav("a", { canGoBack: true, canGoForward: false }));
    const enabledBack = requiredElement('[aria-label="Go back"]');
    expect(enabledBack.disabled).toBe(false);
    act(() => enabledBack.click());
    expect(bridge.back).toHaveBeenCalledWith("a");
});
test("a toolbar button's InlineTooltip over the pane freezes it", async () => {
    await render();
    const reload = requiredElement('[aria-label="Reload"]');
    act(() => {
        reload.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });
    await settle();
    expect(bridge.freeze).toHaveBeenCalledWith("a");
    act(() => {
        reload.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
    });
    await settle();
    expect(container.querySelector("img")).toBeNull();
});
test("an empty or failed freeze leaves the placeholder blank", async () => {
    await render();
    bridge.freeze.mockImplementation(async () => "");
    const remove = registerOverlay(document.createElement("div"));
    cleanups.push(remove);
    await settle();
    expect(container.querySelector("img")).toBeNull();
    remove();
    await settle();
    bridge.freeze.mockImplementation(async () => {
        throw new Error("capture failed");
    });
    cleanups.push(registerOverlay(document.createElement("div")));
    await settle();
    expect(container.querySelector("img")).toBeNull();
});
test("Activity hiding hides the view without closing the tab", async () => {
    act(() =>
        root.render(
            <Activity mode="visible">
                <HostedBrowserPane tab={tab} />
            </Activity>,
        ),
    );
    await settle();
    bridge.hide.mockClear();
    act(() =>
        root.render(
            <Activity mode="hidden">
                <HostedBrowserPane tab={tab} />
            </Activity>,
        ),
    );
    await settle();
    expect(bridge.hide).toHaveBeenCalledWith("a");
});
