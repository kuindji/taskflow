# Layout Persistence Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist window size/position and panel widths between app runs so the layout is restored on next launch.

**Architecture:** Extends the existing `SettingsStore` with a `layout` section containing `window` and `panels` sub-objects. Panel widths are saved from the UI via WebSocket on resize-end. Window bounds are saved/restored by the Electron main process via HTTP endpoints on the backend.

**Tech Stack:** TypeScript, Electron (`screen`, `BrowserWindow`), Zustand, Bun HTTP server

---

## File Map

| File | Role |
|---|---|
| `packages/shared/src/types/settings.ts` | Add `WindowSettings`, `PanelSettings`, `LayoutSettings` types; extend `AppSettings` and `SettingsUpdatePayload` |
| `packages/backend/src/services/settings-store.ts` | Add layout defaults, two-level deep merge in `get()` and `update()` |
| `packages/backend/tests/services/settings-store.test.ts` | Tests for layout defaults and nested merging |
| `packages/backend/src/api/routes.ts` | Add `settingsStore` to `ApiRouteDeps`, register `GET /api/settings` and `PATCH /api/settings` |
| `packages/backend/tests/api/routes.test.ts` | Tests for the new HTTP settings endpoints |
| `packages/backend/src/index.ts` | Pass `settingsStore` into `registerApiRoutes` |
| `packages/ui/src/stores/ui-store.ts` | Add `hydrateLayout()` method |
| `packages/ui/src/stores/settings-store.ts` | Call `hydrateLayout()` after `fetchSettings()` |
| `packages/ui/src/components/AppShell.tsx` | Wire `onResizeEnd` callbacks to persist panel widths |
| `electron/src/main.ts` | Restore window bounds on startup, save on `before-quit`, track non-maximized bounds |

---

## Task 1: Shared Types

**Files:**
- Modify: `packages/shared/src/types/settings.ts`

- [ ] **Step 1: Add layout types to settings.ts**

Add after the existing `EditorSettings` interface:

```typescript
export interface WindowSettings {
    x?: number;
    y?: number;
    width: number;
    height: number;
    isMaximized: boolean;
}

export interface PanelSettings {
    sidebarWidth: number;
    fileExplorerWidth: number;
    taskInfoWidth: number;
}

export interface LayoutSettings {
    window: WindowSettings;
    panels: PanelSettings;
}
```

These must be `export`ed because they appear in the exported `AppSettings` and `SettingsUpdatePayload` type signatures.

Add `layout: LayoutSettings` to `AppSettings`.

Update `SettingsUpdatePayload` to add:

```typescript
layout?: {
    window?: Partial<WindowSettings>;
    panels?: Partial<PanelSettings>;
};
```

- [ ] **Step 2: Verify types compile**

Run: `cd packages/shared && bun run build`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/types/settings.ts
git commit -m "Add layout types to AppSettings"
```

---

## Task 2: SettingsStore — Layout Defaults and Nested Merge

**Files:**
- Modify: `packages/backend/src/services/settings-store.ts`
- Modify: `packages/backend/tests/services/settings-store.test.ts`

- [ ] **Step 1: Write failing tests for layout defaults and nested merge**

Add these tests to the existing `describe("SettingsStore")` block in `packages/backend/tests/services/settings-store.test.ts`:

```typescript
it("returns layout defaults when no file exists", async () => {
    const settings = await store.get();
    expect(settings.layout).toEqual({
        window: { width: 1400, height: 900, isMaximized: false },
        panels: { sidebarWidth: 220, fileExplorerWidth: 220, taskInfoWidth: 220 },
    });
});

it("merges partial layout.window with defaults", async () => {
    await writeFile(
        settingsFile,
        JSON.stringify({
            layout: { window: { width: 1600, height: 1000 } },
        }),
    );

    const settings = await store.get();
    expect(settings.layout.window).toEqual({
        x: 0,
        y: 0,
        width: 1600,
        height: 1000,
        isMaximized: false,
    });
    // panels should still be defaults
    expect(settings.layout.panels).toEqual({
        sidebarWidth: 220,
        fileExplorerWidth: 220,
        taskInfoWidth: 220,
    });
});

it("updates layout.panels without clobbering layout.window", async () => {
    // Set initial window state
    await store.update({
        layout: { window: { x: 100, y: 200, width: 1600, height: 1000, isMaximized: false } },
    });

    // Update only panels
    const result = await store.update({
        layout: { panels: { sidebarWidth: 280 } },
    });

    expect(result.layout.window).toEqual({
        x: 100,
        y: 200,
        width: 1600,
        height: 1000,
        isMaximized: false,
    });
    expect(result.layout.panels).toEqual({
        sidebarWidth: 280,
        fileExplorerWidth: 220,
        taskInfoWidth: 220,
    });
});

it("updates individual window fields without clobbering others", async () => {
    await store.update({
        layout: { window: { x: 50, y: 75, width: 1200, height: 800, isMaximized: false } },
    });

    const result = await store.update({
        layout: { window: { isMaximized: true } },
    });

    expect(result.layout.window).toEqual({
        x: 50,
        y: 75,
        width: 1200,
        height: 800,
        isMaximized: true,
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/backend && bun test tests/services/settings-store.test.ts`
Expected: FAIL — `settings.layout` is undefined

- [ ] **Step 3: Add layout defaults and two-level merge to SettingsStore**

In `packages/backend/src/services/settings-store.ts`:

Add layout to `DEFAULTS`:

```typescript
const DEFAULTS: AppSettings = {
    general: { ... },  // existing
    terminal: { ... }, // existing
    editor: { ... },   // existing
    layout: {
        window: { width: 1400, height: 900, isMaximized: false },
        panels: { sidebarWidth: 220, fileExplorerWidth: 220, taskInfoWidth: 220 },
    },
};
```

Update `createDefaultSettings()` to include `layout`:

```typescript
function createDefaultSettings(): AppSettings {
    return {
        general: { ...DEFAULTS.general },
        terminal: { ...DEFAULTS.terminal },
        editor: { ...DEFAULTS.editor },
        layout: {
            window: { ...DEFAULTS.layout.window },
            panels: { ...DEFAULTS.layout.panels },
        },
    };
}
```

Update `get()` to do two-level merge for layout:

```typescript
async get(): Promise<AppSettings> {
    try {
        const raw = await readFile(this.filePath, "utf-8");
        const parsed = JSON.parse(raw) as Partial<AppSettings>;
        const defaults = createDefaultSettings();
        return {
            general: { ...defaults.general, ...parsed.general },
            terminal: { ...defaults.terminal, ...parsed.terminal },
            editor: { ...defaults.editor, ...parsed.editor },
            layout: {
                window: { ...defaults.layout.window, ...parsed.layout?.window },
                panels: { ...defaults.layout.panels, ...parsed.layout?.panels },
            },
        };
    } catch {
        return createDefaultSettings();
    }
}
```

Update `update()` to do two-level merge for layout:

```typescript
async update(partial: SettingsUpdatePayload): Promise<AppSettings> {
    const current = await this.get();
    if (partial.general) {
        Object.assign(current.general, partial.general);
    }
    if (partial.terminal) {
        Object.assign(current.terminal, partial.terminal);
    }
    if (partial.editor) {
        Object.assign(current.editor, partial.editor);
    }
    if (partial.layout?.window) {
        Object.assign(current.layout.window, partial.layout.window);
    }
    if (partial.layout?.panels) {
        Object.assign(current.layout.panels, partial.layout.panels);
    }
    await writeFile(this.filePath, JSON.stringify(current, null, 2));
    return current;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/backend && bun test tests/services/settings-store.test.ts`
Expected: All pass

- [ ] **Step 5: Update existing tests to include layout in expected output**

Both existing tests do `toEqual` on the full `AppSettings` and will fail without `layout`. Add the layout block to every `toEqual` assertion on `AppSettings`.

In the "returns fresh defaults including editor settings" test, there are two `toEqual` assertions (the initial get and the mutation-guard get). Add to both:

```typescript
layout: {
    window: { width: 1400, height: 900, isMaximized: false },
    panels: { sidebarWidth: 220, fileExplorerWidth: 220, taskInfoWidth: 220 },
},
```

In the "merges persisted and partial editor updates" test, there are three `toEqual` assertions (the get after writeFile, the update result, and none others). Add the same layout block to each, since the test file only contains `general` and `editor` overrides — layout should be defaults throughout.

- [ ] **Step 6: Run full test suite to confirm nothing broke**

Run: `cd packages/backend && bun test tests/services/settings-store.test.ts`
Expected: All pass

- [ ] **Step 7: Commit**

```bash
git add packages/backend/src/services/settings-store.ts packages/backend/tests/services/settings-store.test.ts
git commit -m "Add layout defaults and nested merge to SettingsStore"
```

---

## Task 3: HTTP Settings Endpoints

**Files:**
- Modify: `packages/backend/src/api/routes.ts`
- Modify: `packages/backend/src/index.ts`
- Modify: `packages/backend/tests/api/routes.test.ts`

- [ ] **Step 1: Write failing tests for GET and PATCH /api/settings**

Add to `packages/backend/tests/api/routes.test.ts`. The test setup needs a real `SettingsStore` (it writes to a temp file). Add imports and setup:

```typescript
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { SettingsStore } from "../../src/services/settings-store";
```

Add a new `describe` block for settings routes:

```typescript
describe("settings routes", () => {
    let apiRouter: ApiRouter;
    let tempDir: string;
    let settingsStore: SettingsStore;

    beforeEach(async () => {
        tempDir = await mkdtemp(join(tmpdir(), "taskflow-api-settings-"));
        settingsStore = new SettingsStore(join(tempDir, "settings.json"));
        apiRouter = new ApiRouter();
        registerApiRoutes({
            apiRouter,
            taskStore: {} as never,
            ptyManager: new FakePtyManager() as never,
            broadcast: () => {},
            settingsStore,
        });
    });

    afterEach(async () => {
        await rm(tempDir, { recursive: true, force: true });
    });

    it("GET /api/settings returns defaults", async () => {
        const response = await apiRouter.handle(
            new Request("http://localhost/api/settings", { method: "GET" }),
        );
        expect(response?.status).toBe(200);
        const body = await response!.json();
        expect(body.layout.window.width).toBe(1400);
        expect(body.layout.panels.sidebarWidth).toBe(220);
    });

    it("PATCH /api/settings updates and returns full settings", async () => {
        const response = await apiRouter.handle(
            new Request("http://localhost/api/settings", {
                method: "PATCH",
                body: JSON.stringify({
                    layout: { window: { width: 1600, height: 1000 } },
                }),
                headers: { "Content-Type": "application/json" },
            }),
        );
        expect(response?.status).toBe(200);
        const body = await response!.json();
        expect(body.layout.window.width).toBe(1600);
        expect(body.layout.window.height).toBe(1000);
        // Defaults preserved
        expect(body.layout.window.isMaximized).toBe(false);
    });

    it("PATCH /api/settings rejects invalid JSON", async () => {
        const response = await apiRouter.handle(
            new Request("http://localhost/api/settings", {
                method: "PATCH",
                body: "not json",
                headers: { "Content-Type": "application/json" },
            }),
        );
        expect(response?.status).toBe(400);
    });
});
```

- [ ] **Step 2: Update existing test setup to include settingsStore**

The existing `describe("api routes")` block calls `registerApiRoutes` without `settingsStore`. After we add it to `ApiRouteDeps`, the existing tests will fail. Update the existing `beforeEach` to pass a dummy `settingsStore`:

```typescript
import { SettingsStore } from "../../src/services/settings-store";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
```

In the existing `describe("api routes")`:

```typescript
let tempDir: string;

beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "taskflow-api-routes-"));
    apiRouter = new ApiRouter();
    events = [];
    registerApiRoutes({
        apiRouter,
        taskStore: {} as never,
        ptyManager: new FakePtyManager(new Set(["session-1"])) as never,
        broadcast: (event) => {
            events.push(event);
        },
        settingsStore: new SettingsStore(join(tempDir, "settings.json")),
    });
});

afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd packages/backend && bun test tests/api/routes.test.ts`
Expected: FAIL — `settingsStore` not in `ApiRouteDeps`, routes not registered

- [ ] **Step 4: Add settingsStore to ApiRouteDeps and register routes**

In `packages/backend/src/api/routes.ts`:

Add import:
```typescript
import type { SettingsStore } from "../services/settings-store";
import type { SettingsUpdatePayload } from "@taskflow/shared";
```

Add `settingsStore` to `ApiRouteDeps`:
```typescript
interface ApiRouteDeps {
    apiRouter: ApiRouter;
    taskStore: TaskStore;
    ptyManager: PtyManager;
    broadcast: (event: WsEvent) => void;
    settingsStore: SettingsStore;
}
```

Add to the destructuring:
```typescript
const { apiRouter, taskStore, ptyManager, broadcast, settingsStore } = deps;
```

Register the two routes at the end of `registerApiRoutes`:

```typescript
apiRouter.register("GET", "/api/settings", async () => {
    return jsonResponse(await settingsStore.get());
});

apiRouter.register("PATCH", "/api/settings", async (req) => {
    let body: SettingsUpdatePayload;
    try {
        body = (await req.json()) as SettingsUpdatePayload;
    } catch {
        return errorResponse("Invalid JSON body", 400);
    }
    return jsonResponse(await settingsStore.update(body));
});
```

- [ ] **Step 5: Pass settingsStore in index.ts**

In `packages/backend/src/index.ts`, update the `registerApiRoutes` call (around line 84):

```typescript
registerApiRoutes({
    apiRouter,
    taskStore: store,
    ptyManager,
    broadcast: server.broadcast,
    settingsStore,
});
```

(The `settingsStore` variable is already created at line 82.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd packages/backend && bun test tests/api/routes.test.ts`
Expected: All pass

- [ ] **Step 7: Commit**

```bash
git add packages/backend/src/api/routes.ts packages/backend/src/index.ts packages/backend/tests/api/routes.test.ts
git commit -m "Add HTTP settings endpoints for Electron layout persistence"
```

---

## Task 4: UI — Hydrate Panel Widths on Startup

**Files:**
- Modify: `packages/ui/src/stores/ui-store.ts`
- Modify: `packages/ui/src/stores/settings-store.ts`

- [ ] **Step 1: Add hydrateLayout to ui-store**

In `packages/ui/src/stores/ui-store.ts`, add to the `UIStore` interface:

```typescript
hydrateLayout(panels: { sidebarWidth?: number; fileExplorerWidth?: number; taskInfoWidth?: number }): void;
```

Add the clamp constants at the top of the file (these match `AppShell.tsx`):

```typescript
const SIDEBAR_MIN = 180;
const SIDEBAR_MAX = 350;
const FILE_EXPLORER_MIN = 150;
const FILE_EXPLORER_MAX = 500;
const TASK_INFO_MIN = 150;
const TASK_INFO_MAX = 500;

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}
```

Add the implementation in the `create` call:

```typescript
hydrateLayout(panels) {
    set({
        sidebarWidth: clamp(panels.sidebarWidth ?? 220, SIDEBAR_MIN, SIDEBAR_MAX),
        fileExplorerWidth: clamp(panels.fileExplorerWidth ?? 220, FILE_EXPLORER_MIN, FILE_EXPLORER_MAX),
        taskInfoWidth: clamp(panels.taskInfoWidth ?? 220, TASK_INFO_MIN, TASK_INFO_MAX),
    });
},
```

The constants and `clamp` are duplicated between `ui-store.ts` and `AppShell.tsx`. This is intentional — both files are small and the constants are simple literals. Extracting them to a shared file would add a file for 7 constants, which isn't worth it. `AppShell.tsx` keeps its own copies unchanged.

- [ ] **Step 2: Call hydrateLayout from settings-store after fetchSettings**

In `packages/ui/src/stores/settings-store.ts`, add import:

```typescript
import { useUIStore } from "./ui-store";
```

Update `fetchSettings()`:

```typescript
async fetchSettings() {
    const settings = await sendRequest<AppSettings>(MSG.SETTINGS_GET);
    set({ settings });
    if (settings.layout?.panels) {
        useUIStore.getState().hydrateLayout(settings.layout.panels);
    }
},
```

- [ ] **Step 3: Verify it compiles**

Run: `cd packages/ui && bun run build`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/stores/ui-store.ts packages/ui/src/stores/settings-store.ts
git commit -m "Hydrate panel widths from settings on startup"
```

---

## Task 5: UI — Persist Panel Widths on Resize End

**Files:**
- Modify: `packages/ui/src/components/AppShell.tsx`

- [ ] **Step 1: Wire onResizeEnd to save panel widths**

In `packages/ui/src/components/AppShell.tsx`, add import:

```typescript
import { useSettingsStore } from "@/stores/settings-store";
```

Add a callback that reads current panel widths and persists them:

```typescript
const updateSettings = useSettingsStore((s) => s.updateSettings);

const handleResizeEnd = useCallback(() => {
    const { sidebarWidth, fileExplorerWidth, taskInfoWidth } = useUIStore.getState();
    void updateSettings({
        layout: { panels: { sidebarWidth, fileExplorerWidth, taskInfoWidth } },
    });
}, [updateSettings]);
```

Pass `onResizeEnd={handleResizeEnd}` to all three `<ResizeHandle>` components. Replace the existing JSX for each handle, e.g.:

```tsx
<ResizeHandle onResize={handleSidebarResize} onResizeEnd={handleResizeEnd} panelGap={panelGap} />
```

- [ ] **Step 2: Verify it compiles**

Run: `cd packages/ui && bun run build`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/components/AppShell.tsx
git commit -m "Persist panel widths to settings on resize end"
```

---

## Task 6: Electron — Restore and Save Window Bounds

**Files:**
- Modify: `electron/src/main.ts`

- [ ] **Step 1: Add window bounds restoration to createWindow**

In `electron/src/main.ts`, add import:

```typescript
import { screen } from "electron";
```

Add a type and helper function before `createWindow()`:

Note: We define a local interface here rather than importing `WindowSettings` from `@taskflow/shared` to keep the Electron build lean (no shared package dependency in main process).

```typescript
interface SavedWindowBounds {
    x?: number;
    y?: number;
    width: number;
    height: number;
    isMaximized: boolean;
}

async function fetchSavedLayout(): Promise<SavedWindowBounds | null> {
    if (!backendPort) return null;
    try {
        const res = await fetch(`http://127.0.0.1:${backendPort}/api/settings`);
        if (!res.ok) return null;
        const settings = (await res.json()) as { layout?: { window?: SavedWindowBounds } };
        return settings.layout?.window ?? null;
    } catch {
        return null;
    }
}

function validateBounds(
    bounds: SavedWindowBounds,
): { x: number; y: number; width: number; height: number } | null {
    if (bounds.x == null || bounds.y == null) return null;
    const width = Math.max(bounds.width, 800);
    const height = Math.max(bounds.height, 600);
    const rect = { x: bounds.x, y: bounds.y, width, height };
    const display = screen.getDisplayMatching(rect);
    const { x: dx, y: dy, width: dw, height: dh } = display.workArea;

    // Require at least 100px overlap in each dimension
    const overlapX = Math.min(rect.x + rect.width, dx + dw) - Math.max(rect.x, dx);
    const overlapY = Math.min(rect.y + rect.height, dy + dh) - Math.max(rect.y, dy);
    if (overlapX < 100 || overlapY < 100) return null;

    return rect;
}
```

Change `createWindow()` to be `async` and use saved bounds:

```typescript
async function createWindow() {
    const appPath = app.getAppPath();
    const saved = await fetchSavedLayout();
    const validBounds = saved ? validateBounds(saved) : null;

    const windowOptions: Electron.BrowserWindowConstructorOptions = {
        width: validBounds?.width ?? 1400,
        height: validBounds?.height ?? 900,
        ...(validBounds ? { x: validBounds.x, y: validBounds.y } : {}),
        minWidth: 800,
        minHeight: 600,
        titleBarStyle: "hiddenInset",
        backgroundColor: "#1e1e2e",
        webPreferences: {
            preload: join(appPath, "dist", "preload.js"),
            contextIsolation: true,
            nodeIntegration: false,
            webviewTag: true,
        },
    };

    mainWindow = new BrowserWindow(windowOptions);

    if (saved?.isMaximized) {
        mainWindow.maximize();
    }

    // Track non-maximized bounds for save-on-quit
    let lastNonMaximizedBounds = mainWindow.getBounds();
    mainWindow.on("moved", () => {
        if (mainWindow && !mainWindow.isMaximized()) {
            lastNonMaximizedBounds = mainWindow.getBounds();
        }
    });
    mainWindow.on("resize", () => {
        if (mainWindow && !mainWindow.isMaximized()) {
            lastNonMaximizedBounds = mainWindow.getBounds();
        }
    });

    // Save bounds before quit
    mainWindow.on("close", () => {
        if (!mainWindow || !backendPort) return;
        const isMaximized = mainWindow.isMaximized();
        const bounds = isMaximized ? lastNonMaximizedBounds : mainWindow.getBounds();
        const payload = {
            layout: {
                window: {
                    x: bounds.x,
                    y: bounds.y,
                    width: bounds.width,
                    height: bounds.height,
                    isMaximized,
                },
            },
        };
        // Fire-and-forget with short timeout — we await this in before-quit
        windowSavePromise = fetch(`http://127.0.0.1:${backendPort}/api/settings`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(1000),
        }).catch(() => {});
    });

    if (UI_DEV_SERVER_URL) {
        void mainWindow.loadURL(UI_DEV_SERVER_URL);
    } else {
        void mainWindow.loadFile(getUIPath());
    }

    mainWindow.on("closed", () => {
        mainWindow = null;
    });
}
```

Add `windowSavePromise` at the module level alongside the other `let` declarations:

```typescript
let windowSavePromise: Promise<void | Response> | null = null;
```

- [ ] **Step 2: Update shutdown sequence to await save**

Add a `quitting` flag at the module level alongside the other `let` declarations:

```typescript
let quitting = false;
```

Replace the `before-quit` handler with a guarded pattern that properly awaits the save using `.then()` (not `async/await`, because Electron does not await event handler return values and `e.preventDefault()` must be synchronous):

```typescript
app.on("before-quit", (e) => {
    if (quitting) return;
    if (windowSavePromise) {
        quitting = true;
        e.preventDefault();
        windowSavePromise.then(() => {
            windowSavePromise = null;
            if (backendProcess) {
                backendProcess.kill();
                backendProcess = null;
            }
            void cleanupBackendArtifacts();
            app.quit();
        });
        return;
    }
    if (backendProcess) {
        backendProcess.kill();
        backendProcess = null;
    }
    void cleanupBackendArtifacts();
});
```

Remove the backend kill from `window-all-closed` to avoid double-kill. The `before-quit` handler (which fires first) handles it:

```typescript
app.on("window-all-closed", () => {
    app.quit();
});
```

Update the `app.whenReady` block since `createWindow` is now async:

```typescript
void app.whenReady().then(async () => {
    try {
        backendPort = await startBackend();
        console.log(`Backend started on port ${backendPort}`);
        await createWindow();
        buildAppMenu();
        setupAutoUpdater();
    } catch (err) {
        console.error("Failed to start backend:", err);
        app.quit();
    }
});
```

- [ ] **Step 3: Verify Electron builds**

Run: `cd electron && bun run build`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add electron/src/main.ts
git commit -m "Restore and save window bounds between app runs"
```

---

## Task 7: Integration Verification

- [ ] **Step 1: Run full backend test suite**

Run: `cd packages/backend && bun test`
Expected: All pass

- [ ] **Step 2: Build all packages**

Run: `bun run build` (or equivalent from project root)
Expected: No errors

- [ ] **Step 3: Manual smoke test**

1. Launch the app
2. Resize the window and move it to a specific position
3. Resize sidebar and other panels
4. Quit the app
5. Relaunch — verify window position/size and panel widths are restored
6. Maximize the window, quit, relaunch — verify it opens maximized
7. While maximized, quit, relaunch, un-maximize — verify it restores to the pre-maximized size

- [ ] **Step 4: Final commit if any fixes needed**
