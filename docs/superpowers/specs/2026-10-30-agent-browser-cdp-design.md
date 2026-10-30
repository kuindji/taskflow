# Agent-Drivable Internal Browser — Design

Date: 2026-10-30
Status: draft, builder-checked, pending user approval

## Problem

The user runs several agents at once. They research, fill in forms and work on
sites the user has logged them into. Each agent today launches its own Chrome
(Playwright scripts for Claude, the computer-use plugin for Codex). The screen
fills with Chrome windows and the user can't tell which one belongs to which task.

Taskflow already has an internal browser pane, but agents can only open it
(`taskflow-cli browser "<url>"`). They can't drive it. The pane also dies when
the user switches to another task or project, and its tabs are not saved.

## Intent

Every agent's browser lives inside Taskflow, attached to its task (or project).
Where a tab sits tells the user whose it is, and no extra windows take up the
screen. The user can step into any tab, log in or fix something by hand, then
leave, and the agent carries on in the background.

## Goals

1. **Agents keep the tooling they already know.** An agent asks `taskflow-cli`
   for a browser tab and gets a CDP endpoint back. Standard Playwright code
   (`chromium.connectOverCDP(endpoint)`) then drives that tab: navigate, click,
   fill, evaluate, screenshot, wait for events. **My call:** the endpoint should
   behave like a real Chrome browser endpoint, not a Playwright-only surface.
   Acceptance covers Playwright for Node and Python, plus Puppeteer
   (`puppeteer.connect({ browserURL })`).
2. **Tabs run in the background.** A tab keeps running, and stays drivable,
   while the user is on another tab, another task or another project. Switching
   away and back changes nothing about the page.
3. **The user and the agent share the tab.** Either can act at any moment.
   Neither is locked out.
4. **Agents learn about it** from the browser commands doc and a short nudge in
   the agent system prompt: use `taskflow-cli browser` instead of launching
   your own Chrome.
5. **It fails clearly.** When no browser host is available (see Constraints),
   the CLI returns a plain error. It never half-opens a tab and never silently
   falls back to Chrome.

## Non-goals (first version)

- **Remote backends.** The browser runs only in the desktop app on the same
  machine as the agent's backend. An agent on a remote backend gets a "browser
  not available on this machine" error. Showing a remote machine's browser
  locally (streaming its pixels and forwarding input) is a later project. The
  design must not block it (see "Built for remote later").
- **Plugins and MCP tools.** The Playwright MCP picks its browser at session
  start, and Codex computer use drives its own browser or the screen. Neither is
  redirected in this version. A later follow-up could start each agent with a
  Playwright MCP already pointed at its task's browser.
- **TUI and web UI.** Neither hosts drivable browsers.
- **Per-task login isolation.** All tabs share one cookie and storage partition
  (`persist:browser`), as today. Logging in once lets every agent use the
  session.

## Anti-goals

- An agent can reach the Taskflow app's own UI, or another task's tabs, through
  its endpoint.
- Switching tabs or tasks reloads the page, loses form input, or breaks an
  agent's connection.
- Agents sit waiting while their tab is hidden because Chromium throttles it.
  Timers, rendering and screenshots must keep working.

## Behavior

### For agents

- `taskflow-cli browser open "<url>" [--label "<text>"] [--project]` creates a
  tab on the current task (or project with `--project`). It prints the tab id
  and its CDP endpoint.
- `taskflow-cli browser list [--project]` lists the tabs in scope: id, label,
  current URL and endpoint. An agent reconnects to its tab after a script exits,
  or in a later session on the same task, using this output. It can also drive a
  tab the user opened by hand.
- `taskflow-cli browser close <tabId>` closes a tab.
- The old form `taskflow-cli browser "<url>" [--label] [--project]` keeps
  working as an alias for `open`.
- Each endpoint exposes **one tab** and the popups that tab opens. Through it, an
  agent sees exactly those pages and nothing else in the app.
- Pages the tab opens (`window.open`, `target=_blank`, OAuth popups) become
  new tabs in the same task. They show up as new pages on the same CDP
  connection, so Playwright's `context.on("page")` works. **My call:** a popup
  is a full tab record (own id, own endpoint, listed by `browser list`) with a
  `parentId`. The parent's endpoint sees it while both are alive. Popups are
  **not** saved across an app restart: they depend on `window.opener`, so a
  restored one would be useless. They are dropped on restart.
- Both CLI implementations get the same commands: the POSIX script
  `packages/backend/src/services/taskflow-cli.sh` and the TS bin
  `taskflow-cli-bin.ts`.

### For the user

- Browser tabs appear in the task's or project's tabs, as today.
- A tab that an agent is connected to shows a small "agent connected" marker.
- Closing a tab in the UI closes it for the agent too. The agent's connection
  ends.
- Tabs are owned by the backend and saved. Switching tasks, reloading the
  renderer and restarting the app all leave the tab list intact. After an app
  restart a tab keeps its id and endpoint path (the port may change, see Amendment 8), and reopens at its last URL (page
  state is lost). **My call:** restored tabs load lazily. A tab's view is
  created the first time it is shown or the first time an agent connects to
  its endpoint. So a connection to a not-yet-loaded tab creates it first, and
  startup doesn't load every saved page at once. Once loaded, a tab is never
  suspended.
- Tabs are removed when the user or an agent closes them, or when their task is
  archived or deleted.
- Tabs the user opens from the UI ("New Tab", or links clicked in a terminal)
  are the same kind of tab. They get the same keep-alive and are reachable by
  agents through `browser list`.

## Constraints and facts from the codebase

- The backend has no auth. It binds to loopback only, and remote access goes
  through SSH tunnels (`packages/shared/src/utils/backend-host.ts`). CDP
  endpoints follow the same model: loopback, unauthenticated, reached through
  the backend's origin.
- Today `browser:open` is broadcast to every WS client
  (`task-routes.ts:317`, `project-routes.ts:28`). The UI adds a renderer-only
  tab that is never saved (`session-subscriptions.ts:164`). Every attached
  Electron app opens its own copy.
- Today the browser is a renderer `<webview>` (`BrowserPane.tsx:182`). It is
  kept alive across tab switches inside one workspace (React `<Activity>`,
  `TabContent.tsx:173`), but unmounted when the user switches task or project.
- On macOS, closing the main window destroys the renderer and the app stays in
  the tray (`main.ts:219`). Anything hosted in the renderer dies with it.
- The backend can only broadcast to WS clients. It can't address one client or
  wait for a reply (`packages/backend/src/ws/server.ts`). It also doesn't know
  which client is which.
- The Electron main process talks to the backend over HTTP only. It has no WS
  client. Main spawns the local backend and knows its port.
- Electron is 33.x. `WebContentsView` and `webContents.debugger` are available.
- The guest preload (`electron/src/browser-preload.ts`) hides
  `navigator.webdriver`. Keep that for agent-driven tabs.

## Architecture

### Browser host

**Decided (my call):** the Electron **main process** owns browser tabs. Each tab
is a `WebContentsView` in partition `persist:browser`. The renderer's
`BrowserPane` becomes a placeholder. It reports its on-screen bounds and
visibility, and main attaches and positions the view over it while it's visible.
A hidden tab is detached from view but kept alive and rendering:
`backgroundThrottling: false`, with its last size kept (default 1280×800 if it
was never shown). Screenshots, clicks and timers must work while hidden. If a
detached view can't render, main parks hidden views in an offscreen or hidden
host window.

Why main rather than the renderer: tabs survive task switches, renderer reloads
and closing the window to the tray. Playwright also treats `WebContentsView`
targets as ordinary pages, while its support for `<webview>` targets is
unreliable.

**Known cost:** a native view draws on top of the renderer's DOM. Taskflow UI
that overlaps a visible browser pane (dialogs, menus, toasts, the command
palette) would be hidden under it. The builder must handle this. One approach:
when an overlay intersects the pane, main hides the view and the placeholder
shows a frozen snapshot of the page until the overlay closes.

The host is **only the desktop app running on the same machine as the
backend** (Electron's "local" backend). Other clients attached to that backend
(another machine's app, the TUI, the web UI) never create tabs. They show a
"browser runs on <machine>" placeholder or nothing.

**Where there is no host (my call):** workspaces of a remote backend in the
desktop app, and the web UI, keep today's behavior. "New Tab → Browser" and
terminal links still open a plain renderer `<webview>` (desktop) or `<iframe>`
(web UI). That tab isn't saved, isn't in the registry and isn't drivable by
agents. `BrowserPane` keeps that path as a fallback, so nothing regresses. In
those places `taskflow-cli browser open` returns the "not available" error.

### Scopes

**My call:** tabs belong to one of three scopes: task, project, or **master**.
Master is the workspace of the primary backend. It counts only when that
backend is local, so master is the third scope, not an exception. An agent in a
master session (no task or project id) gets a master-scoped tab. Master tabs
are removed only by closing them.

### Tab registry (backend)

The backend owns browser tab records: id, scope (task or project), label,
current URL, created time, and whether an agent is connected. They are saved in
the backend's normal data store and broadcast to the UI like other state.
Workspace tabs for browsers come from this registry, not from renderer-only
`addTab`. The host reports URL and title changes back to the registry.

### Host channel

Electron main opens its own WebSocket to its local backend and registers as the
browser host. The backend uses this channel to:

- ask the host to create or close a tab, and wait for the answer;
- relay CDP traffic between agents and the host.

This needs request/response from backend to one addressed client. That doesn't
exist yet (Constraints). Keeping the renderer out of the CDP path means agent
traffic never depends on UI state.

### CDP endpoint

- Each tab gets an endpoint on the backend's origin, for example
  `http://127.0.0.1:<port>/cdp/<tabId>`. It serves `/json/version` with a
  `webSocketDebuggerUrl` so `connectOverCDP` accepts the HTTP form, and the WS
  form works too.
- Agents need a **browser-level** CDP session, since Playwright's
  `connectOverCDP` requires one. The builder picks how to provide it:
  - **(a)** Main enables Chromium remote debugging on a random loopback port.
    The backend (or main) proxies the browser-level WebSocket and **filters
    targets**: only the tab's target and its popups are listed, attached or
    auto-attached. Commands aimed at other targets are rejected. Paused
    new targets the agent isn't allowed to see must be resumed, never left
    paused.
  - **(b)** Main attaches `webContents.debugger` to the tab. The proxy emulates
    the minimal browser-level surface Playwright needs (`Browser.*`, `Target.*`
    with flattened sessions) on top of it.

  Goal 1 asks for "behaves like real Chrome" across several clients, so **(a)
  is preferred**. (b) is a fallback only if the spike shows (a) can't be made
  safe. (a) relies on real Chromium behavior. Its cost is a filtering proxy, and any
  local process can reach the raw port (acceptable under the existing
  loopback-only model, but the port is never printed or documented). (b)
  exposes nothing extra, but it must track what Playwright expects across
  versions. **The plan starts with a spike** that proves one option end-to-end:
  Playwright connects, sees exactly one page, navigates, clicks, fills, takes
  a screenshot while the tab is hidden, and receives a popup as a new page.
  It must do this from Playwright (Node and Python) and from Puppeteer.
- Several connections to the same tab at once are allowed. That includes the
  user's own DevTools, if exposed, plus more than one script.

### Built for remote later

Tab records live on the backend that owns the task. The host is a role a
client takes on for a backend, not something fixed to the UI window. The CDP
endpoint is on the backend's origin, so an agent always connects to its own
backend. A remote machine's own desktop app (or a headless browser run by its
backend) can become that backend's host later, and other machines can view its
tabs through a pixel stream. Nothing in this version should assume the host and
the viewer are the same app.

## Agent guidance

- Update `taskflow-cli-browser-commands.md` with `open`, `list` and `close`, the
  printed output format, and a three-line `connectOverCDP` example. Also cover:
  don't call `browser.close()` on the connected browser (disconnect instead),
  and expect one page per endpoint.
- Add a one- or two-line nudge to the agent prompt base: "For any browser
  work, open a tab with `taskflow-cli browser open` and connect to its CDP
  endpoint. Don't launch your own Chrome."
- Assumption: Codex agents can reach loopback from their sandbox, as they
  already do for `taskflow-cli`'s curl calls.

## Left to the builder

- Option (a) or (b) for the CDP endpoint, settled by the spike.
- How overlays over a visible native view are handled.
- How hidden views keep rendering (detached view, or a hidden host window).
- The shape of the host-channel protocol and the backend's client-addressing
  mechanism.
- The storage location of tab records, and the exact `browser list` output
  format (JSON or one tab per line, as long as it's easy for agents to parse).
- The look of the "agent connected" marker.

## Amendments (plan-time, 2026-10-30)

1. **CDP traffic doesn't go through the host channel.** The host and the
   backend are always on the same machine in this version, so the backend's CDP
   gateway dials the host's loopback Chromium debugging port directly. The host
   channel carries only control: create, ensure and close tabs, and report
   navigation. A remote host later will need a relay. That stays a later
   concern.
2. **The host channel is HTTP, not a WebSocket.** Electron's main process has
   no WS client (Node 20, no `ws` dependency).
   - Main runs a small loopback HTTP control server, and the backend calls it.
   - Main registers with the backend through a heartbeat
     (`PUT /api/browser/host` every 5 s). The heartbeat carries the loaded tabs
     and their target ids.
   - The backend treats the host as gone 15 s after the last heartbeat.
3. **Pages an agent creates** (`context.newPage()`, which is
   `Target.createTarget`) become child tabs of the endpoint's tab, the same way
   popups do. They aren't saved across restarts either.
4. **CLI scope fallback.** Without `--project`:
   - with `TASKFLOW_TASK_ID`: a task tab;
   - otherwise with `TASKFLOW_PROJECT_ID`: a project tab;
   - otherwise: a master tab.

   Today, project sessions error out unless `--project` is given.
5. **CDP filter policy (plan review round 1).**
   - Only flattened sessions are allowed. `Target.sendMessageToTarget`, and `attachToTarget`/`setAutoAttach` without `flatten: true`, are refused, because tunneled messages would skip the filter.
   - Browser-level commands are an explicit allowlist, not default-forward, so browser-wide domains such as `Tracing` are refused.
   - Context-scoped commands (`Browser.setDownloadBehavior`, permissions, `Storage.*Cookies`) default to Electron's default session, which is the app's own. They are pinned to the tabs' browser context, or refused.
   - The whole `/cdp/` path namespace is reserved. Nothing under it becomes an app WebSocket.
   - Agents keep page-level powers such as file inputs. They already run with the user's shell, so that isn't an escape.
6. **Children survive a backend restart.** The host heartbeat carries each view's `parentId`, so a restarted backend re-adopts live popups and agent pages instead of closing them. They are still dropped when the app restarts.
7. **App quit stops the backend.** The desktop app owns its backend's process. "Browser not available" is what agents see when the backend outlives its host, or when no desktop app runs on that machine. After an app quit, the CLI can't reach the backend at all.
8. **CDP filter and popups (plan review round 2).**
   - Chromium's `Browser` handler also runs on page sessions, so `Browser.crash`, `crashGpuProcess`, `close` and the context-scoped `Browser`/`Storage` commands get the same treatment on an allowed page session as at browser level. A known `sessionId` doesn't make a command page-local.
   - Popup preferences (partition aside: preload, `backgroundThrottling: false`) go through `overrideBrowserWindowOptions`, because Electron fixes a guest's preferences before `createWindow` runs.
   - A plain `target=_blank` popup has no `window.opener` (implicit noopener). That is correct behaviour, not a failure.
   - **Endpoint stability:** the backend binds an OS-assigned port, so after an app restart a tab keeps its id and its `/cdp/<tabId>` path, but the port can change. Agents rediscover the endpoint with `taskflow-cli browser list`.
9. **CDP filter boundary and popup names (plan review round 3).**
   - Page sessions are a domain allowlist, not default-forward. Chromium's page sessions also carry `Tracing` (which traces the browser and GPU processes) and `ServiceWorker` (which acts on every worker in the partition). The boundary: effects inside the shared `persist:browser` partition are accepted, as with logins; effects on the browser or GPU process, the app's session, or other tasks' live tabs are not. Puppeteer's `page.tracing` therefore doesn't work through the endpoint.
   - Electron reuses a named popup (`window.open(url, name)`) across the whole process, before any ownership check. A popup name belongs to the family that opened it; another family's `window.open` with that name is refused.
   - Host events are retried until the backend answers, because a lost `closed` event can't be inferred from the heartbeat (unloaded tabs are absent too).
10. **Tab targets, popup-name races and renderer reload (plan review round 4).**
   - Chromium puts each page behind a `tab` target with its own id, and Puppeteer attaches to pages only through those. The filter decides a tab target by the page inside it, which the gateway looks up on a separate upstream connection.
   - A popup name is reserved for a family when its `window.open` is allowed, not when the popup exists, because Electron creates the popup in a later task.
   - Reloading the Taskflow UI detaches every browser view but keeps it loaded; the reloaded UI shows the panes it displays.
   - A `closed` event the backend failed to store is retried (5xx, up to 3 attempts), and closing an already-forgotten tab still removes its saved record.
11. **Spike facts (Section 1, 2026-10-30).** Playwright for Node and Python and Puppeteer passed every spike criterion through the filtering proxy (`docs/superpowers/plans/2026-10-30-agent-browser/spike/results.md`).
   - **Context-scoped commands can't be pinned.** Electron registers no partition with DevTools, so Chromium rejects the tabs' `browserContextId` and an omitted one means the app's session. Amendment 5's "pinned to the tabs' browser context" becomes: download behaviour is accepted as a no-op, cookie commands run against the tab's own cookie jar through its page, and permission commands are refused. Downloads in hosted tabs are not reported to agents.
   - **`Target.createTarget` is not supported by Electron**, so Amendment 3's interception is required, and its reply waits until the client has seen the new page attach, as Chromium orders it.
   - **Hidden tabs live in one hidden window.** A view in no window has no viewport, and one removed from a window stops painting once its client reconnects. Tabs that aren't shown sit in a never-shown 1280×800 window; that window's renderer is an app target like the main window's.
   - **Popups keep their preferences** only if the guest's view is created with them again (minus the partition, which crashes Electron). Every popup kind, `target=_blank` links and forms included, arrives as a guest.
   - **`navigator.webdriver`** is `true` while remote debugging is on; the `disable-blink-features=AutomationControlled` switch turns it back to `false`. The preload's patch never reached the page.
12. **Lessons from t3code (2026-10-30).** t3code (MIT) hosts agent-driven Electron browsers too. Its fixes shaped four rules here:
   - Main's control server sits under a random secret path and refuses requests with an `Origin` header, because hosted pages and other local processes can reach loopback ports.
   - The `persist:browser` session denies every permission except clipboard write and storage access, without prompts, and tabs never navigate to non-web schemes (`mailto:`, `vscode:`…).
   - Each view has one capture in flight and a 3 s deadline. A failed or late capture freezes the pane blank instead of crashing.
   - The stripped user agent stays only if Section 8 shows that challenge pages accept it. Otherwise the native UA stays.
13. **Implementation (Section 8, 2026-10-30).**
   - **Native user agent.** With the rewritten Chrome UA, Cloudflare's managed challenge looped on its checkbox and Google sign-in refused the browser as not secure. With Electron's native UA both passed, so hosted tabs keep it (Amendment 12's fallback). `toChromeUserAgent` stays for the legacy iframe pane.
   - **Keep-awake while an agent is connected.** The never-shown park window's compositor ticks at about 1 Hz, so a client that doesn't turn on focus emulation itself (Puppeteer) waited ~900 ms per frame and ~3 s per screenshot on a parked tab. Each CDP connection now holds `Emulation.setFocusEmulationEnabled` on every page of the tab's family (the tab, its popups and agent pages) over its own upstream session. Holding it through `webContents.debugger` instead is not an option: an attached Electron debugger stops other clients from receiving the page's subframe events.
   - **Filter-assigned request ids.** The filter rewrites every forwarded request's id and maps replies back. Client ids and `sessionId`s never correlate replies, replies the filter didn't ask for are dropped, and a `sessionId` the filter hasn't allowed (empty included) is refused.
   - **No browser-target sessions.** `Target.attachToBrowserTarget` stays refused, so Playwright's `newCDPSession` and `newBrowserCDPSession` don't work through the endpoint. Raw page sessions through a flattened `Target.attachToTarget` do.
   - **Refused navigations hang Playwright's click.** Electron cancels a `mailto:` or custom-scheme navigation before any request exists, and Playwright waits for that navigation until its timeout (30 s by default). Nothing opens; the click itself still happens.
