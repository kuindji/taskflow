# Round 2 triage

Source: `round-2.md` (gpt-6.1-sol, read-only, against 3b82b51e). Electron v33.4.11 sources (`guest-window-manager.ts`, `api/web-contents.ts`) and Chromium 130 (`render_frame_devtools_agent_host.cc`, `browser_handler.cc`) were fetched and checked. Local code checked in the repo.

Part A (round-1 fixes): agreed. The "not fully" rows are B1, B3–B4, B6, B8 and B9 below.

1. **confirmed, blocker.** `render_frame_devtools_agent_host.cc:337-340` adds `BrowserHandler` to every page session. `browser_handler.cc` implements `Crash` (:566), `CrashGpuProcess` (:571), `SetPermission` (:336), `Grant/ResetPermissions`, `SetDownloadBehavior`, `CancelDownload`, `GetHistograms`, `GetBrowserCommandLine`. `FindBrowserContext` (:303) picks the default context when the id is omitted. Rule 5 forwards all of these on an allowed session. Fix: the `Browser` domain is classified at every level, and context-scoped commands are pinned at every level.
2. **confirmed, major.** `_blank` implies `noopener`, so criterion 4's "non-null opener" can't pass for that link. `WebContentsViewConstructorOptions` (`electron.d.ts:21892`) has no opener, so a no-guest view has no `openerId` and the spike's opener-only filter would hide it. Fix: per-kind opener expectations; spike registers children through its side channel.
3. **confirmed, major.** `web-contents.ts` `-will-add-new-contents` builds the guest's prefs from `overrideBrowserWindowOptions.webPreferences` and calls `_setNextChildWebPreferences` before `createWindow` runs. The inherited list (`guest-window-manager.ts` `securityWebPreferences`) has no preload or `backgroundThrottling`. Fix: return the shared prefs in `overrideBrowserWindowOptions`.
4. **confirmed, major.** Electron's own no-guest path (`guest-window-manager.ts:86-94`) adds `extraHeaders: formatPostDataHeaders(postData)`. `PostBody` has `contentType` and `boundary` (`electron.d.ts:9749`). Fix: build `extraHeaders` from them.
5. **confirmed, major.** Replies to session commands must carry the `sessionId`. The plan's intercept replies and rule-6 errors (except rule 1) drop it. Fix: one reply helper that copies `id` and `sessionId`.
6. **confirmed, major.** Order 2,3,4,5,7,6: Section 7 removes `session-subscriptions.ts:164` (the UI listener that makes CLI tabs visible) before Section 6 adds the registry sync. Fix: run Section 6 before 7 (order 2,3,4,5,6,7), so the old listener goes only once the replacement exists. Section 2:7's stale "Section 3 removes it" corrected.
7. **confirmed, major.** `ApiRouteDeps` (`routes.ts:34`) is the only way route handlers get dependencies; the gateway goes to `createServer` only. Fix: Section 4 adds `cdpGateway` to `ApiRouteDeps` and passes it to the browser routes.
8. **confirmed, major.** `config.ts:196` port is `0` unless `TASKFLOW_DEV_PORT`; `backend-manager.ts:109-120` gives only a port file. A restart changes the endpoint's port. Fix: spec amendment (stable id and path, rediscover with `browser list`); Section 8 item 9 updated.
9. **confirmed, minor.** Idempotent `ensure` sends no navigation event, so a remounted toolbar never learns `canGoBack` (today `BrowserPane.tsx:46` samples it on ready). Fix: `TabHost.show` emits `navState` after showing.

Own finding (major): on the no-guest path Electron calls `createWindow({ webContents: guest, ...options })` with `guest` undefined (`guest-window-manager.ts:63-66`). The key is present, so the plan's `"webContents" in options` guard is always true. The guard must check the value is a defined `WebContents`. Also, the returned contents must be `guest` itself in the guest path, or Electron throws (`:68-70`).

Outcome: blocker plus majors confirmed, so round 3 runs.
