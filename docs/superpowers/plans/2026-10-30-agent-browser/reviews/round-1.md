1. **blocker — Non-flat CDP sessions bypass the filter.**  
   In `04-cdp-gateway.md:62–77`, unknown envelope `sessionId`s are rejected, but “Everything else … forward” permits `Target.sendMessageToTarget` and non-flat attachment.

   An agent can attach to its allowed page with `flatten:false`, then tunnel a serialized `Target.attachToTarget` for the Taskflow renderer inside `params.message`. Subsequent tunneled `Runtime.evaluate` commands bypass validation too. Chromium processes these nested messages directly and returns them through `Target.receivedMessageFromTarget`, which the plan also leaves unparsed. See [Chromium 130’s implementation](https://github.com/chromium/chromium/blob/130.0.6723.191/content/browser/devtools/protocol/target_handler.cc#L1031). Reaching the app renderer exposes its privileged bridge, defined in [preload.ts:18](/Users/kuindji/Projects/taskflow/electron/src/preload.ts:18).

   **Fix:** require flattened attachments and reject `Target.sendMessageToTarget`. Otherwise, recursively filter both tunneled directions. Add a test that tunnels attachment and evaluation against `T-app`.

2. **blocker — The default-forward rule permits browser-wide operations and unrestricted filesystem access.**  
   `04-cdp-gateway.md:67` explicitly forwards `Browser.setDownloadBehavior` and every unlisted command, including commands sent through allowed page sessions. Target membership does not make these operations tab-local.

   For example, browser-level `Tracing.start` can collect activity from other renderers; Chromium’s browser tracing session has no page-process filter. [Chromium tracing implementation](https://github.com/chromium/chromium/blob/130.0.6723.58/content/browser/devtools/protocol/tracing_handler.cc#L765). `Browser.grantPermissions` and download configuration operate on browser contexts, with omitted context IDs selecting Electron’s default app context. [Browser handler](https://github.com/chromium/chromium/blob/130.0.6723.58/content/browser/devtools/protocol/browser_handler.cc#L289). Allowed page commands also include `DOM.setFileInputFiles` with arbitrary paths and `Page.navigate` to local files. The proposed URL validation only checks for a nonempty string.

   **Fix:** replace default-forward with an explicit, scope-aware allowlist. Define controlled upload/download paths and permitted navigation schemes. Deny browser-wide tracing, context mutations, and privileged URL schemes unless explicitly mediated. Repeat the client compatibility spike with these restrictions enabled.

3. **blocker — Unrecognized `/cdp` upgrades become unrestricted application sockets.**  
   The index’s CDP interface says “The other WS paths keep today’s behaviour”; Section 4 routes only the exact `/cdp/:tabId/devtools/browser` path to the filter.

   Today, [ws/server.ts:74](/Users/kuindji/Projects/taskflow/packages/backend/src/ws/server.ts:74) upgrades requests on **any path**. Nonmatching paths then reach the application router at [ws/server.ts:105](/Users/kuindji/Projects/taskflow/packages/backend/src/ws/server.ts:105). Thus an upgrade to `/cdp/A/devtools/page/B` becomes an app socket receiving broadcasts and accepting application RPCs, including workspace file operations in [handlers/file.ts:48](/Users/kuindji/Projects/taskflow/packages/backend/src/handlers/file.ts:48).

   **Fix:** reserve the entire `/cdp/` namespace. Reject every unsupported HTTP route and WebSocket upgrade there before considering application sockets. Test malformed paths, page sockets, trailing slashes, and upgrades against `/json` routes.

4. **major — Popup creation assumes Electron always supplies an existing `webContents`.**  
   `01-spike.md:20` and `05-electron-host.md:79` construct every popup from `options.webContents`.

   Electron 33 has two creation paths. Its link-opening path can call `createWindow` without a guest; the callback then owns navigation too. The custom callback returns before Electron’s normal `loadURL` handling. [Electron 33 guest-window implementation](https://github.com/electron/electron/blob/v33.4.11/lib/browser/guest-window-manager.ts#L58). Also, the installed callback type is `BrowserWindowConstructorOptions`, whose declaration does not expose `webContents`: [electron.d.ts:18375](/Users/kuindji/Projects/taskflow/electron/node_modules/electron/electron.d.ts:18375), [electron.d.ts:6129](/Users/kuindji/Projects/taskflow/electron/node_modules/electron/electron.d.ts:6129).

   **Fix:** implement separate existing-guest and no-guest paths. Adopt existing guests to preserve `window.opener`; otherwise create a view and explicitly navigate using the captured URL, referrer, and POST data. Narrow the optional runtime field without `as any`, and set child preferences before guest creation.

5. **major — Heartbeat recovery destroys live child tabs.**  
   `02-backend-registry.md:54` requires closing every heartbeat entry unknown to the registry. Children are never persisted, while the heartbeat type in the index carries neither `parentId` nor enough ownership information to reconstruct them.

   Consequently, restarting only the backend reloads saved parents and closes all surviving popup and `newPage()` views on the next heartbeat. This contradicts `08-verify.md:31`, which requires recovery “without touching the views.” There is also an ordinary creation race: `05-electron-host.md:89` sends `child-opened` and a heartbeat independently, so the heartbeat can arrive first and close the new child.

   **Fix:** include recoverable child relationships in heartbeats and reconcile parents before descendants. Serialize event delivery with reconciliation, or make heartbeats authoritative enough to repair lost events. Test backend restart with a populated child and heartbeat-before-event delivery.

6. **major — The UI never passes registry identity into `BrowserPane`.**  
   `06-ui.md:12–15` dispatches on `browserTabId`, but its file list and implementation steps omit the component that creates `BrowserPane`.

   The actual caller supplies only `initialUrl`: [TabContent.tsx:155](/Users/kuindji/Projects/taskflow/packages/ui/src/components/workspace/TabContent.tsx:155). The current props likewise contain only that field: [BrowserPane.tsx:15](/Users/kuindji/Projects/taskflow/packages/ui/src/components/panes/BrowserPane.tsx:15). Following the listed changes leaves registry tabs entering the legacy path or creates a props mismatch.

   **Fix:** explicitly modify `TabContent` to pass the registry ID, current URL, and owning backend information. Add an integration test showing a registry tab selects `HostedBrowserPane`, while a legacy tab selects the fallback.

7. **major — Four bridge operations have no corresponding `TabHost` methods.**  
   `05-electron-host.md:94` says IPC handlers “map one-to-one onto `TabHost` methods,” but its declared class at lines 52–65 has no `navigate`, `back`, `forward`, or `reload`. Those operations exist only on the private `HostedView` interface.

   They are required by the index’s renderer bridge and Section 6’s toolbar. Today’s implementation invokes navigation directly on the webview at [BrowserPane.tsx:89](/Users/kuindji/Projects/taskflow/packages/ui/src/components/panes/BrowserPane.tsx:89); no existing host abstraction supplies the missing methods.

   **Fix:** add these methods to the public `TabHost` contract, define behavior for unloaded or missing tabs, and test delegation and initial navigation-state delivery.

8. **major — Per-backend browser synchronization can remove another backend’s tabs.**  
   `06-ui.md:31` supplies “one backend’s full list,” while line 56 removes tabs whose `browserTabId` is absent from that list. The sync contract has no explicit backend ownership boundary.

   Taskflow’s session state contains workspaces from multiple backends. Existing synchronization deliberately restricts removal to owned workspace keys: [session-store.ts:60](/Users/kuindji/Projects/taskflow/packages/ui/src/stores/session-store.ts:60), [session-sync.ts:100](/Users/kuindji/Projects/taskflow/packages/ui/src/stores/session-sync.ts:100). Applying the proposed removal rule globally lets an empty remote list remove local hosted tabs.

   **Fix:** restrict removal to IDs or workspaces previously owned by the backend being reconciled. Make that meaning explicit in `knownIds`, or add a backend ownership argument. Test two backends, an empty update, reconnect, and resetting only one backend.

9. **major — The overlay inventory misses the browser toolbar’s own tooltips.**  
   `06-ui.md:18` lists overlay primitives to register, including `tooltip.tsx`, but omits `button.tsx`.

   Buttons implement a separate portal-based `InlineTooltip`: [button.tsx:73](/Users/kuindji/Projects/taskflow/packages/ui/src/components/ui/button.tsx:73), [button.tsx:139](/Users/kuindji/Projects/taskflow/packages/ui/src/components/ui/button.tsx:139). The current browser toolbar uses these buttons with bottom-positioned tooltips, for example [BrowserPane.tsx:143](/Users/kuindji/Projects/taskflow/packages/ui/src/components/panes/BrowserPane.tsx:143). Those tooltips extend directly over the native view but would never trigger freezing.

   **Fix:** register `InlineTooltip`, preferably through shared tooltip-manager integration. Notify intersection subscribers after floating content is positioned or moves, and test the actual browser toolbar tooltip.

10. **major — Project cleanup targets the HTTP removal path but misses UI removal.**  
    `03-backend-api.md:18` identifies project removal through “the `PROJECT_REMOVED` broadcast site.” That site exists in the HTTP route at [project-routes.ts:110](/Users/kuindji/Projects/taskflow/packages/backend/src/api/routes/project-routes.ts:110).

    The separate WebSocket `PROJECT_REMOVE` handler removes projects without that broadcast: [handlers/project.ts:54](/Users/kuindji/Projects/taskflow/packages/backend/src/handlers/project.ts:54). It calls `TaskStore.removeProject`, whose internal task deletions are excluded from the plan’s caller search. Following the named hook leaves the removed project’s hosted views and agent connections alive.

    **Fix:** add cleanup to both project-removal entry points, or share their removal lifecycle. Capture task IDs before removal and test removal through the WebSocket handler as well as HTTP.

11. **major — The prescribed backend construction order creates dependency cycles.**  
    `03-backend-api.md:8` places service construction after `devServerService`; Section 4 then constructs a gateway from that service and passes it into `createServer`.

    Currently, `createServer` is constructed at [index.ts:118](/Users/kuindji/Projects/taskflow/packages/backend/src/index.ts:118), task/project handlers are registered at [index.ts:297](/Users/kuindji/Projects/taskflow/packages/backend/src/index.ts:297), and `devServerService` is created at [index.ts:369](/Users/kuindji/Projects/taskflow/packages/backend/src/index.ts:369). The new cleanup dependencies are therefore needed before the proposed service declaration, while the service itself needs `server.broadcast`.

    **Fix:** specify a complete construction order. For example, construct the service with a deferred broadcast callback, construct the gateway and server, then register handlers and initialize/start services.

12. **major — Section 2.2 commits an import from a module created only in Section 2.3.**  
    `02-backend-registry.md:33` puts error classes in `browser-tab-service.ts` and requires the host client to import them. Section 2.2 then runs its tests and commits before Section 2.3 creates that file.

    The module is absent from the current repository and is explicitly a Section 2.3 deliverable. Thus Section 2.2’s expected passing tests and the index’s per-section typecheck cannot succeed as ordered.

    **Fix:** create the shared error module before implementing the client, or create the service module’s error declarations in Section 2.2 and state that dependency explicitly.

13. **major — Section 3 removes routes still used until Section 7.**  
    `03-backend-api.md:11` says rewriting the CLI at backend startup means “no old client remains.” Rewriting copies the CLI source available in that commit; it does not implement Section 7 early.

    Until Section 7, the shell CLI still calls the removed routes at [taskflow-cli.sh:310](/Users/kuindji/Projects/taskflow/packages/backend/src/services/taskflow-cli.sh:310), as does the TS CLI at [taskflow-cli-bin.ts:450](/Users/kuindji/Projects/taskflow/packages/backend/src/services/taskflow-cli-bin.ts:450). Worse, unmatched requests receive HTTP 200 `"Taskflow backend"` from [ws/server.ts:79](/Users/kuindji/Projects/taskflow/packages/backend/src/ws/server.ts:79), so the old command can appear successful while opening nothing. Existing tests also reference the removed message at [routes.test.ts:209](/Users/kuindji/Projects/taskflow/packages/backend/tests/api/routes.test.ts:209).

    **Fix:** migrate both CLI implementations and affected tests atomically with route removal, or retain compatibility adapters through Section 7.

14. **major — Section 7 misstates the shell CLI’s error behavior.**  
    `07-cli-prompt.md:20` requires the server error on stderr and claims that is how `api_request` already behaves.

    The helper prints the response body to stdout before checking status, then prints only a generic status error to stderr: [taskflow-cli.sh:66](/Users/kuindji/Projects/taskflow/packages/backend/src/services/taskflow-cli.sh:66). Existing tests explicitly assert error bodies on stdout at [taskflow-cli.test.ts:829](/Users/kuindji/Projects/taskflow/packages/backend/tests/services/taskflow-cli.test.ts:829). An in-memory check with a mocked 503 confirmed this behavior.

    **Fix:** revise the helper or provide a shared error-handling option that preserves existing callers’ contracts. Add failure-stream tests for both CLI implementations, including the exact host-unavailable message.

15. **major — The lifecycle verification cannot run as described.**  
    `08-verify.md:29` says quitting the app should make `browser open` return the host-unavailable error. Taskflow quits its backend too: [main.ts:275](/Users/kuindji/Projects/taskflow/electron/src/main.ts:275), [main.ts:283](/Users/kuindji/Projects/taskflow/electron/src/main.ts:283). The CLI therefore gets a connection failure, not the planned HTTP 503.

    Item 9 also assumes main restarts a killed backend, but [backend-manager.ts:108](/Users/kuindji/Projects/taskflow/electron/src/backend-manager.ts:108) starts it once and provides no restart supervisor. Finally, item 7 closes A before item 8 expects A to survive restart.

    **Fix:** separate desktop shutdown from host loss with a surviving backend. Document an explicit backend relaunch procedure preserving origin and instance data, and create a separate surviving tab for persistence checks.

**Overall assessment: Changes required.** The hosting architecture is plausible on the installed Electron 33.4.11, but the proposed filter does not enforce the promised isolation, and several interfaces and intermediate commits are incomplete. Correct the filtering contract before treating the spike as an acceptance gate, then reconcile popup handling, heartbeat recovery, UI wiring, and lifecycle verification. This was a read-only review; no files were modified, and live Electron behavior was not exercised.