# Layout Persistence Design

Persist window size/position and panel widths between app runs using the existing `SettingsStore` infrastructure.

## Data Model

Add a `layout` section to `AppSettings`:

```typescript
interface WindowSettings {
    x?: number;
    y?: number;
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

`LayoutSettings` is added to `AppSettings` as `layout`. `SettingsUpdatePayload` gets:

```typescript
layout?: {
    window?: Partial<WindowSettings>;
    panels?: Partial<PanelSettings>;
};
```

This allows partial updates to individual fields within `window` or `panels` (e.g., updating only `width` without supplying all window fields).

`panelGap` is excluded — it's a fixed UI constant, not a user preference.

Panel open/closed state (`fileExplorerOpen`, `taskInfoOpen`) is excluded — these are ephemeral session state, not layout preferences.

## Save Flow

### Panel Widths

`AppShell` wires the existing `onResizeEnd` callback on each `ResizeHandle`. On mouse-up, it calls `settingsStore.updateSettings({ layout: { panels: { sidebarWidth, fileExplorerWidth, taskInfoWidth } } })` with current values from `ui-store`. Natural debounce — only fires on mouse-up.

### Window Bounds

On `before-quit`, the Electron main process:
1. Reads `mainWindow.isMaximized()`.
2. If not maximized, reads `mainWindow.getBounds()` → `{ x, y, width, height }`.
3. If maximized, uses the last non-maximized bounds (tracked via `moved`/`will-resize` events, which fire once after the operation, only stored when `isMaximized()` is false) so that un-maximizing restores the right size.
4. Makes an HTTP `PATCH /api/settings` to the backend with the window layout.
5. **Awaits the response before killing the backend.** The shutdown sequence must be: save layout → await response (with a short timeout, e.g. 1s) → kill backend → quit. If the PATCH times out, proceed with shutdown anyway (layout state is best-effort).

## Restore Flow

### Window Bounds

In `createWindow()`, before constructing `BrowserWindow`:
1. HTTP `GET /api/settings` from the backend.
2. Clamp restored `width`/`height` against `minWidth`/`minHeight` (800x600) and the available display bounds.
3. If `layout.window` exists and has `x`/`y`, validate the position is on a connected display using Electron's `screen.getDisplayMatching()` (imported from `electron`, only usable after `app.whenReady()`). Require a meaningful overlap (at least 100px in each dimension) — if the window is mostly off-screen, fall back to defaults.
4. If `isMaximized`, create the window at saved size/position, then call `mainWindow.maximize()` after creation.
5. Falls back to `1400x900`, centered, if no saved state.

### Panel Widths

The UI already calls `fetchSettings()` on startup. After fetching, hydrate `ui-store` with `layout.panels` values via a new `hydrateLayout(panels)` method. This sets `sidebarWidth`, `fileExplorerWidth`, `taskInfoWidth` in one call. The hydration clamps values to the min/max ranges defined in `AppShell` to guard against stale or hand-edited settings.

The hydration is called inside `fetchSettings()` in the settings store for simplicity — it reads the fetched layout and calls `useUIStore.getState().hydrateLayout(panels)` directly.

## Backend Changes

### SettingsStore

Add `layout` to defaults in `createDefaultSettings()` and merge logic in `get()` and `update()`. The merge for `layout` must be two-level deep: merge `window` fields separately from `panels` fields (unlike the existing flat sections which use single-level `Object.assign`).

In `get()`:
```typescript
layout: {
    window: { ...defaults.layout.window, ...parsed.layout?.window },
    panels: { ...defaults.layout.panels, ...parsed.layout?.panels },
}
```

In `update()`:
```typescript
if (partial.layout?.window) {
    Object.assign(current.layout.window, partial.layout.window);
}
if (partial.layout?.panels) {
    Object.assign(current.layout.panels, partial.layout.panels);
}
```

### HTTP Settings Endpoint

Expose on the existing HTTP server under the `/api/` prefix (consistent with existing routes):
- `GET /api/settings` — returns `AppSettings` JSON.
- `PATCH /api/settings` — accepts `SettingsUpdatePayload` JSON body, returns updated `AppSettings`.

These are needed because the Electron main process cannot use the WebSocket protocol, especially during shutdown when the renderer may be destroyed.

The routes are added in `packages/backend/src/api/routes.ts` by adding `settingsStore` to `ApiRouteDeps`.

## Files Changed

| File | Change |
|---|---|
| `packages/shared/src/types/settings.ts` | Add `WindowSettings`, `PanelSettings`, `LayoutSettings`; add `layout` to `AppSettings` and `SettingsUpdatePayload` |
| `packages/backend/src/services/settings-store.ts` | Add `layout` defaults, merge logic |
| `packages/backend/src/api/routes.ts` | Add `settingsStore` to `ApiRouteDeps`, add `GET /api/settings` and `PATCH /api/settings` routes |
| `packages/backend/src/index.ts` | Pass `settingsStore` to `registerApiRoutes` |
| `electron/src/main.ts` | Restore bounds on startup (with screen validation), save bounds on `before-quit` (await before killing backend), track non-maximized bounds via `resize`/`move` events |
| `packages/ui/src/stores/ui-store.ts` | Add `hydrateLayout(panels)` method |
| `packages/ui/src/stores/settings-store.ts` | Hydrate ui-store after `fetchSettings()` |
| `packages/ui/src/components/AppShell.tsx` | Wire `onResizeEnd` to persist panel widths |
