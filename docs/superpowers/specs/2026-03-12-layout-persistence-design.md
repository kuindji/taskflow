# Layout Persistence Design

Persist window size/position and panel widths between app runs using the existing `SettingsStore` infrastructure.

## Data Model

Add a `layout` section to `AppSettings`:

```typescript
interface WindowSettings {
    x: number;
    y: number;
    width: number;
    height: number;
    isMaximized: boolean;
}

interface PanelSettings {
    sidebarWidth: number;
    fileExplorerWidth: number;
    taskInfoWidth: number;
}

interface LayoutSettings {
    window: WindowSettings;
    panels: PanelSettings;
}
```

Defaults: window `1400x900` (no x/y, centered), panels `220/220/220`.

`LayoutSettings` is added to `AppSettings` as `layout`, and `SettingsUpdatePayload` gets `layout?: Partial<LayoutSettings>` with nested partials for `window` and `panels`.

## Save Flow

### Panel Widths

`AppShell` wires the existing `onResizeEnd` callback on each `ResizeHandle`. On mouse-up, it calls `settingsStore.updateSettings({ layout: { panels: { sidebarWidth, fileExplorerWidth, taskInfoWidth } } })` with current values from `ui-store`. Natural debounce — only fires on mouse-up.

### Window Bounds

On `before-quit`, the Electron main process:
1. Reads `mainWindow.isMaximized()`.
2. If not maximized, reads `mainWindow.getBounds()` → `{ x, y, width, height }`.
3. If maximized, uses the last non-maximized bounds (tracked via `resize`/`move` events) so that un-maximizing restores the right size.
4. Makes an HTTP `PATCH /settings` to the backend with the window layout.

## Restore Flow

### Window Bounds

In `createWindow()`, before constructing `BrowserWindow`:
1. HTTP `GET /settings` from the backend.
2. If `layout.window` exists and has `x`/`y`, validate the position is on a connected display using Electron's `screen.getDisplayMatching()`. If the saved rect doesn't overlap any display, fall back to defaults.
3. If `isMaximized`, create the window at saved size/position, then call `mainWindow.maximize()` after creation.
4. Falls back to `1400x900`, centered, if no saved state.

### Panel Widths

The UI already calls `fetchSettings()` on startup. After fetching, hydrate `ui-store` with `layout.panels` values via a new `hydrateLayout(panels)` method. This sets `sidebarWidth`, `fileExplorerWidth`, `taskInfoWidth` in one call.

## Backend Changes

### SettingsStore

Add `layout` to defaults in `createDefaultSettings()` and merge logic in `get()` and `update()`.

### HTTP Settings Endpoint

Expose on the existing HTTP server (used for health/port signaling):
- `GET /settings` — returns `AppSettings` JSON.
- `PATCH /settings` — accepts `SettingsUpdatePayload` JSON body, returns updated `AppSettings`.

These are needed because the Electron main process cannot use the WebSocket protocol, especially during shutdown when the renderer may be destroyed.

## Files Changed

| File | Change |
|---|---|
| `packages/shared/src/types/settings.ts` | Add `WindowSettings`, `PanelSettings`, `LayoutSettings`; add `layout` to `AppSettings` and `SettingsUpdatePayload` |
| `packages/backend/src/services/settings-store.ts` | Add `layout` defaults, merge logic |
| `packages/backend/src/index.ts` | Add HTTP `GET /settings` and `PATCH /settings` routes |
| `electron/src/main.ts` | Restore bounds on startup (with screen validation), save bounds on `before-quit`, track non-maximized bounds |
| `packages/ui/src/stores/ui-store.ts` | Add `hydrateLayout(panels)` method |
| `packages/ui/src/stores/settings-store.ts` | Hydrate ui-store after `fetchSettings()` |
| `packages/ui/src/components/AppShell.tsx` | Wire `onResizeEnd` to persist panel widths |
