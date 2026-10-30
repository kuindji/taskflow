// Spike copy of electron/src/browser-preload.ts plus a main-world marker so the
// test pages can tell the preload ran (the navigator patch lives in the
// isolated world when contextIsolation is on).
const { contextBridge } = require("electron");

Object.defineProperty(navigator, "webdriver", {
    get: () => undefined,
});

contextBridge.exposeInMainWorld("__spikePreload", true);
