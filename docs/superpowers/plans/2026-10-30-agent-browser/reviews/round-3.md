Reviewed `0286d1f4`, the current source, and the installed Electron **33.4.11** declarations. No files were modified. “Holds” below means the plan correction holds; it does not imply runtime acceptance has been completed.

For task A:

| Round-2 finding | Holds / not | Verification |
|---|---|---|
| B1: browser-wide commands through page sessions | **Not fully** | The named `Browser.*` escapes are now covered at every session level, but [Section 4:78](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-30-agent-browser/04-cdp-gateway.md:78) still forwards other domains with effects beyond the page. Finding 1 below. |
| B2: popup criterion and ownership | **Holds** | [Spike:21–23](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-30-agent-browser/01-spike.md:21) handles both creation paths and registers logical ownership; [criterion 4](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-30-agent-browser/01-spike.md:53) now distinguishes noopener from opener-preserving cases. This fits [the constructor options](/Users/kuindji/Projects/taskflow/electron/node_modules/electron/electron.d.ts:21892), which provide no opener option. |
| B3: existing-guest preferences | **Holds** | [Section 5:84](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-30-agent-browser/05-electron-host.md:84) supplies shared preferences through `overrideBrowserWindowOptions`. That property exists in [Electron’s response type](/Users/kuindji/Projects/taskflow/electron/node_modules/electron/electron.d.ts:18385), and [Electron applies it before guest creation](https://github.com/electron/electron/blob/v33.4.11/lib/browser/api/web-contents.ts#L724-L744). |
| B4: no-guest POST headers | **Holds** | [Section 5:86](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-30-agent-browser/05-electron-host.md:86) forwards data and constructs the content-type/boundary header. This matches [PostBody](/Users/kuindji/Projects/taskflow/electron/node_modules/electron/electron.d.ts:9749) and [LoadURLOptions](/Users/kuindji/Projects/taskflow/electron/node_modules/electron/electron.d.ts:19864). |
| B5: synthetic reply routing | **Holds** | [Section 4:79](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-30-agent-browser/04-cdp-gateway.md:79) now requires one helper preserving both `id` and optional `sessionId`, with session-level success/error tests. |
| B6: UI transition order | **Holds** | [Section 6:9](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-30-agent-browser/06-ui.md:9) retains the existing [UI listener](/Users/kuindji/Projects/taskflow/packages/ui/src/stores/session-subscriptions.ts:164); [Section 7:12](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-30-agent-browser/07-cli-prompt.md:12) removes it after registry synchronization exists. [The chain order](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-30-agent-browser/chain.md:83) agrees. |
| B7: gateway dependency into routes | **Holds** | [Section 4:12–13](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-30-agent-browser/04-cdp-gateway.md:12) explicitly adds and passes `ApiRouteDeps.cdpGateway`, matching the actual [route dependency mechanism](/Users/kuindji/Projects/taskflow/packages/backend/src/api/routes.ts:34). |
| B8: endpoint stability | **Holds** | [Amendment 8](/Users/kuindji/Projects/taskflow/docs/superpowers/specs/2026-10-30-agent-browser-cdp-design.md:306) and [restart verification](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-30-agent-browser/08-verify.md:33) now promise stable ID/path and endpoint rediscovery. That matches [port-0 configuration](/Users/kuindji/Projects/taskflow/packages/backend/src/config.ts:196). |
| B9: initial navigation state | **Holds** | [Section 5:90](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-30-agent-browser/05-electron-host.md:90) emits current navigation state after every successful show, including already loaded views, and adds a regression test. |
| Triage’s own finding: guest-value guard and return identity | **Not fully** | The undefined-value check and same-guest return requirement are corrected. However, the prescribed narrowing still fails against the installed types. Finding 5 below. |

I checked the Section 6/7 cross-references, including the index and execution protocol. They now consistently retain the legacy path through Section 6 and migrate/remove it in Section 7. I found no remaining dependency on Section 7 having run first.

The remaining and new findings for task B follow.

1. **Blocker: page sessions still permit operations beyond the tab family.**

   **Exact claim:** [Section 4:78](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-30-agent-browser/04-cdp-gateway.md:78) says rules 2–4 have covered every domain reaching beyond the page, so everything else on an allowed session can pass.

   **Evidence:** Chromium 130 installs both `TracingHandler` and `ServiceWorkerHandler` on page targets. See [render_frame_devtools_agent_host.cc:353–376](https://github.com/chromium/chromium/blob/130.0.6723.191/content/browser/devtools/render_frame_devtools_agent_host.cc#L353-L376).

   Through A’s allowed page session:

   - `Tracing.start` passes rule 6. Its implementation includes the browser and GPU processes, even when applying a page-session process filter. See [tracing_handler.cc:766–788](https://github.com/chromium/chromium/blob/130.0.6723.58/content/browser/devtools/protocol/tracing_handler.cc#L766-L788).
   - `ServiceWorker.enable`, followed by `ServiceWorker.stopAllWorkers`, also passes. The handler uses the page’s storage partition and stops **all** its service workers, including another task’s workers in `persist:browser`. Its version events also expose worker and controlled-page target IDs. See [service_worker_handler.cc:137–168](https://github.com/chromium/chromium/blob/130.0.6723.191/content/browser/devtools/protocol/service_worker_handler.cc#L137-L168), [:230–241](https://github.com/chromium/chromium/blob/130.0.6723.191/content/browser/devtools/protocol/service_worker_handler.cc#L230-L241), and [:369–417](https://github.com/chromium/chromium/blob/130.0.6723.191/content/browser/devtools/protocol/service_worker_handler.cc#L369-L417).

   **Concrete fix:** Replace session-level default-forward with an explicit classification of supported methods. Deny `Tracing.*` at every level and deny or ownership-filter service-worker operations and events. Add these page-session cases to the isolation tests; normal client traffic recorded by the spike cannot establish that unrecorded commands are safe.

2. **Blocker: Electron’s named-popup reuse can navigate another family’s tab before `createWindow` runs.**

   **Exact claim:** [Section 5:84–88](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-30-agent-browser/05-electron-host.md:84) allows popup requests and relies on `createWindow` plus `reportChildOpened` to establish ownership.

   **Evidence:** Electron 33 maintains a module-wide `frameNamesToWindow` map. Before invoking `createWindow`, it looks up the requested name and calls `existingWebContents.loadURL(url)` when found. There is no opener/family check. Guest popups are registered in that map. See [guest-window-manager.ts:17–20](https://github.com/electron/electron/blob/v33.4.11/lib/browser/guest-window-manager.ts#L17-L20), [:45–69](https://github.com/electron/electron/blob/v33.4.11/lib/browser/guest-window-manager.ts#L45-L69), and [:121–125](https://github.com/electron/electron/blob/v33.4.11/lib/browser/guest-window-manager.ts#L121-L125).

   Concrete trigger: B opens a popup named `oauth`. A evaluates `window.open(otherUrl, "oauth")`. Electron can navigate B’s popup without calling A’s ownership-registration callback.

   **Concrete fix:** Enforce named-window ownership in `setWindowOpenHandler`, before returning `allow`. Reject cross-family name collisions while permitting intended reuse within a family. Add an Electron integration case with two independent roots using the same popup name.

3. **Major: pending `show` and `freeze` operations can override a newer visibility decision.**

   **Exact claim:** [Section 5:57](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-30-agent-browser/05-electron-host.md:57) defines `show` as asynchronous “ensure, then show”; `hide` is synchronous. [Section 6:68](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-30-agent-browser/06-ui.md:68) calls `hide` on Activity cleanup or unmount.

   **Evidence:** A supported sequence is:

   1. Show a restored, unloaded tab; view creation is pending.
   2. Switch tasks; cleanup calls `hide`.
   3. Creation finishes; the older `show` attaches the native view over the new workspace.

   The existing UI actually uses [Activity visibility changes](/Users/kuindji/Projects/taskflow/packages/ui/src/components/workspace/TabContent.tsx:178). There is a second ordering problem: [freeze captures, then hides](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-30-agent-browser/05-electron-host.md:64). If an overlay disappears during capture, its older freeze can hide the view after the newer show. Electron’s [capturePage is asynchronous](/Users/kuindji/Projects/taskflow/electron/node_modules/electron/electron.d.ts:16176).

   **Concrete fix:** Specify host-side desired visibility and operation generations. After awaiting creation or capture, apply visibility changes only if that request is still current. `hide`, `detachAll`, and close must invalidate pending shows. Add tests with deferred creation and capture promises.

4. **Major: heartbeats cannot repair a dropped `closed` event.**

   **Exact claim:** [Section 5:13](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-30-agent-browser/05-electron-host.md:13) swallows failed event posts because the next heartbeat repairs state.

   **Evidence:** A failed `closed` post is followed by a heartbeat omitting the view. But [Section 2:53](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-30-agent-browser/02-backend-registry.md:53) only marks that record unloaded and removes its mapping. It neither removes the record nor fires `subscribeTabGone`. Those actions are reserved for [close processing](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-30-agent-browser/02-backend-registry.md:82) or host staleness.

   Consequently, a closed tab can remain in the UI; a saved root can later reopen. Its browser-level CDP socket also has no specified closure trigger, since [the gateway relies on `subscribeTabGone` or upstream socket closure](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-30-agent-browser/04-cdp-gateway.md:100). Closing one page does not close the upstream browser socket.

   **Concrete fix:** Retain and retry unacknowledged close events, or carry acknowledged close tombstones in heartbeats. Do not infer closure from absence alone, because absence also represents legitimate lazy tabs. Test a failed close-event post followed by a successful heartbeat.

5. **Minor: two prescribed Electron expressions do not typecheck on 33.4.11.**

   **Exact claims:** [Section 5:85](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-30-agent-browser/05-electron-host.md:85) prescribes an `in` check followed by a non-null check for guest adoption; [:91](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-30-agent-browser/05-electron-host.md:91) prescribes listening for WebContents’ `close` event.

   **Evidence:** I ran an in-memory TypeScript probe using the repository’s compiler and installed declarations:

   - After those checks, `options.webContents` narrows to `{}`, not `WebContents`. Passing it to [WebContentsView’s constructor](/Users/kuindji/Projects/taskflow/electron/node_modules/electron/electron.d.ts:21892) produces **TS2740**.
   - `wc.on("close", …)` produces **TS2769**. Electron emits it internally, but the installed public overloads do not declare it. The supported [destroyed event](/Users/kuindji/Projects/taskflow/electron/node_modules/electron/electron.d.ts:14627) covers successful closure.

   **Concrete fix:** Specify a genuine `value is WebContents` predicate, validated against Electron’s WebContents registry, or an explicitly typed adapter for the internal callback field. Use `destroyed` for closure reporting. The runtime correction from the triage is sound; its proposed typing is incomplete.

**Overall assessment: Changes required.** Most round-2 corrections hold, and the revised Section 6/7 order is consistent. Two concrete isolation escapes remain, alongside visibility-ordering and lost-close-event defects. These conclusions come from source inspection and the type probe; no live Electron or client acceptance tests were run.