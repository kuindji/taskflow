import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { act, Activity } from "react";
import { createRoot, type Root } from "react-dom/client";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
// `useIsElectron` is decided when its module loads, so the bridge must exist
// before BrowserPane is imported. Every bridge call the stores make at import
// is a no-op returning a no-op unsubscribe.
const noop = () => () => {};
Object.defineProperty(window, "taskflow", {
    configurable: true,
    value: new Proxy({}, { get: () => noop }),
});
const { BrowserPane } = await import("./BrowserPane");

const reload = mock(() => {});
let guestAttached = false;

// Electron throws from a webview's methods until its guest is attached.
function guest<T>(value: T): T {
    if (!guestAttached) throw new Error("The WebView must be attached to the DOM");
    return value;
}

let container: HTMLDivElement;
let root: Root;

function render(visible: boolean) {
    act(() =>
        root.render(
            <Activity mode={visible ? "visible" : "hidden"}>
                <BrowserPane initialUrl="https://example.com" workspaceKey="master" />
            </Activity>,
        ),
    );
    const webview = container.querySelector("webview");
    if (webview === null) throw new Error("No webview rendered");
    // happy-dom will not register "webview" as a custom element, so give the
    // rendered element Electron's methods directly.
    Object.assign(webview, {
        getURL: () => guest("https://example.com/"),
        canGoBack: () => guest(false),
        reload: () => guest(reload)(),
    });
    return webview;
}

beforeEach(() => {
    reload.mockClear();
    guestAttached = false;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
});

afterAll(() => {
    Reflect.deleteProperty(window, "taskflow");
});

test("a webview that finished loading while its tab was hidden still reloads", () => {
    render(true);
    const webview = render(false);
    // dom-ready fires while the tab is hidden, so no listener sees it.
    guestAttached = true;
    webview.dispatchEvent(new Event("dom-ready"));
    render(true);

    const button = container.querySelector<HTMLButtonElement>('button[aria-label="Reload"]');
    act(() => button?.click());
    expect(reload).toHaveBeenCalledTimes(1);
});

test("reload waits for the guest while the webview is still attaching", () => {
    render(true);
    const button = container.querySelector<HTMLButtonElement>('button[aria-label="Reload"]');
    act(() => button?.click());
    expect(reload).not.toHaveBeenCalled();
});
