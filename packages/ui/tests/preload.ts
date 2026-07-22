import { GlobalRegistrator } from "@happy-dom/global-registrator";

// This preload runs for the *entire* test run (it's wired into the root
// bunfig.toml, alongside the backend's own preload), not just the UI
// component tests that need a DOM. `GlobalRegistrator.register()` copies
// every own property of a happy-dom `Window` onto `globalThis`, which
// replaces natives the backend tests and production code rely on --
// `setTimeout`/`setInterval`/`clearTimeout`/`clearInterval`,
// `queueMicrotask`, and the Fetch primitives (`fetch`, `Request`,
// `Response`, `Headers`, `URL`, `AbortController`, `WebSocket`).
//
// Notably, happy-dom's `setTimeout` swallows a throw inside the callback
// (wraps it in try/catch), which would silently turn a real backend bug
// (an error inside a retry timer, a poll, a debounced flush) into a
// reported pass. Its Fetch classes also behave differently from the ones
// `Bun.serve` actually uses in production (different default content-type,
// no validation of out-of-range statuses, accepts a GET with a body).
//
// So: capture the native globals *before* registering happy-dom, then
// restore them immediately after. The UI component tests only need the DOM
// surface (document, HTMLElement, Event, ...) -- they don't need happy-dom's
// versions of these particular globals -- while every other test in the
// monorepo keeps Bun's real natives.
const NATIVE = [
    "setTimeout",
    "setInterval",
    "clearTimeout",
    "clearInterval",
    "queueMicrotask",
    "fetch",
    "Request",
    "Response",
    "Headers",
    "URL",
    "AbortController",
    "AbortSignal",
    "WebSocket",
    "Blob",
    "File",
    "FormData",
    "DOMException",
    "TransformStream",
    "WritableStream",
] as const;

// Deliberately NOT restored, because the component tests need happy-dom's
// versions to match the nodes happy-dom creates: `Event`, `EventTarget`,
// `CustomEvent`, `MessageEvent`, `CloseEvent`, `ErrorEvent`, `MessagePort`,
// `navigator`, `addEventListener`, `removeEventListener`, `dispatchEvent`,
// `postMessage`, `PerformanceObserverEntryList`. Restoring Bun's natives for
// those would break React's event handling against happy-dom DOM nodes.

const saved = new Map<string, PropertyDescriptor>();
for (const key of NATIVE) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    if (descriptor) saved.set(key, descriptor);
}

GlobalRegistrator.register();

for (const [key, descriptor] of saved) {
    Object.defineProperty(globalThis, key, { ...descriptor, configurable: true });
}
