# Backend auth surface map (facts only, HEAD caf2df69)

## 1. Server endpoints

`packages/backend/src/ws/server.ts:70-80`: `Bun.serve` binds `resolveBackendHost()` (loopback only; `packages/shared/src/utils/backend-host.ts:27-40`), port `config.port` (0, or `TASKFLOW_DEV_PORT`).
- **WS upgrade:** `server.upgrade(req)` runs first for every request, whatever the path, method or Origin (`:74`). Any request that carries upgrade headers becomes a full app client with about 87 `router.register(MSG.*)` handlers. These include SESSION_CREATE/INPUT/CLOSE, FILE_READ/WRITE/DELETE/RENAME/MKDIR, SETTINGS_UPDATE(_DATA_DIR), REMOTE_AGENT_START and FILE_OPEN_EXTERNAL (`packages/backend/src/handlers/*.ts`).
- **HTTP:** `ApiRouter.handle` (`api/router.ts:28`) does method plus regex matching only. There are no CORS headers, no OPTIONS handling and no Host check. Handlers call `req.json()` whatever the Content-Type, so a cross-site `text/plain` "simple" POST gets through without a preflight. The response can't be read cross-origin, but the side effect still happens.
- **Fallback:** `200 "Taskflow backend"` (`server.ts:79`). **Identity probe:** the tunnel readiness check `GET /` expects a body starting with "Taskflow backend" (`packages/shared/src/remote/tunnel-manager.ts:79-93`). Identity confirmation then runs over WS `MSG.SYSTEM_INFO`, which returns backendUid and protocolVersion (`handlers/system.ts:19`; called at `packages/ui/src/stores/backend-store.ts:151` and `packages/tui/src/settings/store.ts:93`).

Route groups (`packages/backend/src/api/routes/`):
- `session-routes.ts`: **spawns** sessions (`POST /api/sessions` :124), resumes them (:215) and **writes PTY input** (`POST /api/sessions/:id/input` :101). Also status/done/move/rename (mutate), and owner/snapshot/tail (read terminal output).
- `task-routes.ts`: task CRUD, worktree PATCH (:127, git worktree on disk), log, archive/unarchive, delete (can remove worktrees), browser (broadcast).
- `project-routes.ts`: project add (any path) and delete, reorder, patch, **fork** (:221, copies to a target path), `POST /:projectId/browser` (broadcast).
- `flow-routes.ts`: flow and action CRUD, **run action / start flow** (:323, :390, spawn sessions), stop/pause/resume/skip/jump. `POST /api/flow/artifact` (:104) accepts any `path`, and `GET .../:type/raw` (:184-224) then streams that absolute file. Together they make an arbitrary file read.
- `schedule-routes.ts`: CRUD, `trigger` (:196, spawns), `complete`.
- `settings-routes.ts`: GET/PATCH settings (:40, :59). PATCH changes agent and shell config, so it can lead to code execution later. Read-only: app-name, cli-help, tray-state, agents, system/info, shells, runtimes.
- `notification-routes.ts`: list, create, patch, delete.
- `dev-server-routes.ts`: register a pid, list, remove.
- `attribute-routes.ts`: `/api/<collection>/:id/attributes` CRUD (:54).
- `file-routes.ts`: `GET /api/file/raw?path=` (:33) reads files limited to workspace roots by `assertWorkspacePath`.
- Already on HEAD (Section 2): the backend is itself a client of Electron main's control server, `fetch(controlUrl + /tabs/ensure|close)` (`services/browser-host-client.ts:14`).

## 2. Clients

| Client | Finds host+port | Transport | Custom headers? | Origin sent |
|---|---|---|---|---|
| Electron renderer, prod | `window.taskflow.getBackendPort()` → IPC `get-backend-port` (`electron/src/preload.ts:19`, `ipc-handlers.ts:79`). Main reads the port from `TASKFLOW_PORT_FILE` (tmpdir) that it passes to the spawned backend (`backend-manager.ts:75-122`). | Browser `WebSocket(origin→ws)` (`packages/ui/src/lib/connection.ts:73-96`). No `fetch` in UI. `<img src>` to `/api/file/raw` (`ui/src/lib/backend-url.ts:7`, `MarkdownPaneImpl.tsx:516`). | **No.** The browser WS API and `<img>` can't set headers, so only URL/query, subprotocol or cookie can carry a credential. | Loaded with `loadFile` (`window-manager.ts:166`), so the origin is a `file://` page. Expect `Origin: file://` on WS (Chromium; not verified here). |
| Electron renderer, dev | Same IPC. UI loaded from `TASKFLOW_UI_URL` (`backend-manager.ts:8`, `window-manager.ts:162-164`), Vite port 5173 (`packages/ui/vite.config.ts:31`). | same | No | `http://localhost:5173` |
| **Plain browser (non-Electron) mode: exists** | `import.meta.env.VITE_BACKEND_PORT`, dials `http://localhost:<port>` (`ui/src/providers/WebSocketProvider.tsx:8-18`). Used in dev and verify docs. | Browser WS | No | `http://localhost:5173` |
| Renderer → remote backend | origin `http://127.0.0.1:<local tunnel port>` (`electron/src/attached-backends.ts:28`) | Browser WS | No | `file://` / dev origin. The remote backend sees `Host: 127.0.0.1:<localTunnelPort>`, not its own port. |
| Electron main | `backendOrigin(port)` (`electron/src/backend-url.ts:13`) | Node `fetch`: GET/PATCH `/api/settings` (`window-manager.ts:32, :136`), `/api/tray-state` on every attached origin (`tray-manager.ts:166`), `/api/notifications` (`notification-poller.ts:35`), artifact raw download (`artifact-download.ts:55`), tunnel probe `GET /` | Yes | none |
| TUI local | Spawns its own backend with `TASKFLOW_PORT_FILE=$TMPDIR/taskflow-tui-port-*` (`packages/tui/src/backend/manager.ts:103-125`) | Bun `WebSocket` (`packages/tui/src/net/client.ts:24, :92`). No HTTP. | Yes (Bun WS accepts a `headers` option) | none |
| TUI `--connect host:port` | User-typed, no discovery (`packages/tui/src/cli.ts:101-128`) | Bun WS | Yes | none. Nothing to read a token from. |
| TUI / Electron remote machine | `createTunnelManager` (`packages/tui/src/remote/machines.ts:44-51`, `electron/src/main.ts`) | ssh `-L` plus WS | Yes | none |
| `taskflow-cli` POSIX sh (used on macOS/Linux) | `$TASKFLOW_API_URL` (`services/taskflow-cli.sh:9`) | **curl**, 76 separate `curl` invocations, most inline. Only `api_request` (:50-63) is shared. | Yes (`-H`, already sends `X-Taskflow-*`) | none |
| `taskflow-cli` TS bin (Windows exe, dev `.bat`) | `process.env.TASKFLOW_API_URL` (`taskflow-cli-bin.ts:11`) | Bun `fetch`, centralized in `api()` (:25-45) and one at :130 | Yes | none |

The CLI is installed to `<BASE_DIR>/bin/taskflow-cli`, mode 0755 (`services/internal-agent-skill.ts:146-167`).

**Session env** (`services/session-lifecycle.ts:541-555`, applied at :608): `TASKFLOW_API_URL=backendHttpOrigin(port)`, `TASKFLOW_SESSION_ID`, plus `TASKFLOW_TASK_ID`, `TASKFLOW_PROJECT_ID`, `TASKFLOW_FLOW_ID`, `TASKFLOW_ACTION_ENTRY_ID` and `TASKFLOW_SYSTEM_PROMPT` when they apply. Every PTY session gets this env, and so does every process it starts (agents, shells, dev servers): UI-created, flow-run, scheduled (`scheduler-service.ts`), remote-agent (`remote-agent-service.ts`) and worktree-setup sessions, because all of them go through `createSession`.

**Other parties:**
- Headless agents (title generator, builtin actions) get the backend's `process.env` with no `TASKFLOW_API_URL` (`agent-accounts.ts:~107-121`, `headless-agent.ts:109`). They don't call the API.
- No MCP server exists.
- The wiki and dev-server UIs go through the app WS.
- The in-app `<webview partition="persist:browser">` (`BrowserPane.tsx:182-185`, `webviewTag: true` at `window-manager.ts:87`) loads arbitrary web pages on the same machine. Those pages are attackers, not clients.

**Remote port read** (`tunnel-manager.ts:122-157`): `ssh -p <sshPort> -o BatchMode=yes <hostKeyOptions> -l <user> -- <host> "cat ~/.config/taskflow/'<instanceId>.port'"`.
- It runs only when the record has no `lastKnownPort` and no beacon match (`backend-registry.ts:127-135`). Beacon-discovered or remembered ports skip ssh reads entirely.
- A token file could be `cat`'d the same way, but the beacon and known-port paths would then need an ssh read they don't do today.
- Windows remotes and remotes started with `TASKFLOW_CONFIG_DIR` can't be read this way (:115-121).
- The LAN beacon broadcasts port and backendUid in cleartext (`index.ts:507-526`). backendUid is therefore public.

## 3. Agent-browser plan additions

(`docs/superpowers/plans/2026-10-30-agent-browser.md:163-186` and sections 03, 04, 05, 07)

- **HTTP:** `POST/GET /api/browser/tabs`, `DELETE /api/browser/tabs/:id` (callers: CLI sh and TS bin, `07-cli-prompt.md:20-22`). `PUT /api/browser/host` and `POST /api/browser/host/events` (caller: Electron main `backend-link.ts`, Node fetch every 5000 ms, `05-electron-host.md:13`).
  - The heartbeat body carries `controlUrl` and `debugPort`, which the backend then fetches and connects to. An unauthenticated PUT therefore lets the caller pick where the backend sends `/tabs/ensure` and which port it CDP-connects to.
- **CDP gateway:** `GET /cdp/:tabId/json/version`, `/json/version/`, `/json/list`, `/json`, plus a WS upgrade on `/cdp/:tabId/devtools/browser`. All other `/cdp/*` paths return 404 and are never upgraded (`04-cdp-gateway.md:8-10`).
  - `webSocketDebuggerUrl` and `endpoint` are rebuilt from the request's **Host header** (`plan:177, :181`), so a Host check interacts with that rewrite and with tunnels.
  - Callers are third-party CDP clients started by agents: `chromium.connectOverCDP(endpoint)` and `puppeteer.connect({ browserURL })` (`07-cli-prompt.md:41, :52`). The client fetches `/json/version` itself, then dials the returned ws URL.
  - The prompt nudge hands over only the bare `endpoint`, with no header options (`plan:225-227`). Both libraries have header options (unverified here), but agents won't pass them unless told. A credential in the endpoint URL or the rewritten ws URL needs no client cooperation.
- **Handoff:** the agent runs `taskflow-cli browser open|list` and the CLI prints `{"tab":…,"endpoint":"http://127.0.0.1:<port>/cdp/<id>"}` (`07-cli-prompt.md:37`). The port changes after a restart.
- **New loopback listeners, both unauthenticated in the plan:** Electron main's control server, Node `http` on `127.0.0.1:0` with `POST /tabs/ensure|close` (`05-electron-host.md:12`), and Chromium's raw remote-debugging port (never shown to agents, `plan:220`).

## 4. Data dir and instance files

- `BASE_DIR` is `$TASKFLOW_CONFIG_DIR`, or `~/.config/taskflow` (POSIX), or `%APPDATA%\taskflow` (`services/platform.ts:10-25`). The data dir can be moved via `data-location.json` (`config.ts:10-23`) to a synced folder. Per-instance files stay in BASE_DIR.
- Instance id is `main` or `dev-<branch>` (`config.ts:78`).
- Files:
  - `portFile`: `$TASKFLOW_PORT_FILE`, or `$TMPDIR/.taskflow-port-<pid>` (`config.ts:178`, written `index.ts:499`).
  - `<instanceId>.port` (`config.ts:180`; `instance-port-file.ts:15-23`, temp file plus rename).
  - `backend-uid-<instanceId>`, written with **mode 0o600** (`config.ts:104-135`).
  - `dev-servers-<instanceId>.json`, `settings.json`, `bin/`.
  - Planned: `browser-tabs-<instanceId>.json` (`03-backend-api.md:4`).
- **Permissions:** apart from the uid file (0600), the CLI (0755) and the ssh `known_hosts` (0700 dir / 0600 file, `tunnel-manager.ts:589-598`), everything uses default umask. `ensureDirectories` (`config.ts:205-216`) passes no mode. On this machine `~/.config/taskflow` is `drwxr-xr-x` and `main.port` is `-rw-r--r--`. Windows has no POSIX modes.
