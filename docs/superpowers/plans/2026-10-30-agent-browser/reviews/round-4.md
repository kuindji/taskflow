**Changes required.** I reviewed `84c0815b`, the current documents and repository code, installed Electron 33.4.11 declarations, and relevant upstream sources. No files were modified. Electron/client acceptance tests were not run; the typing and persistence probes ran in memory.

Task A:

| Finding | Holds / not | Evidence |
|---|---|---|
| Page-session domain allowlist | **Holds for the confirmed escapes; compatibility remains incomplete** | [04-cdp-gateway.md:78–81](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-30-agent-browser/04-cdp-gateway.md:78) now rejects `Tracing`, `ServiceWorker`, `Memory`, and unknown domains. The shared-partition exception is explicit. I found no additional substantiated browser/GPU/app-session escape in the forwarded domains. Ordinary Playwright page initialization uses permitted domains. Puppeteer still fails for the separate target-identity problem in B1. |
| Named-popup ownership | **Not fully** | [05-electron-host.md:85–98](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-30-agent-browser/05-electron-host.md:85) protects an already registered name. Ownership is recorded too late to protect overlapping creations. See B2. |
| Visibility generations and empty freeze | **Holds for the reported races** | [05-electron-host.md:78–82](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-30-agent-browser/05-electron-host.md:78) invalidates pending operations, checks generations after awaits, and destroys creations completed after close. [06-ui.md:68](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-30-agent-browser/06-ui.md:68) handles `""`. Renderer reload still needs separate handling, B4. |
| Backend-link event retry | **Not fully** | [05-electron-host.md:15–16](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-30-agent-browser/05-electron-host.md:15) repairs connection failures, but discards events on HTTP 500. Section 2’s heartbeat still cannot repair a missed close. See B3. |
| `isWebContents` and closure through `destroyed` | **Holds** | The prescribed predicate and guest adoption compiled without diagnostics against the installed declarations. `fromId` and `destroyed` are declared at [electron.d.ts:14302](/Users/kuindji/Projects/taskflow/electron/node_modules/electron/electron.d.ts:14302) and [:14627](/Users/kuindji/Projects/taskflow/electron/node_modules/electron/electron.d.ts:14627). Electron’s [`CloseContents`](https://github.com/electron/electron/blob/v33.4.11/shell/browser/api/electron_api_web_contents.cc) calls `Destroy()` after emitting `close`. |

For Task B, these are the evidenced remaining problems:

1. **Blocker. Puppeteer’s normal connection requires target identities the registry cannot resolve.**

   **Plan claim:** [05-electron-host.md:97](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-30-agent-browser/05-electron-host.md:97) obtains one target ID through `webContents.debugger` and `Target.getTargetInfo`. [04-cdp-gateway.md:88](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-30-agent-browser/04-cdp-gateway.md:88) rejects browser-level attachments unless their target maps to an allowed tab.

   **Evidence:** Electron’s [debugger implementation](https://github.com/electron/electron/blob/v33.4.11/shell/browser/api/electron_api_debugger.cc) attaches through `DevToolsAgentHost::GetOrCreateFor(web_contents_)`, yielding the frame/page target. Puppeteer’s normal browser-level auto-attach explicitly excludes `page` and includes `tab`; it then attaches to pages beneath those tab sessions. This is present in both [Puppeteer 23.6](https://github.com/puppeteer/puppeteer/blob/puppeteer-v23.6.0/packages/puppeteer-core/src/cdp/ChromeTargetManager.ts) and [current Puppeteer](https://github.com/puppeteer/puppeteer/blob/main/packages/puppeteer-core/src/cdp/TargetManager.ts). [Chromium 130’s handler](https://github.com/chromium/chromium/blob/130.0.6723.191/content/browser/devtools/protocol/target_handler.cc) explicitly implements this tab/page hierarchy.

   The tab target has a different ID, absent from `loaded` and the mapping. `resolveTarget` times out, and the filter detaches it. Puppeteer therefore cannot reach the promised page through its normal connection sequence.

   **Concrete fix:** Track both tab and page target identities for each hosted WebContents. Authorize them through host-proven WebContents ownership, and update heartbeat, resolution, discovery, attachment, and close handling consistently. Add a Puppeteer connection test exercising the real tab → page session hierarchy.

2. **Major. Named-popup ownership has a check-to-registration race.**

   **Plan claim:** [05-electron-host.md:85–86](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-30-agent-browser/05-electron-host.md:85) registers names from `reportChildOpened`; [:98–102](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-30-agent-browser/05-electron-host.md:98) checks permission in the open handler but registers ownership inside `createWindow`.

   **Evidence:** These callbacks are separate phases. Electron invokes the handler during `-will-add-new-contents`, then invokes `createWindow` from `-add-new-contents`. See [Electron’s implementation](https://github.com/electron/electron/blob/v33.4.11/lib/browser/api/web-contents.ts). For opener-preserving windows, Chromium stores pending contents and later processes a renderer request through `ShowCreatedWindow` before calling `AddNewContents`. See [Chromium 130](https://github.com/chromium/chromium/blob/130.0.6723.191/content/browser/web_contents/web_contents_impl.cc).

   Consequently, A and B can both pass `mayOpenNamed(..., "oauth")` while the name is free. Once the first popup registers, the second reaches Electron’s [existing-name lookup](https://github.com/electron/electron/blob/v33.4.11/lib/browser/guest-window-manager.ts), which navigates that popup before invoking `createWindow`. The ownership check is never repeated.

   **Concrete fix:** Reserve the name atomically when the open handler grants permission. Track pending ownership as well as registered ownership, and release reservations on cancellation, failure, or destruction. Add an interleaved two-family creation test; the existing sequential test misses this path.

3. **Major. An HTTP failure response still permanently loses a close event.**

   **Plan claim:** [05-electron-host.md:16](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-30-agent-browser/05-electron-host.md:16) treats any HTTP status as completion; [:169](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-30-agent-browser/05-electron-host.md:169) explicitly tests that HTTP 500 is not retried.

   **Evidence:** [02-backend-registry.md:82–86](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-30-agent-browser/02-backend-registry.md:82) processes a host close through persisted removal before dropping the record and notifying listeners. The required [existing store pattern](/Users/kuindji/Projects/taskflow/packages/backend/src/services/dev-server-store.ts:95) propagates write failures. An injected `ENOSPC` probe against the actual atomic-write helper confirmed that propagation.

   If persisted removal fails and the route returns 500, the host discards the only close notification. Subsequent heartbeats merely mark the record unloaded, per [Section 2:53](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-30-agent-browser/02-backend-registry.md:53). The saved tab survives and can reopen after restart, reproducing the original consequence.

   **Concrete fix:** Acknowledge an event only after successful application. Retry transient 5xx responses with backoff and idempotent processing. Handle permanently invalid events separately; preserve close tombstones until acknowledged so heartbeat delivery need not remain blocked.

4. **Major. Renderer reload can leave a native browser view covering the rebuilt UI.**

   **Plan claim:** [05-electron-host.md:22](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-30-agent-browser/05-electron-host.md:22) detaches views on window close. [06-ui.md:69](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-30-agent-browser/06-ui.md:69) otherwise relies on React effect cleanup to hide them.

   **Evidence:** Taskflow exposes ordinary reload and force-reload through [app-menu.ts:269–270](/Users/kuindji/Projects/taskflow/electron/src/app-menu.ts:269). Reload destroys the renderer’s JavaScript environment without running React unmount cleanup; the main-owned view remains attached. The rebuilt session store starts with [empty tabs and active selections](/Users/kuindji/Projects/taskflow/packages/ui/src/stores/session-store.ts:157), and [06-ui.md:35](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-30-agent-browser/06-ui.md:35) says initial registry synchronization activates nothing. There may therefore be no visible `HostedBrowserPane` issuing a corrective hide, leaving the previous view over a terminal or another workspace.

   **Concrete fix:** Detach all hosted views and invalidate pending visibility operations when the main renderer starts a full navigation/reload or exits. Keep their WebContents alive. Let the new renderer explicitly show its active panes. Add reload and force-reload acceptance cases.

**Overall assessment: Changes required.** The domain restrictions, visibility generations, and typing correction resolve their specific round-3 defects. Puppeteer compatibility, pending popup-name ownership, unsuccessful-event acknowledgement, and renderer-reload visibility still need concrete corrections before implementation proceeds.