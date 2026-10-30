# Agent-Drivable Internal Browser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agents open a browser tab inside Taskflow through `taskflow-cli` and drive it with standard CDP clients (Playwright, Puppeteer). The tab keeps running while the user is elsewhere in the app.

**Architecture:**
- **Tabs:** Electron's main process owns every browser tab as a `WebContentsView` in partition `persist:browser`, with Chromium remote debugging on a random loopback port.
- **Registry:** the backend owns the saved tab registry. It learns about the host through an HTTP heartbeat and drives it through main's loopback control server.
- **Agent access:** each tab gets a CDP endpoint on the backend origin (`/cdp/<tabId>`). There a filtering proxy exposes only that tab and its children.
- **Renderer:** draws a placeholder. Main positions the native view over it while it's visible.

**Tech Stack:** Bun, TypeScript, Electron 33 (`WebContentsView`, `webContents.debugger`, Node `http`), React 19 + zustand, POSIX sh, bun:test (happy-dom preload for UI tests), Playwright and Puppeteer (spike and manual checks only, not runtime dependencies).

**Spec:** `docs/superpowers/specs/2026-10-30-agent-browser-cdp-design.md`, including its "Amendments" section. Read it before starting any section.

## How this plan is laid out

Each section is a separate file in `2026-10-30-agent-browser/`, written so it can be implemented in a fresh session.
1. Before starting a section, read `2026-10-30-agent-browser/handoff.md` (status and facts carried between sections), then the section file and the spec.
2. When a section is done, update the handoff.

The chain protocol is in `2026-10-30-agent-browser/chain.md`.

| # | Section | File | Depends on |
|---|---|---|---|
| 1 | Spike: prove hosting and the filtered CDP endpoint. **Gate.** | `01-spike.md` | — |
| 2 | Shared types, `BrowserTabStore`, `BrowserTabService`, host client | `02-backend-registry.md` | 1 |
| 3 | HTTP and WS API, wiring, task/project cleanup hooks | `03-backend-api.md` | 2 |
| 4 | CDP gateway: filter, `/cdp` HTTP and WS endpoints | `04-cdp-gateway.md` | 2, 3 |
| 5 | Electron host: views, control server, heartbeat, renderer IPC | `05-electron-host.md` | 1, 3 |
| 6 | UI: registry-backed tabs, hosted pane, overlays, fallback | `06-ui.md` | 3, 5 |
| 7 | CLI (sh + TS bin), command doc, prompt nudge | `07-cli-prompt.md` | 3 |
| 8 | Manual end-to-end verification, final review | `08-verify.md` | all |

Sections 4, 5 and 7 are independent of each other once 3 is done. Section 6 needs 5's IPC.

**Gate after Section 1.** The spike decides facts the later sections depend on. They are listed at the end of `01-spike.md`, and the spike session records them in `handoff.md`.
- **All spike criteria pass:** continue as written.
- **Any criterion fails:** stop the chain and notify the user. The plan gets revised before any product code is written.

## Cross-section interfaces (fixed; every section uses these exact names)

### Shared (`packages/shared/src/types/browser-tab.ts`, re-exported like `dev-server.ts`)

```ts
export type BrowserTabScope =
    | { kind: "task"; taskId: string }
    | { kind: "project"; projectId: string }
    | { kind: "master" };

export interface BrowserTab {
    id: string;
    scope: BrowserTabScope;
    label: string;
    url: string;              // last known URL
    title?: string;           // last known document title
    parentId?: string;        // popups and agent-created pages; such tabs are never saved
    createdAt: string;        // ISO
    loaded: boolean;          // runtime: the host has a live view for it
    agentConnections: number; // runtime: open CDP connections
}

export interface BrowserTabListResponse {
    tabs: BrowserTab[];
    hostAvailable: boolean;
}
export interface BrowserTabOpenPayload { scope: BrowserTabScope; url: string; label?: string }
export interface BrowserTabClosePayload { id: string }

/** Host → backend heartbeat body (PUT /api/browser/host). */
export interface BrowserHostHeartbeat {
    controlUrl: string;       // http://127.0.0.1:<port>, main's control server
    debugPort: number;        // Chromium remote debugging port
    loaded: { tabId: string; targetId: string; url: string; title?: string; parentId?: string }[];
        // url/title also reconcile the registry; parentId lets the backend re-adopt live children it doesn't know
    appTargetIds: string[];   // targets that are not browser tabs (the main window's renderer); always denied
}

/** Host → backend events (POST /api/browser/host/events). */
export type BrowserHostEvent =
    | { type: "navigated"; tabId: string; url: string; title?: string }
    | { type: "child-opened"; tabId: string; parentId: string; url: string; targetId: string }
    | { type: "closed"; tabId: string };
```

`MSG` (`packages/shared/src/constants.ts`). `BROWSER_OPEN` is **removed** together with its handler, routes and UI listener, in Section 7 (with the CLI that uses them).
- `BROWSER_TABS_LIST: "browser:tabs:list"`
  - As a WS request: `{}` → `BrowserTabListResponse`.
  - As a broadcast: the same payload, full list.
- `BROWSER_TAB_OPEN: "browser:tab:open"`: WS request `BrowserTabOpenPayload` → `BrowserTab`.
- `BROWSER_TAB_CLOSE: "browser:tab:close"`: WS request `BrowserTabClosePayload` → `{ success: true }`.

### Backend services (Section 2 produces; 3 and 4 consume)

`services/browser-tab-store.ts`. It follows `DevServerStore`'s file pattern and saves only tabs without `parentId`, and only the fields `id`, `scope`, `label`, `url`, `title`, `createdAt`.

```ts
class BrowserTabStore {
    constructor(filePath: string);
    list(): Promise<SavedBrowserTab[]>;
    put(tab: SavedBrowserTab): Promise<void>;   // insert or replace by id
    remove(id: string): Promise<boolean>;
}
type SavedBrowserTab = Pick<BrowserTab, "id" | "scope" | "label" | "url" | "title" | "createdAt">;
```

`services/browser-host-client.ts`. This is backend → host HTTP, with a 10 s timeout per call. Any failure throws `BrowserHostUnavailableError`.

```ts
interface BrowserHostClient {
    ensure(controlUrl: string, req: { tabId: string; url: string; parentId?: string }): Promise<{ targetId: string }>;
    close(controlUrl: string, tabId: string): Promise<void>;
}
function createBrowserHostClient(): BrowserHostClient;
```

Main's control server answers these two routes: `POST /tabs/ensure` (body `{ tabId, url, parentId? }`, returns `{ targetId }`) and `POST /tabs/close` (body `{ tabId }`, returns `{ ok: true }`).

`services/browser-tab-service.ts`:

```ts
interface BrowserTabService {
    list(filter?: { scope?: BrowserTabScope }): BrowserTabListResponse; // runtime fields included
    get(id: string): BrowserTab | null;
    open(input: { scope: BrowserTabScope; url: string; label?: string }): Promise<BrowserTab>;
        // requires a live host; ensures the view; throws BrowserHostUnavailableError
    openChild(parentId: string, url: string): Promise<{ tab: BrowserTab; targetId: string }>;
    close(id: string): Promise<boolean>;            // closes children too; tells the host when live
    closeForOwner(owner: { taskId: string } | { projectId: string }): Promise<void>;
    ensureLoaded(id: string): Promise<{ targetId: string; debugPort: number }>;
    resolveTarget(targetId: string, opts?: { waitMs?: number }): Promise<{ tabId: string } | null>;
        // null = not a browser tab (app target, or unknown after waitMs, default 2000)
    tabIdForTarget(targetId: string): string | null;
    familyOf(rootTabId: string): Set<string>;       // root + descendants by parentId
    addAgentConnection(id: string, delta: 1 | -1): void;
    hostHeartbeat(hb: BrowserHostHeartbeat): void;
    hostEvent(ev: BrowserHostEvent): Promise<void>;
    hostAvailable(): boolean;
    subscribeTabGone(cb: (tabId: string) => void): () => void; // closed, removed, or view lost
    init(): Promise<void>; // load saved tabs, drop tabs whose task is archived or missing
}
function createBrowserTabService(deps: {
    store: BrowserTabStore;
    hostClient: BrowserHostClient;
    broadcast: (event: WsEvent) => void;
    isOwnerActive: (scope: BrowserTabScope) => Promise<boolean>;
    now?: () => number; // injectable clock for the 15 s staleness
    schedule?: (fn: () => void, ms: number) => () => void; // returns cancel
}): BrowserTabService;
```

Errors live in `services/browser-tab-errors.ts` (Section 2, Task 2.2), imported by the client, the service, the routes and the gateway:

```ts
class BrowserHostUnavailableError extends Error {}
class BrowserTabInputError extends Error {}
class BrowserTabNotFoundError extends Error {}
```

Every change visible in `list()` broadcasts `{ type: MSG.BROWSER_TABS_LIST, payload: list() }`. That includes runtime fields and host availability flips.

### HTTP (Section 3 produces; 5 and 7 consume)

- **`POST /api/browser/tabs`**
  - Body: `{ url, label?, scope?: "task" | "project" | "master" }`.
  - The scope id comes from the `x-taskflow-task-id` and `x-taskflow-project-id` headers, by the Amendment 4 fallback, unless `scope` forces one.
  - Responses:
    - 201 with `{ tab: BrowserTab, endpoint: string }`;
    - 400 `{ error }` (`BrowserTabInputError`);
    - 503 `{ error }` (`BrowserHostUnavailableError`).
- **`GET /api/browser/tabs?scope=task|project|master`**: the same header rules; the response is `{ tabs: (BrowserTab & { endpoint: string })[], hostAvailable }`.
- **`DELETE /api/browser/tabs/:id`**: 200 `{ success: true }`; 404 `{ error: "Browser tab not found" }`.
- **`PUT /api/browser/host`**: body `BrowserHostHeartbeat`; 200 `{ ok: true }`.
- **`POST /api/browser/host/events`**: body `BrowserHostEvent`; 200 `{ ok: true }`.

`endpoint` = `<request origin>/cdp/<tabId>`, built from the request's `Host` header, for example `http://127.0.0.1:7123/cdp/<tabId>`.

### CDP gateway (Section 4)

- `GET /cdp/:tabId/json/version`, plus the trailing-slash variant. It returns Chromium's real `/json/version` fields, with `webSocketDebuggerUrl` rewritten to `ws://<Host>/cdp/<tabId>/devtools/browser`.
- `GET /cdp/:tabId/json/list` and `/cdp/:tabId/json`: the tab family's page targets only, with the same rewriting.
- WS upgrade on `/cdp/:tabId/devtools/browser`: a filtered browser-level session.
- The whole `/cdp/` namespace is reserved. Any other `/cdp/...` request (HTTP or upgrade) gets 404 and is never upgraded to an app socket. Paths outside `/cdp/` keep today's behaviour.

### Electron renderer bridge (Section 5 produces; 6 consumes)

These go on `window.taskflow.browser` (preload) and are typed in `packages/ui/src/env.d.ts`.

```ts
interface TaskflowBrowserBridge {
    show(tabId: string, url: string, bounds: { x: number; y: number; width: number; height: number }): Promise<void>;
    hide(tabId: string): Promise<void>;
    navigate(tabId: string, url: string): Promise<void>;
    back(tabId: string): Promise<void>;
    forward(tabId: string): Promise<void>;
    reload(tabId: string): Promise<void>;
    freeze(tabId: string): Promise<string>; // PNG data URL of the page; the view is hidden until the next show()
    onNavState(cb: (tabId: string, s: { canGoBack: boolean; canGoForward: boolean }) => void): () => void;
}
```

## Global Constraints

- **Tooling:** use `bun` for everything, never npm or yarn. Run UI tests **from the repo root** (`bun test packages/ui/...`) and one file at a time, because `mock.module` leaks across files.
- **TypeScript:** no `as any` and no eslint-disable comments. Don't export anything nothing imports. Reuse existing types before adding new ones.
- **Commits:** conventional prefix (`feat(shared):`, `feat(backend):`, `feat(electron):`, `feat(cli):`, `feat(ui):`, `test:`, `docs:`). **No `Co-Authored-By` trailer** (project and user CLAUDE.md).
- **Branching:** work on `main`. No branches or worktrees.
- **Formatting:** `bun run format` rewrites the whole repo, so never run it. Use `bunx prettier --write <files>` on changed files only.
- **CLI:** `taskflow-cli` has two implementations, the POSIX script (macOS/Linux) and the TS bin (Windows). Both change identically.
- **Tests:** new tests must not use `mock.module`. Inject dependencies instead.
- **No new runtime dependencies** in `electron/` or `packages/backend`. Playwright and Puppeteer may be used only by the spike and by manual checks, run with `bunx`/`uvx` or a scratch install outside the workspace.
- **Loopback only:** the control server, the debugging port and the CDP gateway bind `127.0.0.1`. The raw debugging port is never printed to agents or documented.
- **Partition:** `persist:browser` for every hosted tab. Keep the `navigator.webdriver` preload (`electron/src/browser-preload.ts`) and the Chrome-like user agent (today computed in `BrowserPane.tsx`; it moves to main).
- **Hidden tabs:** `backgroundThrottling: false`. A tab never shown renders at 1280×800.
- **Timings:** heartbeat every 5000 ms; host stale after 15000 ms; `resolveTarget` waits at most 2000 ms; host client timeout 10000 ms.
- **Error strings** (exact; shown to agents and users):
  - `Browser not available on this machine: the Taskflow desktop app must be running here`
  - `Browser tab not found`
  - `Field 'url' is required and must be a non-empty string`
  - `Missing scope: no task, project or master context` (only when `scope` names a kind whose header is missing)
  - `Not allowed by Taskflow: <method>` (CDP error, code `-32000`)
- **Prompt nudge** (exact text, appended to `PROMPT_BASE` after the dev-server paragraph):

  > For any browser work (research, forms, testing a site), don't launch your own Chrome. Open a tab with `taskflow-cli browser open "<url>" --label "<what>"` and connect to the CDP endpoint it prints (Playwright: `chromium.connectOverCDP(endpoint)`). Run `taskflow-cli browser list` to find your tabs again.
- **UI copy** (exact):
  - marker tooltip and `aria-label`: `Agent connected`;
  - remote placeholder: `This browser runs on <machine label>`;
  - host-gone placeholder: `Browser host is not running`.

## Review Focus

1. **An agent's endpoint reaching anything outside its tab family.** That covers the Taskflow UI renderer, other tasks' tabs, `Target.attachToTarget` with a guessed id, a reused `sessionId`, tunneling through `Target.sendMessageToTarget` or a `flatten:false` session, `Target.attachToBrowserTarget`, `Browser.close`, a new browser context, browser-wide commands (`Tracing.*`), and context-scoped commands that default to the app's own session. Expected: refused with `Not allowed by Taskflow: <method>`, or silently not listed. Paused new targets the agent may not see are resumed, never left paused. Pinned in Section 4 (filter unit tests, one per vector) and Section 8 (live Playwright check with two tabs from two tasks).
2. **Work while hidden or with the window closed.** Screenshots, clicks and timers keep working while the tab isn't shown, while the user is in another task, and after the main window is closed to the tray (macOS). Pinned in Section 1 (spike criteria) and Section 8 (manual).
3. **The host goes away mid-session** (app quit, backend restart, renderer reload).
   - App quit: the backend quits with it (`electron/src/main.ts:281`), so CDP connections close and the CLI can't reach the backend.
   - Host gone, backend alive (the host stops heartbeating): `hostAvailable` flips false within 15 s, CDP connections close, and `browser open` returns the exact unavailable error.
   - Backend restart while the app runs (no supervisor restarts it today, so unit tests only): the next heartbeat restores `loaded`, re-adopts live children, and endpoints work again.
   - Renderer reload: tabs aren't touched at all.

   Pinned in Section 2 (staleness and heartbeat reconcile tests), Section 4 (gateway closes on host loss), Section 5 (the link uses the current backend port on every tick), and Section 8.
4. **Close from one side while the other is using the tab.**
   - The user closes a tab an agent is connected to: the agent's socket closes.
   - An agent closes it (`browser close` or `Target.closeTarget`): the UI tab disappears.
   - Closing a parent closes its popups.
   - Archiving or deleting a task closes its tabs.

   Pinned in Sections 2, 3 and 4.
5. **UI overlays over a visible native view.** A dialog, menu, select, popover or tooltip that intersects the browser pane must be visible. The page shows as a frozen image until the overlay closes, then goes live again. Non-intersecting overlays don't freeze it. Pinned in Section 6 (overlay registry and intersection tests) and Section 8 (manual).

## Execution notes

- **After every section:**
  - `bun run typecheck`;
  - `bunx eslint <changed files>` and `bunx prettier --check <changed files>`;
  - the section's tests;
  - the full suite of the package you touched (`cd packages/backend && bun test`; UI files one by one from the root).
- **Flaky test:** `platform.test.ts` "resolveConfigBaseDir … isolated backend" fails occasionally and passes on rerun. Rerun once before investigating.
- **Electron:** the electron package has no unit-test harness for main-process code that needs Electron APIs. Section 5 keeps the Electron-free logic in pure modules with tests (`bun test electron/src/...`, as `backend-url.test.ts` does). The Electron-bound glue is verified in Section 8.
- **Final review:** when all sections are done, run a whole-change review (`codex-review` skill, gpt-6.1-sol).

## Plan review log

- Round 1 (gpt-6.1-sol): 1 blocker, 14 majors confirmed, 1 part rejected (`reviews/round-1-triage.md`). Changes:
  - CDP filter: explicit browser-level allowlist, flattened sessions only, no `sendMessageToTarget`, context-scoped commands pinned to the tab's context; `/cdp/` reserved.
  - Heartbeat carries `parentId` and re-adopts children; the host link serializes posts.
  - Popups: both `createWindow` paths.
  - `TabHost` gets the navigation methods.
  - UI: `TabContent` passes registry identity; per-backend removal in `syncBrowserTabs`; `InlineTooltip` registers as an overlay.
  - Backend: errors module first, a construction order without cycles, cleanup on both project-removal paths.
  - The old browser route removal moves to Section 7.
  - CLI error streams stated as they are.
  - Section 8 lifecycle checks made runnable.
