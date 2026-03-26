// Minimal preload for the embedded browser <webview>.
// Patches detectable automation fingerprints so that sites like Google
// don't flag the embedded Chromium as a bot.

// Remove the webdriver flag that Electron/Chromium sets by default.
Object.defineProperty(navigator, "webdriver", {
    get: () => undefined,
});
