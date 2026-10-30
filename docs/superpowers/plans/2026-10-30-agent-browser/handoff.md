# Handoff: Agent-Drivable Internal Browser

Keep this file short. It is the only state carried between sessions. Update the row and add facts the next section needs. Don't add narrative.

Plan: `../2026-10-30-agent-browser.md`. Spec: `docs/superpowers/specs/2026-10-30-agent-browser-cdp-design.md`. Chain protocol: `chain.md`.

## Next step

Section 8.

## Status

| # | Section | Status | Commits |
|---|---|---|---|
| — | Plan review round 1 | done: 1 blocker and 14 majors confirmed and folded in; round 2 output saved | 3b82b51e |
| — | Plan review round 2 | done: 1 blocker, 7 majors, 1 minor + 1 own major confirmed and folded in; round 3 output saved | 0286d1f4 |
| — | Plan review round 3 | done: 1 blocker, 3 majors, 1 minor confirmed and folded in; round 4 output saved | 84c0815b |
| — | Plan review round 4 (cap) | done: 1 blocker, 2 majors, 1 minor confirmed and folded in; chain stopped for the user | cd1699ab |
| 1 | Spike (gate) | done: PASS, 3 clients × all criteria; plan amended | 3d910bb8, 7a57f492 |
| 2 | Shared types, store, host client, service | done: review had 1 finding (late `ensure` after close), confirmed and fixed | e78299eb, 0a8c1025, caf2df69, cdb54a6f |
| 3 | HTTP/WS API, wiring, cleanup hooks | done: review clean, no fixes | ac8169ba |
| 4 | CDP gateway | done: review had 1 finding (worker targets stalled the ordered stream), confirmed and fixed | e1ebcb34, 07e1af62 |
| 5 | Electron host | done: smoke test passed; review had 1 finding (client dropped the control url's secret prefix), plus 3 own; all confirmed and fixed | e46c0d85, 2f853a0f |
| 6 | UI | done: Sol stopped at Step 7 (bootstrap placement); 4 own fixes before commit; review had 1 finding (connection overlay not registered), confirmed and fixed | 30f1c8da, c3c85776 (+ the user-agent move landed in 29122909, see Facts) |
| 7 | CLI, doc, prompt | done: smoke check passed; review clean; 1 own finding (empty url saved while the first load is pending), confirmed and fixed | 9cdd8d03, 2286b550 |
| 8 | Manual verification, final review | not started | |

## Facts for the next section

- Section 7 outputs: both CLIs use `/api/browser/tabs` with the context headers and print the response JSON; `open`, the old `browser "<url>"` form, `list`, `close`, `--project`/`--master` (mutually exclusive) are implemented. The old task/project browser routes, `MSG.BROWSER_OPEN`, `BrowserOpenPayload` and the UI listener are gone. Every agent prompt carries the exact nudge.
- Section 7 smoke (Step 6c), sandboxed dev app as in the Section 5 smoke, project and task seeded over WS (`project:add`, `task:create`; the open UI only showed them after a renderer reload): the generated `<config>/bin/taskflow-cli browser open https://example.com --label Smoke` with `TASKFLOW_API_URL`/`TASKFLOW_TASK_ID` set → `{tab, endpoint}`; selecting the task shows the tab (label from the title, `Example Domain`); `browser close <id>` → `{"success":true}`, the UI tab and the Chromium target disappear; a second close → `{"error":"Browser tab not found"}` + exit 1; bare `browser` → usage, exit 1. The app's own renderer can be driven over the raw debug port from the `DevTools listening on ws://127.0.0.1:<port>/...` line in the Electron log (`Runtime.evaluate`, `Page.captureScreenshot`); scripts in this session's scratchpad aren't kept.
- Backend suite outside Sol's sandbox: 1088 pass, 0 fail (after Section 7).
- Base commit before implementation (final-review base): `91a3e89c`.
- Section 2 outputs: `browserTabLabel(url)` lives in `packages/shared/src/utils/browser-tab-label.ts` (exported from the shared index; `terminal-links.ts` uses it). `BrowserTabStore` exports `SavedBrowserTab`. The service's deps type is `BrowserTabServiceDeps` (not exported). The staleness timer re-checks 1 ms past 15000 ms, because availability includes the 15000 ms boundary.
- Section 3 outputs: `registerBrowserRoutes` (`api/routes/browser-routes.ts`) wraps each handler with an error→status mapper (400/404/503); Section 4 adds the `/cdp/:tabId/json*` routes there via a required `ApiRouteDeps.cdpGateway`. The service is built in `index.ts` right after `store.init()`; `browserTabService.init()` runs just before `server.start()`. Task/project route and handler deps take `browserTabService: Pick<BrowserTabService, "closeForOwner">`; `registerProjectHandlers` takes it positionally (4th arg).
- Section 4 outputs: `createCdpGateway({ service })` (`services/cdp/cdp-gateway.ts`, exports `CdpGateway`, `CdpSocketData`) is `createServer`'s 4th argument and `ApiRouteDeps.cdpGateway`. CDP sockets aren't app clients and get no broadcasts. `pageOfTabTarget` and `runOnRootPage` use separate short-lived upstream sockets. The filter denies recorded target types other than `page`/`tab` without a `resolveTarget` wait (workers, browser); nested attaches under allowed sessions still pass. `WebMCP.enable` is denied (unknown domain, Puppeteer tolerates it); no spike method needed a table addition.
- Host-side expectation for Section 5: any page target that isn't a tab (main window, park window, any other app window) must be in `appTargetIds`, or every decision about it costs a 2 s wait in the gateway's ordered stream.
- Section 5 outputs: `electron/src/browser-host/index.ts` exports `initBrowserHost`, `detachAll`, and `isParkWindow`. Preload exposes `window.taskflow.browser`; `browser:nav-state` sends separate `tabId` and state arguments. The factory reports every live BrowserWindow's renderer in `appTargetIds`, including the park window.
- Section 6 outputs: `useBrowserTabStore` (`byBackend[backendId]: BrowserTabListResponse`, `initialByBackend`, `fetchBrowserTabs`) and `backendHostsBrowser(...)` in `stores/browser-tab-store.ts`; the list is fetched in `backendStore.bootstrapBackend`. `syncBrowserTabs` runs from `session-subscriptions.ts` on every store change. `openHostedBrowserTab(workspaceKey, url, label)` (`lib/hosted-browser.ts`) returns null when the backend doesn't host. Registry tabs have id `browser:<tabId>`. The old `BROWSER_OPEN` listener in `session-subscriptions.ts` is still there for Section 7 to remove. `toChromeUserAgent` now lives only in `packages/shared/src/utils/chrome-user-agent.ts`.
- A concurrent t3code session committed this chain's staged files (the Electron `chrome-user-agent.ts` delete and its test's move to shared) inside its own commit `29122909`. HEAD is correct; that commit alone doesn't build Electron. Not rewritten, because the other session keeps committing to main. Stage and commit in one command (`git commit <paths>`) while another session shares the checkout.
- Section 5 notes: Electron tests can't import the backend's `expectRejects` (outside Electron's `rootDir`); they assert rejections inline. The backend host client now concatenates `controlUrl + path` (the control url ends in main's secret segment). The link sends a heartbeat on `browser-window-created`.
- Section 5 smoke test (sandbox: `TASKFLOW_DEV=1 TASKFLOW_CONFIG_DIR=<scratch> electron/node_modules/.bin/electron .` from `electron/` after `bun run build` at the root; backend port from the `Backend started on port` log line): `POST /api/browser/tabs` with `{"scope":"master"}` → 201; `/cdp/<id>/json/version` has the gateway `webSocketDebuggerUrl`; Playwright over the endpoint on a parked tab: `visibilityState` visible, rAF, 212 KB screenshot, click navigates; `DELETE` destroys the view.
- A raw CDP probe (no Playwright setup) sees a parked tab as `hidden`, with rAF and `Page.captureScreenshot` hanging. The spike's parked tab behaves the same; Playwright's session setup makes it visible. Section 8 should check Puppeteer on a parked tab too.
- Dev builds' UA keeps `TaskflowDev(main)/<v>` (only `Taskflow/<v>` is stripped, as in the old renderer rule). Section 8 item 15 should compare UAs on a packaged build or account for it.
- `load` (used by `open`, `openChild`, `ensureLoaded`) throws `BrowserTabNotFoundError` and closes the host view when the tab was closed while `ensure` was pending.
- Running Sol: `codex exec -m gpt-6.1-sol -s workspace-write -c sandbox_workspace_write.network_access=true --add-dir "$PWD/.git" -C "$PWD" -o <report> - < <brief>`. Without `--add-dir .git` it can't commit (`.git` is read-only under workspace-write). In its sandbox the backend process-stopper and watcher tests fail (19); rerun the suite yourself outside it.
- Spike facts: full detail in `spike/results.md` (method log, raw facts). Summary:
  - Debug port: `<userData>/DevToolsActivePort`, line 1 = port, line 2 = `/devtools/browser/<uuid>`; present right after `ready`.
  - Hidden views live in one hidden park window (1280×800). A view in no window has a 0×0 viewport; one removed from a window stops painting after a client reconnect. The park window's renderer goes in `appTargetIds`; any unlisted page target costs a 2 s `resolveTarget` wait.
  - Guest popups: wrap with `webPreferences` = tab prefs minus `partition` (none: preload lost; with `partition`: SIGSEGV on the next view). All popup kinds, `_blank` forms included, take the guest path. `window.opener` null for plain `_blank` and forms, set for `rel=opener` and `window.open`.
  - `disable-blink-features=AutomationControlled` is needed: remote debugging makes `navigator.webdriver` true and the preload can't reach the main world.
  - Contexts: tabs share one `browserContextId`, the app another; Chromium can't resolve the tabs' id. Context-scoped handling: download behaviour no-op `{}`, cookies via `Network.*` on the root page (`runOnRootPage`), permissions refused.
  - `Target.createTarget`: Electron says `Not supported`; intercept, hold the reply until the attach is forwarded, host awaits the `about:blank` load.
  - Tab targets: one per WebContents; the attach + nested auto-attach mapping works in 1–3 ms, also for paused new tabs.
  - Puppeteer sends `WebMCP.enable` per page session (denied, tolerated) and `Browser.close` on `browser.close()` (denied; forwarding it quits the app).
- Spike client installs (`playwright-core`, `puppeteer-core`) live outside the repo; Section 8 reinstalls them in a scratch dir. `uv run --no-project --with playwright python <file>` runs the Python client.
- `eslint.config.js` ignores `docs/superpowers/plans/**/spike/` (spike scripts aren't in any tsconfig).
- `bun test packages/ui` run as one command has pre-existing failures from `mock.module` leakage. Judge UI tests file by file.
- Tests asserting rejections use `expectRejects` from `packages/backend/tests/expect-rejects.ts`.
- Shell is zsh: `$F` file lists don't word-split. Pass files to eslint and prettier explicitly.
- Section order is now 2, 3, 4, 5, 6, 7 (round 2 changed it; `chain.md` updated).
- Electron v33.4.11 and Chromium 130 sources can be fetched from raw.githubusercontent.com (`electron/electron/v33.4.11/...`, `chromium/chromium/130.0.6723.191/...`) to check review claims.
- `bunx tsc --ignoreConfig --noEmit --strict --skipLibCheck --moduleResolution bundler --module esnext --target es2022 .probe/p.ts`, run from `electron/` with a throwaway `.probe/` dir, type-checks Electron API claims against the installed 33.4.11 typings.
- `electron/package.json` may carry an uncommitted version bump by the user. Don't commit it.

## Deviations from the spec

- Amendment 11 (spike): context-scoped commands aren't pinned to the tabs' context (impossible under Electron); download behaviour is a no-op, cookies go through the page, permissions are refused. Downloads aren't reported to agents.
