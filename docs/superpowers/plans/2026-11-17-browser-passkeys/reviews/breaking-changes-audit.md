# Electron 34–45 breaking-changes audit (Section 2 Step 4)

Source: `docs/breaking-changes.md` on electron/electron `main`, read 2026-11-17. Grepped `electron/src` and `packages/ui/src` (non-test files) for each entry.

## 45.0

- Node shims / `Buffer` / `setImmediate` / `clearImmediate` removed in sandboxed preloads: n/a. Built `dist/preload.js` has only `require("electron")`, `dist/browser-preload.js` has no `require`, and neither uses `Buffer`/`setImmediate`/`clearImmediate`. The Step 10 dev smoke confirms at runtime.
- `ipcRenderer`/`process` use a native `EventEmitter` in sandboxed preloads: n/a. `preload.ts` uses only instance methods (`on`/`removeListener`/`invoke`/`send`), not the static `events` helpers.
- Workers from subframes need `nodeIntegrationInSubFrames`: n/a (no `nodeIntegrationInWorker`).
- Preloads only run in DevTools-hosted extension frames: n/a (no extensions).
- `getUserMedia` `chromeMediaSource: 'desktop'` rejects WebContents ids: n/a (not used).
- `contentTracing.enableHeapProfiling()` removed: n/a.
- `contentTracing` writes Perfetto format: n/a.
- Screen capture reported as `display-capture` in the permission handler: n/a. The browser policy (`permission-policy.ts`) allows neither `media` nor `display-capture`, so screen capture stays denied as before.
- `document.requestStorageAccessFor` disabled by default: n/a (not used by the app; sites lose it as in Chrome).
- ASAR file descriptors only usable through `fs`: n/a. The backend, ripgrep and node-pty live in `extraResources` outside `app.asar`; tray icons are read through `nativeImage` from `app.asar.unpacked`.
- `window.open()` children of unsandboxed windows get their own process: n/a. Browser tabs are `sandbox: true` (`browser-host/electron-views.ts` `preferences`), and the main window has `nodeIntegration: false` with no `sandbox: false`, so it's sandboxed by default (Electron ≥ 20). The Step 10 smoke checks a tab popup.
- Sync `safeStorage` methods deprecated: n/a (not used).

## 44.0

- `webContents` may be `null` in `select-client-certificate`: n/a (no handler).
- macOS 12 dropped: n/a (owner on macOS 27; release notes are Section 4's call).
- ANGLE statically linked: n/a.
- `net.request` rejects frame destinations without navigate mode: n/a (`net` not used).
- Unity support removed (`app.isUnityRunning`): n/a.
- Windows ia32 / Linux armv7l dropped: n/a (builds are x64/arm64 only, `electron/package.json` scripts).
- `clipboard` module removed from renderers: n/a. The UI uses `navigator.clipboard`, and the preload exposes no `clipboard`.
- Pre-macOS 13 login item attributes removed: n/a (`setLoginItemSettings`/`getLoginItemSettings` not used).

## 43.0

- Rounded corners on Linux: n/a (Linux not exercised; cosmetic).
- WCO respects the native title bar layout on Linux: n/a.
- `NativeImage.toBitmap()` normalizes to sRGB: n/a. `tray-manager.ts` `createIconWithDot` edits the bitmap of `menubar-icon@2x.png`, which `build.ts` renders from SVG with no embedded color profile (`sips -g profile` → `<nil>`), so the sRGB conversion is the identity.
- `chrome.scripting` CSS injection: n/a (no extensions).
- Dialogs default to Downloads: fixed: `createLastPathTracker()` (`dialog-last-path.ts`), one tracker per open dialog in `ipc-handlers.ts`. `showSaveDialog` is left as is (plan Step 7).
- `showHiddenFiles` removed on Linux: n/a (not used).

## 42.0

- macOS notifications use `UNNotification`, unsigned apps get `failed`: fixed: `failed` listener in `main.ts` logs `Desktop notification failed:`. Signed build checked in Step 11.
- `electron` no longer downloads in `postinstall`: fixed by procedure, no code. `bunx electron --version` (from `electron/`) downloads on the first run and prints `v45.3.3`. `electron .` in the `dev` script goes through the same `cli.js`. The repo has no `ELECTRON_SKIP_BINARY_DOWNLOAD`/`install-electron` references and no CI workflows. electron-builder fetches its own copy (checked by the Step 11 package build).
- Offscreen rendering default scale factor 1.0: n/a (no OSR; the UI's `offscreen` hit is a CSS/DOM name).
- `quotas` removed from `clearStorageData`: n/a (not used).
- Array `hslShift` to `createFromNamedImage` deprecated: n/a (not used).

## 41.0

- PDFs no longer create a separate WebContents: n/a. Tab handling keys on the tab's own `webContents`; nothing looks for PDF guest contents.
- Cookie `changed` cause values: n/a (no cookie listeners).
- `showHiddenFiles` deprecated on Linux: n/a.

## 40.0

- `clipboard` from renderers deprecated: n/a (see 44).
- dSYM compressed as tar.xz: n/a.

## 39.0

- `--host-rules` deprecated: n/a (main.ts appends only `remote-debugging-address`, `remote-debugging-port`, `disable-blink-features`).
- `window.open` popups always resizable: n/a (popups become tabs, `WebContentsView`s with no window chrome).
- `NSAudioCaptureUsageDescription` for `desktopCapturer`: n/a (not used).
- Shared-texture OSR `paint` structure: n/a.

## 38.0

- `ELECTRON_OZONE_PLATFORM_HINT` removed: n/a.
- `ORIGINAL_XDG_CURRENT_DESKTOP` removed: n/a.
- macOS 11 dropped: n/a.
- `plugin-crashed` removed: n/a.
- `webFrame.routingId` / `findFrameByRoutingId` deprecated: n/a.

## 37.0

- Utility process unhandled rejections warn: n/a (no `utilityProcess`; the backend is a spawned child).
- `process.exit()` in utility process is synchronous: n/a.
- WebUSB/WebSerial blocklist: n/a (`setDevicePermissionHandler(() => false)` on tabs).
- `null` `session` in `ProtocolResponse` removed: n/a (no `protocol` handlers).
- `isVisibleOnAllWorkspaces()` on Linux: n/a.

## 36.0

- `app.commandLine` lowercases switches: n/a. All three appended switches are already lowercase.
- `NativeImage.getBitmap()` deprecated: n/a (uses `toBitmap()`).
- `PrinterInfo` `isDefault`/`status` removed: n/a.
- `syncable` quota removed: n/a.
- `null` `session` in `ProtocolResponse` deprecated: n/a.
- `quota` in `clearStorageData` deprecated: n/a.
- Extension methods moved to `session.extensions`: n/a.
- `systemPreferences.isAeroGlassEnabled()` removed: n/a.
- GTK 4 default on GNOME: n/a (Linux not exercised).

## 35.0

- Dialog `defaultPath` on Linux needs portal v4: n/a for macOS. On Linux an older portal ignores the new `defaultPath`, and the dialog behaves as before.
- `serviceWorkers.fromVersionID` deprecated: n/a.
- `setPreloads`/`getPreloads` deprecated: n/a.
- `console-message` positional args deprecated: n/a (no listener).
- Empty `WebRequestFilter.urls` no longer means all: n/a (no `webRequest`).
- `isAeroGlassEnabled()` deprecated: n/a.

## 34.0

- Menu bar hidden during fullscreen on Windows: n/a (Windows not exercised; matches Linux behavior).

## Not in the doc, found by typecheck

- `app.dock` is typed `Dock | undefined`: fixed: `window-manager.ts` `showDockIcon`/`hideDockIcon` use `app.dock?.`.
