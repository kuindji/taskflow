## A. Round-1 fixes

“Holds” means the revised plan addresses the finding; implementation has not started.

| Finding # | Holds / not | Why |
|---|---|---|
| 1 | Holds | Section 4 applies the flattened-session requirement and `sendMessageToTarget` rejection before session-level forwarding. |
| 2, confirmed portion | **Not fully** | Browser-level default-forward is gone, but allowed page sessions still default-forward commands with browser-wide effects. See B1. |
| 3 | Holds | The index and Section 4 reserve `/cdp/` before application upgrades. Unsupported paths cannot become application sockets. |
| 4 | **Not fully** | Both creation paths are now described, but guest preferences and POST headers remain incomplete. See B3–B4. |
| 5 | Holds | Heartbeats carry `parentId`; reconciliation adopts parents before descendants; late `child-opened` events are idempotent. Section 5 serializes event and heartbeat delivery. |
| 6 | Holds | Section 6 explicitly modifies `TabContent`, passes `browserTabId` and `workspaceKey`, and uses the existing `workspaceBackendId` helper. |
| 7 | **Not fully** | The four methods now exist and have defined unloaded-tab behavior. Initial navigation-state delivery is still missing. See B9. |
| 8 | Holds | Removal is restricted to the reconciled backend’s previous `knownIds`; reset behavior and tests preserve other backends’ tabs. |
| 9 | Holds | `InlineTooltip` is included, with positioning notifications and an actual toolbar-tooltip test. |
| 10 | Holds | Section 3 names both HTTP and WS project removal, captures task IDs before removal, and requires cleanup tests for both. |
| 11 | Holds | The deferred broadcast closure permits service and gateway construction before `createServer`. `init()` broadcasts nothing, and initialization finishes before `server.start()`. This fits `index.ts:84`, `:118`, `:297`, `:307`, and `:495`. |
| 12 | Holds | Task 2.2 now creates `browser-tab-errors.ts` before the client imports it. |
| 13 | Holds for the original failure | Sections 3 and 7 and the index retain old routes until the CLI migration. Section 2:7 still incorrectly says Section 3 removes them. A separate UI transition gap remains, B6. |
| 14 | Holds | Section 7 now accurately describes the shell helper’s stdout body and generic stderr error, and the TS helper’s stderr body. |
| 15 | Holds for the original failures | Host loss uses a surviving backend, app quit expects connection failure, and A survives the earlier close test. The restart check has a separate port-stability problem, B8. |

## B. Remaining and new findings

1. **Blocker — Browser-wide commands bypass the new policy through page sessions.**

   **Document:** [04-cdp-gateway.md:74](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-30-agent-browser/04-cdp-gateway.md:74), filter rules 3–5.

   **Exact claim:** “On an allowed session, everything else: forward. These commands act on that page.”

   **Evidence:** Chromium installs `BrowserHandler` on page sessions at `render_frame_devtools_agent_host.cc:315–317`. That handler implements `Browser.crash` at `browser_handler.cc:531` and `Browser.crashGpuProcess` at `:536`. Neither operation is page-local. Sending either command with A’s allowed `sessionId` bypasses the browser-level allowlist. [Chromium page-session handlers](https://github.com/chromium/chromium/blob/130.0.6723.191/content/browser/devtools/render_frame_devtools_agent_host.cc#L315), [browser-wide crash handlers](https://github.com/chromium/chromium/blob/130.0.6723.58/content/browser/devtools/protocol/browser_handler.cc#L531).

   There is also an app-context mutation path: `Browser.setPermission` is absent from rule 3. On an allowed page session it reaches rule 5; omitting `browserContextId` selects the default browser context. See `browser_handler.cc:289–302` and `:319–325`. [Permission handling](https://github.com/chromium/chromium/blob/130.0.6723.58/content/browser/devtools/protocol/browser_handler.cc#L289).

   **Fix:** Apply browser-wide denials and context validation at every session level. Explicitly classify supported commands instead of treating a known `sessionId` as proof of page-local effects. Add page-session tests for `Browser.crash`, `Browser.crashGpuProcess`, and `Browser.setPermission` with omitted and foreign context IDs, then rerun all three clients through the resulting filter.

2. **Major — The popup spike has an impossible acceptance criterion and cannot identify every planned child.**

   **Document:** [01-spike.md:33](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-30-agent-browser/01-spike.md:33), proxy ownership and criterion 4.

   **Exact claims:** Allowed targets are A plus targets whose `openerId` is allowed; clicking `target=_blank` must produce a popup whose `window.opener` is non-null.

   **Evidence:** The newly added no-guest branch creates a fresh `WebContentsView`; its constructor accepts `webPreferences` and `webContents`, with no opener option, at [electron.d.ts:21892](/Users/kuindji/Projects/taskflow/electron/node_modules/electron/electron.d.ts:21892). A normal `_blank` link has implicit `noopener`, so requiring non-null `window.opener` contradicts its intended behavior. [HTML standard](https://html.spec.whatwg.org/multipage/links.html#link-type-noopener).

   A freshly created no-guest view also cannot be assumed to carry Chromium’s `openerId`, so the spike’s opener-only filter can reject the very child the host created.

   **Fix:** Assert null opener for ordinary `_blank`/`noopener`, and a working opener for `rel=opener` and ordinary `window.open`. Register logical child ownership through the spike side channel, as production does through `parentId`, rather than relying exclusively on `openerId`.

3. **Major — Existing-guest popups still receive required preferences too late.**

   **Documents:** [01-spike.md:20](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-30-agent-browser/01-spike.md:20) and [05-electron-host.md:83](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-30-agent-browser/05-electron-host.md:83), popup creation.

   **Exact claim:** Return `{ action: "allow", createWindow }`, then wrap an existing guest with the same preferences.

   **Evidence:** The installed response type exposes `overrideBrowserWindowOptions` at [electron.d.ts:18385](/Users/kuindji/Projects/taskflow/electron/node_modules/electron/electron.d.ts:18385). Electron consumes those preferences before guest creation in `web-contents.ts:724–744`. Its inherited security-preference list does not include the browser preload or `backgroundThrottling`. Adopting existing contents updates preferences for subsequent renderer launches, not the renderer already created. [Guest preparation](https://github.com/electron/electron/blob/v33.4.11/lib/browser/api/web-contents.ts#L724), [inherited preferences](https://github.com/electron/electron/blob/v33.4.11/lib/browser/guest-window-manager.ts#L129), [adoption behavior](https://github.com/electron/electron/blob/v33.4.11/shell/browser/api/electron_api_web_contents.cc#L4223).

   **Fix:** Return shared browser preferences through `overrideBrowserWindowOptions.webPreferences`, including preload and `backgroundThrottling: false`. Verify preload behavior and background timers on existing-guest popups.

4. **Major — No-guest POST popups lose their content-type metadata.**

   **Document:** [05-electron-host.md:85](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-30-agent-browser/05-electron-host.md:85), no-guest navigation.

   **Exact claim:** `loadURL(details.url, { httpReferrer: details.referrer, postData: details.postBody?.data })`.

   **Evidence:** `PostBody` separately supplies `contentType` and multipart `boundary` at [electron.d.ts:9749](/Users/kuindji/Projects/taskflow/electron/node_modules/electron/electron.d.ts:9749). `LoadURLOptions` accepts headers separately at [electron.d.ts:19874](/Users/kuindji/Projects/taskflow/electron/node_modules/electron/electron.d.ts:19874). Electron’s normal no-guest navigation explicitly supplies the POST content-type header in `guest-window-manager.ts:83–88`. The custom callback bypasses that path. [Electron navigation implementation](https://github.com/electron/electron/blob/v33.4.11/lib/browser/guest-window-manager.ts#L79).

   A multipart form opening a new tab can therefore send bytes without the matching boundary header and arrive as an invalid submission.

   **Fix:** Build `extraHeaders` from `postBody.contentType` and its optional boundary. Add a local POST receiver to the spike and verify both URL-encoded and multipart submissions.

5. **Major — Locally generated CDP replies lose their session routing.**

   **Document:** [04-cdp-gateway.md:71](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-30-agent-browser/04-cdp-gateway.md:71), intercepted replies and rule 6.

   **Exact claim:** Intercepts reply with `{ success: true }` or `{ targetId }`; errors use `{ id, error: … }`. Only rule-1 errors explicitly preserve `sessionId`.

   **Evidence:** The plan permits these commands and refusals on allowed sessions. Playwright dispatches incoming replies using `message.sessionId` in `crConnection.ts:64–70`, then resolves callbacks within that session at `:142–150`. A reply without the original session ID reaches the root session instead, leaving the caller pending or triggering an unexpected-response assertion. [Playwright reply routing](https://github.com/microsoft/playwright/blob/v1.56.1/packages/playwright-core/src/server/chromium/crConnection.ts#L64).

   **Fix:** Centralize synthetic responses so every success and error copies both `id` and the request’s optional `sessionId`. Test intercepted `Target.createTarget`, `Target.closeTarget`, and denied commands through an allowed child session.

6. **Major — Section 7 removes the UI delivery path before Section 6 supplies its replacement.**

   **Document:** [07-cli-prompt.md:8](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-30-agent-browser/07-cli-prompt.md:8), legacy-path removal.

   **Exact claim:** Remove the UI listener now; “Section 6 adds the replacement.”

   **Evidence:** In the required order `1,2,3,4,5,7,6,8`, Section 7 migrates the CLI to registry endpoints and removes [session-subscriptions.ts:164](/Users/kuindji/Projects/taskflow/packages/ui/src/stores/session-subscriptions.ts:164), which currently creates the visible browser tab. The registry store and synchronization are created only in Section 6. After Section 7, CLI opens create hidden native views without adding workspace tabs. Existing CLI tests can pass while this behavior regresses.

   **Fix:** Include minimal registry-to-workspace synchronization in Section 7, or move the CLI transition and legacy removal into Section 6’s commit. Require a CLI-open-to-visible-tab integration check at that transition. Correct Section 2:7’s stale removal instruction too.

7. **Major — The gateway has no declared dependency path into its HTTP routes.**

   **Documents:** [03-backend-api.md:14](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-30-agent-browser/03-backend-api.md:14) and [04-cdp-gateway.md:8](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-30-agent-browser/04-cdp-gateway.md:8), route wiring.

   **Exact claim:** Add `browserTabService` to `ApiRouteDeps`; pass the gateway as `createServer`’s fourth argument; implement `/json` routes in `browser-routes.ts`.

   **Evidence:** [routes.ts:34](/Users/kuindji/Projects/taskflow/packages/backend/src/api/routes.ts:34) defines the dependencies available to registered routes. `ApiRouter` independently invokes stored handlers at [router.ts:41](/Users/kuindji/Projects/taskflow/packages/backend/src/api/router.ts:41). Passing a gateway to `createServer` does not make `versionJson` or `listJson` available to those handlers. No section declares the missing route dependency.

   **Fix:** Section 4 must pass the gateway through `registerApiRoutes` into browser-route dependencies, or explicitly register separate CDP routes with `{ apiRouter, gateway }` from `index.ts`. Update the interface contract and route-test fixtures in that section.

8. **Major — The promised endpoint stability contradicts backend port allocation.**

   **Documents:** Spec “For the user” and [08-verify.md:33](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-30-agent-browser/08-verify.md:33), restart verification.

   **Exact claim:** After restarting, A has “the same id and endpoint.”

   **Evidence:** [config.ts:196](/Users/kuindji/Projects/taskflow/packages/backend/src/config.ts:196) defaults the backend port to `0`; [ws/server.ts:70](/Users/kuindji/Projects/taskflow/packages/backend/src/ws/server.ts:70) lets the OS allocate it. The index builds endpoints from the current request origin. Restarting preserves the tab ID but can change the endpoint’s port. The stable instance port file records the newly allocated port; it does not reserve the previous one.

   **Fix:** Either introduce stable endpoint addressing, or amend the spec and checklist to promise a stable tab ID/path and require rediscovery through `browser list` after restart.

9. **Minor — Reopening a loaded tab does not restore toolbar navigation state.**

   **Documents:** [05-electron-host.md:56](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-30-agent-browser/05-electron-host.md:56) and [06-ui.md:63](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-30-agent-browser/06-ui.md:63).

   **Exact claims:** `show` ensures and shows; navigation events emit `navState`; the toolbar gets `canGoBack` from `onNavState`.

   **Evidence:** A task switch or renderer reload mounts a fresh toolbar around an already loaded view. Idempotent `ensure` produces no navigation event, so nothing sends the existing history state. Today’s pane explicitly samples history on readiness at [BrowserPane.tsx:46](/Users/kuindji/Projects/taskflow/packages/ui/src/components/panes/BrowserPane.tsx:46). The planned `HostedView.navState()` has no specified initial consumer.

   **Fix:** Emit current navigation state on every successful `show`, after the renderer subscribes, or return it from `show`. Test remounting a loaded view with back history.

**Overall assessment: Changes required.** The construction-order, heartbeat-recovery, namespace-routing, and UI ownership fixes are substantially improved. The session-level CDP bypass remains blocking, and popup handling, synthetic reply routing, and several integration contracts need correction before implementation. This was a read-only source and installed-type review; no files were modified, and no live Electron or client acceptance tests were run.