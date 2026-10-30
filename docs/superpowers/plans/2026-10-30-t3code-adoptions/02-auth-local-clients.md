# Section 2: Auth, local clients (Electron main and renderer, dev UI, TUI local, both CLIs)

Read `design.md` §1 and Section 1's interfaces first. Enforcement is still off. After this section, every client that talks to the **local** backend sends the token, and the backend's stderr shows no `[auth] report-only` line from any of them. Remote backends get their tokens in Section 4. Until then a remote record has no token, which report-only mode tolerates.

Anchors are against HEAD `3397b225`. The agent-browser chain adds `electron/src/browser-host/` and changes `main.ts`, `window-manager.ts`, `preload.ts`, `env.d.ts` and the CLI `browser` command, so find each anchor by the quoted code. The browser host's `backend-link.ts` moves to `backendFetch` in Section 5, not here.

**Files:**

Task 2.1, Electron main:
- Create `electron/src/backend-fetch.ts` + `electron/src/backend-fetch.test.ts` (run with `bun test electron/src/backend-fetch.test.ts`, like `notification-poller.test.ts`).
- Modify `electron/src/backend-manager.ts`:
  - keep the token: `let backendToken: string | null = null`, with `setBackendToken` and `getBackendToken` next to `setBackendPort` and `getBackendPort` (`:149-155`), both exported;
  - `startBackend` (`:108-147`): when `UI_DEV_SERVER_URL` is set (`:8`), the spawn env gets `TASKFLOW_UI_ORIGINS: [safeEnv.TASKFLOW_UI_ORIGINS, new URL(UI_DEV_SERVER_URL).origin].filter(Boolean).join(",")`. The Electron dev renderer then loads from the Vite origin without anyone setting it by hand.
- Modify `electron/src/attached-backends.ts`:
  - `AttachedBackend` (`:10-14`) gains `token: string | null`;
  - `listAttachedBackends(localPort, localToken, remote)` (`:21-30`): local gets `localToken`, each remote entry `entry.token ?? null`. The `remote` element type becomes `{ id: string; origin: string; token?: string }`; Section 4 makes the registry fill it.
- Modify `electron/src/main.ts`:
  - after `startBackend` (`:196-198`): `const { port, token } = await startBackend(devBranch); setBackendPort(port); setBackendToken(token);`;
  - `getAttachedBackends` (`:139-141`) passes `getBackendToken()`;
  - before `initWindowManager` (`:90`): `const backendFetch = createBackendFetch({ tokenFor: (origin) => getAttachedBackends().find((entry) => new URL(entry.origin).origin === origin)?.token ?? null });`. The closure runs only after `registry` exists. Pass `backendFetch` into `initWindowManager`, `initTrayManager` and `registerIpcHandlers`. The poller's `fetchNotifications` (`:143-145`) becomes `(origin) => fetchBackendNotifications(backendFetch, origin)`.
- Modify the main-process call sites. Each one goes through `backendFetch`, and no bare `fetch(` to a backend stays in `electron/src/`:
  - `window-manager.ts`: `WindowManagerDeps` (`:13-18`) gains `backendFetch: BackendFetch`; `fetchSavedLayout` (`:32`) and the close-time `PATCH` (`:136`) become `deps.backendFetch(backendOrigin(port), "/api/settings", ...)`;
  - `tray-manager.ts`: `TrayManagerDeps` (`:7-13`) gains `backendFetch`; `fetchTrayState` (`:166`) becomes `deps.backendFetch(origin, "/api/tray-state", ...)`;
  - `notification-poller.ts`: `fetchBackendNotifications(backendFetch: BackendFetch, origin: string)` (`:34-45`);
  - `artifact-download.ts`: `downloadArtifact(url, attached, destination, backendFetch)` (`:49-69`). The fetch becomes `const target = new URL(url); backendFetch(target.origin, target.pathname + target.search, { redirect: "error" })`. `isArtifactUrl` is unchanged;
  - `ipc-handlers.ts`: `IpcHandlersDeps` (`:13-28`) gains `getBackendToken: () => string | null` and `backendFetch: BackendFetch`. The `listAttachedBackends` calls (`:116`, `:312`) pass `deps.getBackendToken()`. `save-artifact` passes `deps.backendFetch` to `downloadArtifact` (`:131`). `attach-backend` for local (`:315-327`) returns `{ ok: true, origin, token: deps.getBackendToken() ?? undefined }`.
- Modify `packages/shared/src/remote/backend-registry.ts`: `AttachResult` (`:51`) becomes `{ ok: true; origin: string; token?: string } | { ok: false; failure: TunnelFailure }`. The field is optional, so the existing fixtures that answer `{ ok: true, origin }` stay valid (`backend-store.test.ts`, `hard-switch.test.ts`, `connect.test.ts`, `machine-session.test.ts`). `attachBackend` (`:346`) still returns no token; Section 4 fills it.
- Update the tests that call the changed functions: `artifact-download.test.ts` (pass `createBackendFetch({ tokenFor: () => null })`), `notification-poller.test.ts` if it calls `fetchBackendNotifications`, and any `listAttachedBackends` caller in tests.

Task 2.2, renderer and dev UI:
- Modify `packages/ui/src/lib/connection.ts`:
  - the constructor (`:47-53`) gains a 4th parameter `private readonly token: string | null`, plus a getter `get authToken(): string | null`;
  - `open()` (`:96`): `new WebSocket(this.wsUrl(), this.token === null ? [] : ["taskflow", \`taskflow.auth.${this.token}\`])`.
- Modify `packages/ui/src/lib/connection-registry.ts`:
  - `openConnection(backendId, origin, token: string | null = null)` (`:57-76`) passes the token to `new Connection`;
  - add `export function tokenFor(backendId: string): string | null`, next to `originFor` (`:53-55`).
- Modify `packages/ui/src/lib/backend-url.ts:4-8`: `rawFileUrl` appends `&token=${encodeURIComponent(token)}` when `tokenFor(backendId)` is non-null.
- Modify `packages/ui/src/stores/backend-store.ts:228`: `await openConnection(id, result.origin, result.token ?? null);`.
- Modify `packages/ui/src/env.d.ts:85-87`: the `attachBackend` result becomes `{ ok: true; origin: string; token?: string } | { ok: false; failure: TunnelFailure }`.
- Modify `packages/ui/src/providers/WebSocketProvider.tsx:8-19` (`connectDevRenderer`): read `import.meta.env.VITE_BACKEND_TOKEN as string | undefined`. Throw `VITE_BACKEND_TOKEN must be set when running the renderer outside Electron` when it is empty, like the port check at `:10-12`. Then `openConnection(LOCAL_BACKEND_ID, \`http://localhost:${port}\`, token)`.
- Modify `packages/backend/package.json:7`: `"dev": "TASKFLOW_DEV=1 TASKFLOW_UI_ORIGINS=http://localhost:5173 bun run --watch src/index.ts"`. That's the backend the plain-browser dev UI (`bun run dev:ui`, Vite on `5173`, `packages/ui/vite.config.ts:31`) talks to.
- Modify `packages/ui/src/lib/test-ws-server.ts`: record each upgrade's `Sec-WebSocket-Protocol` header in a new `offeredProtocols: (string | null)[]` field on `TestServer`. No answer change is needed: Bun answers the first offered protocol, `taskflow`.
- Create `packages/ui/src/lib/backend-url.test.ts`.

Task 2.3, TUI local:
- Modify `packages/tui/src/net/client.ts`:
  - the constructor (`:49-52`) gains a 3rd parameter `private token: string | null = null`;
  - `connect()` (`:92`): `new WebSocket(url, this.token === null ? undefined : { headers: { Authorization: \`Bearer ${this.token}\` } })`. Bun's `WebSocket` takes `headers` (bun-types `WebSocketOptionsHeaders`).
- Modify `packages/tui/src/opentui/machine-session.ts`: `createLocalClient(port: number, token: string): MachineClient` in the deps (`:63`); `connectLocal` (`:550`) passes `this.localBackend.token`.
- Modify `packages/tui/src/opentui/entry.ts:114`: `createLocalClient: (port, token) => new WsClient(port, null, token)`.
- Modify `packages/tui/src/net/client.test.ts` and `packages/tui/src/opentui/machine-session.test.ts` (the fake `createLocalClient`, `:250`).

Task 2.4, both CLIs (memory: the sh script is what runs on macOS and Linux; change both):
- Modify `packages/backend/src/services/taskflow-cli.sh`:
  - add `tf_curl` right after the `TASKFLOW_API_URL` check (`:9-12`);
  - replace **every** `curl` invocation with `tf_curl`: 76 call sites on HEAD, including the two inside `api_request` (`:53`, `:60`), `--help` (`:87`), the owner lookup (`:98`) and the fallbacks at the end (`:1674-1682`). The browser chain's `browser` block goes through `api_request`, so it is covered.
- Modify `packages/backend/src/services/taskflow-cli-bin.ts`: add `function authHeaders(): Record<string, string>`, which returns `{ Authorization: \`Bearer ${token}\` }` when `process.env.TASKFLOW_API_TOKEN` is non-empty and `{}` otherwise. `api()` (`:25-49`) merges it in before `extraHeaders`. The outlier in `adoptSessionOwner` (`:130`) passes `{ headers: authHeaders() }`.
- Modify `packages/backend/tests/services/taskflow-cli.test.ts`: the fake curl (`:40-91`) parses `-K -` (below), and the harness env sets `TASKFLOW_API_TOKEN: ""`.
- Modify `packages/backend/tests/services/taskflow-cli-bin-session.test.ts`: record the `authorization` header in `startDevServerApi` (`:51-73`) and in `startServer` (`:19-40`).

**Interfaces:**
- Consumes: `PortHandshake` from Section 1 (`startBackend` resolves to it in Electron, `BackendHandle.token` in the TUI); `TASKFLOW_API_TOKEN` in the session env; `backendOrigin` (`electron/src/backend-url.ts`).
- Produces:

```ts
// electron/src/backend-fetch.ts
type BackendFetch = (origin: string, path: string, init?: RequestInit) => Promise<Response>;
function createBackendFetch(deps: {
    tokenFor: (origin: string) => string | null;   // called with new URL(origin).origin
    fetchImpl?: typeof fetch;                      // default: global fetch; tests inject
}): BackendFetch;

// electron/src/backend-manager.ts
function setBackendToken(token: string): void;
function getBackendToken(): string | null;

// electron/src/attached-backends.ts
interface AttachedBackend { id: string; origin: string; isLocal: boolean; token: string | null }
function listAttachedBackends(localPort: number | null, localToken: string | null,
    remote: { id: string; origin: string; token?: string }[]): AttachedBackend[];

// shared registry + renderer bridge
type AttachResult = { ok: true; origin: string; token?: string } | { ok: false; failure: TunnelFailure };

// packages/ui/src/lib/connection-registry.ts
function openConnection(backendId: string, origin: string, token?: string | null): Promise<void>;
function tokenFor(backendId: string): string | null;

// packages/tui/src/net/client.ts
new WsClient(port: number, host: string | null = null, token: string | null = null);
```

Section 4 consumes `BackendFetch`, `AttachedBackend.token`, `tokenFor`, `AttachResult.token` and the `WsClient` token parameter.

## Behavior

**`backendFetch(origin, path, init)`**
- `path` must start with `/`. Otherwise it throws `backendFetch path must start with "/": <path>`.
- The URL is `new URL(origin).origin + path`.
- The headers start from `new Headers(init?.headers)`. When `tokenFor(new URL(origin).origin)` is non-null, `Authorization: Bearer <token>` is set. Every other `init` field passes through untouched (`method`, `body`, `signal`, `redirect`).
- An origin with no token gets no `Authorization` header. That is an attached remote before Section 4, which report-only mode accepts.

**Renderer socket.** With a token, the renderer offers `["taskflow", "taskflow.auth.<token>"]`, in that order. Without one (a remote, until Section 4) it offers none. The backend answers `taskflow` (Section 1).

**Raw file URLs.** `rawFileUrl` gives `<origin>/api/file/raw?path=<encoded>&token=<encoded>` when the backend's connection has a token. That's the only renderer-built URL that carries a token. The flow-artifact raw URL in `FlowPanel.tsx:319-326` goes to main (`save-artifact`), and main fetches it through `backendFetch` with the header, so it stays tokenless.

**Dev UI.** Plain-browser dev mode needs both `VITE_BACKEND_PORT` and `VITE_BACKEND_TOKEN`. The token is the backend's file: `VITE_BACKEND_TOKEN=$(cat "$TASKFLOW_CONFIG_DIR/api-token-dev-<branch>")`, or `~/.config/taskflow/...` without `TASKFLOW_CONFIG_DIR`. The backend must allow the Vite origin, which `packages/backend`'s `dev` script now sets. No script sets `VITE_BACKEND_PORT` today; it is typed by hand from the docs, and the token goes next to it.

**sh CLI `tf_curl`.** The token goes to curl on stdin as a config file, never in argv, where `ps` would show it to every local user:

```sh
# Every request goes through here. The token reaches curl as a config file on
# stdin (`-K -`), never in argv, where `ps` shows it to every local user.
tf_curl() {
  if [ -n "$TASKFLOW_API_TOKEN" ]; then
    printf 'header = "Authorization: Bearer %s"\n' "$TASKFLOW_API_TOKEN" | curl -K - "$@"
  else
    curl "$@"
  fi
}
```

No call in the script feeds curl a body on stdin (`@-`); each passes `-d "<value>"`. So curl's stdin is free for the config. A pipeline's status is curl's own, so `set -e`, `|| { ... }` and `$(...)` behave as before.

**TS bin.** `authHeaders()` is the only place that reads `TASKFLOW_API_TOKEN`. An `Authorization` key in `extraHeaders` wins over it, though no caller sets one.

## Task 2.1: Electron main

- [ ] **Step 1:** Write `backend-fetch.test.ts`, with a recording `fetchImpl`:
  - `adds Authorization: Bearer <token> for an origin that has one`
  - `sends no Authorization header for an origin without a token`
  - `keeps the caller's method, body, signal, redirect and headers`
  - `looks the token up by normalised origin` (pass `http://127.0.0.1:7100/`; `tokenFor` receives `http://127.0.0.1:7100`)
  - `refuses a path that does not start with a slash`
- [ ] **Step 2:** Extend `artifact-download.test.ts`: `downloadArtifact sends the origin's token to the backend` (the `Bun.serve` fake records `authorization`; `tokenFor` answers its origin).
- [ ] **Step 3:** Run `bun test electron/src`. Expected: FAIL.
- [ ] **Step 4:** Implement `backend-fetch.ts`, the token in `backend-manager.ts`, `attached-backends.ts`, the call sites, `main.ts`, `ipc-handlers.ts`, and the shared `AttachResult` type.
- [ ] **Step 5:** Run `bun test electron/src`, `cd electron && bun run typecheck && bun run build`. Expected: PASS. `grep -n "fetch(" electron/src/*.ts` shows only `backend-fetch.ts` (plus `browser-host/backend-link.ts`, which Section 5 moves).
- [ ] **Step 6:** Commit `feat(electron): send the API token on every main-process request`.

## Task 2.2: renderer and dev UI

- [ ] **Step 1:** Add to `connection-registry.test.ts`:
  - `a connection opened with a token offers taskflow then taskflow.auth.<token>` (read `server.offeredProtocols`)
  - `a connection opened without a token offers no subprotocol`
  - `tokenFor returns the token a backend was opened with, and null once it is closed`

  Create `backend-url.test.ts`:
  - `rawFileUrl carries the backend's token as a query parameter`
  - `rawFileUrl has no token parameter when the connection has none`
  - `rawFileUrl is null for a backend that is not attached`

  Add to `backend-store.test.ts`: `attach opens the socket with the token main returned` (`main.attachBackend` answers `{ ok: true, origin, token: "T".repeat(43) }`; afterwards `tokenFor(id)` is that token).
- [ ] **Step 2:** Run each file on its own, from the repo root (`bun test packages/ui/src/lib/connection-registry.test.ts`, and so on; `mock.module` leaks across files). Expected: FAIL.
- [ ] **Step 3:** Implement `connection.ts`, `connection-registry.ts`, `backend-url.ts`, `backend-store.ts`, `env.d.ts`, `WebSocketProvider.tsx`, the backend `dev` script and the `test-ws-server.ts` field.
- [ ] **Step 4:** Run the Step 2 files one by one, then `hard-switch.test.ts` and `MarkdownPaneImpl` tests (the `rawFileUrl` consumer). Run `cd packages/ui && bun run typecheck`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(ui): authenticate the renderer's sockets and raw file URLs`.

## Task 2.3: TUI local

- [ ] **Step 1:** Add to `net/client.test.ts`, with a `Bun.serve` that records the upgrade's `authorization` header:
  - `a client given a token sends Authorization: Bearer <token> on the upgrade`
  - `a client without a token sends no Authorization header`
  - `a reconnect after a drop sends the token again`

  Add to `machine-session.test.ts`: `the local client is created with the spawned backend's token` (the fake `startBackend` resolves `token: TOKEN`; assert the fake `createLocalClient` received it).
- [ ] **Step 2:** Run `cd packages/tui && bun test src/net/client.test.ts src/opentui/machine-session.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `client.ts`, `machine-session.ts` and `entry.ts`.
- [ ] **Step 4:** Run `cd packages/tui && bun test && bun run typecheck`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(tui): send the local backend's API token`.

## Task 2.4: both CLIs

- [ ] **Step 1:** Fake curl in `taskflow-cli.test.ts`: add a `-K)` case that reads stdin when `$2` is `-` and appends each `header = "<h>"` line's `<h>` to `headers`. It also appends the whole argv to `$CAPTURE_FILE` as `ARGV=<args>`. Tests:
  - `every curl call in the script goes through tf_curl`: read the script text; ignoring comment lines (first non-blank character `#`; `taskflow-cli.sh:43` mentions `` `curl -sf` `` in a comment), the only lines matching `/(^|[^_a-zA-Z])curl /` are the two inside `tf_curl`
  - `with TASKFLOW_API_TOKEN set, a plain command sends Authorization: Bearer <token>` (`system info`)
  - `the token is read from stdin and never appears in curl's argv`
  - `api_request calls carry the token too` (`devserver list --all`)
  - `--help carries the token`
  - `without TASKFLOW_API_TOKEN no Authorization header is sent and curl gets no -K`
- [ ] **Step 2:** In `taskflow-cli-bin-session.test.ts`:
  - `api() sends Authorization: Bearer <TASKFLOW_API_TOKEN>` (a `devserver` command)
  - `the session owner lookup sends the token`
  - `no TASKFLOW_API_TOKEN sends no Authorization header`
- [ ] **Step 3:** Run both files. Expected: FAIL.
- [ ] **Step 4:** Implement `tf_curl` and the replacements, then `authHeaders()`. Check syntax with `sh -n` and `dash -n` on the script.
- [ ] **Step 5:** Run both files, `cd packages/backend && bun test` and `bun run typecheck`. Expected: PASS.
- [ ] **Step 6:** Commit `feat(cli): send TASKFLOW_API_TOKEN on every request`.

## Task 2.5: verification (record results in `handoff.md`)

- [ ] **Step 1:** Run the dev Electron app against the Vite UI in an isolated config dir:
  - `bun run dev:ui` in one terminal;
  - `TASKFLOW_CONFIG_DIR=<scratch> TASKFLOW_UI_URL=http://localhost:5173 bun run dev:electron` in another.

  Open a project, a task, a terminal session and a markdown file with an image. Then, from that session, run `taskflow-cli system info`, `taskflow-cli devserver list --all` and `taskflow-cli --help`. Expected: the Electron console shows no `[auth] report-only` line from `origin=http://localhost:5173`, `ua=node` or `ua=curl`.
- [ ] **Step 2:** Run the TS bin from the same session: `bun packages/backend/src/services/taskflow-cli-bin.ts system info`. Expected: no `ua=Bun` line.
- [ ] **Step 3:** Plain-browser mode:
  - start the backend: `cd packages/backend && TASKFLOW_CONFIG_DIR=<scratch> TASKFLOW_DEV_PORT=18799 bun run dev`;
  - start the UI: `cd packages/ui && VITE_BACKEND_PORT=18799 VITE_BACKEND_TOKEN=$(cat <scratch>/api-token-dev-<branch>) bun run dev`.

  Open `http://localhost:5173`. Expected: no report-only line.
- [ ] **Step 4:** TUI local. The TUI keeps only an 8 KiB tail of its backend's stderr and shows it only when startup fails (`manager.ts:143-145`), so it has no view of report-only lines. Task 2.3's tests pin the header. Run `TASKFLOW_CONFIG_DIR=<scratch> bun run dev:tui` and open a session to confirm the TUI still works end to end. Record "TUI local log check: deferred to Section 13" in `handoff.md`.
- [ ] **Step 5:** The packaged renderer's real Origin:
  - run `bun run package`;
  - start it isolated: `open --env TASKFLOW_DEV=1 --env TASKFLOW_CONFIG_DIR=<scratch> electron/release/mac-arm64/Taskflow.app` (`mac` on x64). `TASKFLOW_DEV` skips the single-instance lock (`main.ts:74-86`), so it runs next to a production Taskflow, but it still loads the packaged `file://` UI;
  - open View → Toggle Developer Tools → Network → WS, select the backend socket, and read the request's `Origin` and the response's `Sec-WebSocket-Protocol`.

  Record in `handoff.md` as a fact: `Packaged renderer Origin: <value>; protocol answer: taskflow`. If the Origin is neither `file://` nor `null`, stop and notify. design.md §1's allowlist would then be wrong, and Section 5 must not enforce until it's fixed.
- [ ] **Step 6:** Add to `handoff.md` facts: the dev-UI token command from "Dev UI" above; that remote records still send no token (Section 4); and that `TASKFLOW_UI_ORIGINS` must also be set on a remote backend for a dev renderer to attach to it after Section 5.

## Planner decisions (2026-10-30)

- **`VITE_BACKEND_TOKEN`:** no script sets `VITE_BACKEND_PORT` either. Both are left to the developer. Section 2 writes the exact `cat` command for the token into `handoff.md`, under Facts.
- **`TASKFLOW_UI_ORIGINS` in Electron dev:** no script sets `TASKFLOW_UI_URL`, so `backend-manager.ts` derives the dev UI origin and passes it, alongside the backend `dev` script change. Both stay. `design.md` is amended ("set by the dev scripts and by Electron main in dev").
- If Task 2.5 finds the packaged renderer's Origin is neither `file://` nor `null`, stop the chain and notify the user before Section 5.
