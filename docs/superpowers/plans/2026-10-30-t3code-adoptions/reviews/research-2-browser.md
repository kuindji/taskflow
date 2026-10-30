## 1. Area summary

**Yes: take several safeguards and small utilities. Keep Taskflow’s planned architecture.**

Taskflow currently embeds a renderer-owned `<webview>`, with an iframe fallback and local navigation state in [BrowserPane.tsx](/Users/kuindji/Projects/taskflow/packages/ui/src/components/panes/BrowserPane.tsx). Agent requests broadcast a tab-opening event; they cannot drive the page. [DevServerService](/Users/kuindji/Projects/taskflow/packages/backend/src/services/dev-server-service.ts) registers processes and stops them, without browser integration.

The [browser plan](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-30-agent-browser.md) moves ownership into Electron main and exposes filtered CDP endpoints. The latest [spike results](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-30-agent-browser/spike/results.md) record passes for all three clients.

t3code retains renderer-hosted webviews in [ElectronBrowserHost.tsx](/private/tmp/claude-501/-Users-kuindji-Projects-taskflow/a90ec5a2-57b9-413a-872d-9cafb1dba92a/scratchpad/src/t3code/apps/web/src/browser/ElectronBrowserHost.tsx). Its server drives desktop pages through a synthetic CDP relay, or launches headless Chromium, then exposes browser operations through MCP.

## 2. Recommendations

1. **Extend verification for input reaching the wrong window. Effort S for tests; M if adaptation is needed.**

   t3code’s [GuestInput.ts](/private/tmp/claude-501/-Users-kuindji-Projects-taskflow/a90ec5a2-57b9-413a-872d-9cafb1dba92a/scratchpad/src/t3code/apps/desktop/src/preview/GuestInput.ts) intercepts keyboard input when a guest lacks focus, checks cross-site iframe focus before using Electron input APIs, and routes reload through `webContents`.

   Taskflow’s spike exercises typing and hidden clicks, but does not explicitly assert that a focused Taskflow text field remains untouched while an agent types into a hidden page. Add that case, cross-origin iframe typing, and page reload to **§08-verify**. If failures reproduce with `WebContentsView` and remote CDP, adapt the relevant helper into **§04/§05**. Copy test scenarios first; avoid blindly copying webview-specific workarounds. This directly supports ordinary CLI-driven browser clients.

2. **Bound overlay screenshots and investigate capture serialization. Effort M; reimplement the mechanism.**

   [DesktopBrowserHost.ts](/private/tmp/claude-501/-Users-kuindji-Projects-taskflow/a90ec5a2-57b9-413a-872d-9cafb1dba92a/scratchpad/src/t3code/apps/desktop/src/preview/DesktopBrowserHost.ts) queues `Page.captureScreenshot` per page and drops queued work belonging to released connections. Its comments describe Chromium crashes involving overlapping capture and renderer exit. [Manager.ts](/private/tmp/claude-501/-Users-kuindji-Projects-taskflow/a90ec5a2-57b9-413a-872d-9cafb1dba92a/scratchpad/src/t3code/apps/desktop/src/preview/Manager.ts) bounds `capturePage()` attempts and checks guest identity after awaiting.

   Taskflow’s **§05 `freeze()` and §06 overlay handling** specify visibility generations, but no capture deadline or failure fallback. Add those explicitly. Extend **§08** with concurrent screenshots, navigation during capture, and tab closure. Consider per-target serialization in **§04** if reproduced. A timeout does not cancel Chromium’s capture, so do not treat it as proof that another capture can safely start.

3. **Define browser-session permissions explicitly. Effort S–M; reimplement policy.**

   t3code’s [BrowserSession.ts](/private/tmp/claude-501/-Users-kuindji-Projects-taskflow/a90ec5a2-57b9-413a-872d-9cafb1dba92a/scratchpad/src/t3code/apps/desktop/src/preview/BrowserSession.ts) installs both permission-request and permission-check handlers, with origin-based clipboard decisions and external-protocol confirmation.

   Taskflow’s [window-manager.ts](/Users/kuindji/Projects/taskflow/electron/src/window-manager.ts) hardens attached webview preferences but installs no equivalent handlers. **§04’s refusal of CDP permission commands does not define what websites themselves may request.** Add session initialization and a deliberate permission policy to **§05**, with clipboard and external-protocol checks in **§08**. Reuse the handler pattern, not t3code’s exact allowlist. This concerns hosting websites, independent of agent orchestration.

4. **Revisit mandatory user-agent stripping. Effort S; adopt the compatibility check.**

   Taskflow’s current `BrowserPane.tsx` strips Electron/app tokens; **§05** carries that forward. t3code’s `BrowserSession.ts` explicitly avoids rewriting Electron’s native UA because its implementation records Turnstile integrity failures.

   Change **§05/§08** to compare native and stripped UA behavior on intended login/challenge sites before making stripping mandatory. Keep this separate from the already-tested `navigator.webdriver` switch. The source establishes a compatibility warning, not proof that Taskflow encounters the same failure.

5. **Optionally port bounded history/favicon utilities after v1. Effort M; selective code port.**

   [browserHistoryStore.ts](/private/tmp/claude-501/-Users-kuindji-Projects-taskflow/a90ec5a2-57b9-413a-872d-9cafb1dba92a/scratchpad/src/t3code/apps/web/src/browserHistoryStore.ts) strips URL credentials, deduplicates visits, and caps storage. [FaviconCapture.ts](/private/tmp/claude-501/-Users-kuindji-Projects-taskflow/a90ec5a2-57b9-413a-872d-9cafb1dba92a/scratchpad/src/t3code/apps/desktop/src/preview/FaviconCapture.ts) bounds candidates, response bytes and capture time.

   Taskflow has navigation history but no recent-URL picker or favicon pipeline. Add an optional **§02/§05/§06 follow-up**, scoped by backend/project. Port small utilities with MIT attribution; exclude t3code’s thread/grouping machinery. Useful workspace polish, without agent APIs.

## 3. Considered and rejected

- **Wholesale CDP relay replacement:** [CdpRelay.ts](/private/tmp/claude-501/-Users-kuindji-Projects-taskflow/a90ec5a2-57b9-413a-872d-9cafb1dba92a/scratchpad/src/t3code/apps/desktop/src/preview/CdpRelay.ts) synthesizes one page and lacks Taskflow’s required creation/popup-family behavior. Keep the now-spiked gateway.
- **Renderer webview hosting and painting choreography:** Taskflow’s main-owned views and tested park window better match renderer-reload survival.
- **MCP automation broker, HTML-render attachments and MCP Apps:** these introduce host-managed browser operations or chat artifacts. Standard CDP already gives Taskflow agents access.
- **Native browser-secret/cookie import:** useful only for a separately requested login-import feature.
- **Port scanning:** keep explicit dev-server registration; copying the scanner adds substantial scope.

## 4. Uncertainties

Read-only source comparison; I ran no browsers or tests. t3code uses Electron 44, while Taskflow’s spike used 33.4.11. Input and capture workarounds require reproduction on Taskflow’s hosting model before porting.