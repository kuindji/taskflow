# Round 1 triage

Source: `round-1.md` (gpt-6.1-sol, read-only). Each finding was checked against the code.

1. **confirmed, blocker.** `Target.sendMessageToTarget` and `flatten:false` attach fall under "everything else: forward". The tunneled messages carry no envelope `sessionId`, so the session check never sees them.
2. **confirmed in part, major.** Browser-level default-forward is too broad. Two problems:
   - `Tracing.*` at browser level is browser-wide.
   - Context-scoped commands with no `browserContextId` (`Browser.setDownloadBehavior`, `grantPermissions`, `Storage.*Cookies`) act on Electron's default session, which is the app's session, not `persist:browser`.

   Fix: an explicit browser-level allowlist, and the spike records context ids.
   **Rejected:** the `DOM.setFileInputFiles` and `file://` parts. The agent already runs with the user's shell and filesystem, and Playwright's `setInputFiles` must work.
3. **confirmed, major.** `ws/server.ts:74` upgrades on any path, so `/cdp/A/devtools/page/B` would become an app socket. That isn't an escalation (`/` already gives the same), but a misrouted client silently gets app traffic. Fix: reserve `/cdp/`.
4. **confirmed, major.** `createWindow(options: BrowserWindowConstructorOptions)` in `electron.d.ts:18375`; that type has no `webContents` field. Electron's no-guest path (noopener, which `target=_blank` implies) leaves loading to the callback.
5. **confirmed, major.** The heartbeat closes unknown loaded entries, and children are never saved. So a backend restart, or a heartbeat that overtakes `child-opened`, kills live children.
6. **confirmed, major.** `TabContent.tsx:157` passes only `initialUrl`, and Section 6 doesn't list `TabContent`.
7. **confirmed, major.** The `TabHost` class lacks `navigate`, `back`, `forward` and `reload`, but the IPC is said to map one-to-one.
8. **confirmed, major.** The removal rule in `syncBrowserTabs` has no backend boundary, so an empty list from a remote backend would remove the local tabs. `session-store.ts:60` already scopes keys per backend.
9. **confirmed, major.** `button.tsx:73` `InlineTooltip` portals separately. The browser toolbar uses it (`BrowserPane.tsx:149`).
10. **confirmed, major.** The WS `PROJECT_REMOVE` handler (`handlers/project.ts:54`) removes a project without the `PROJECT_REMOVED` broadcast.
11. **confirmed, major.** `createServer` is called at `index.ts:118`, task/project handlers at `:297`, and `devServerService` at `:369`. The plan's order is cyclic.
12. **confirmed, major.** Task 2.2 imports errors from a file that Task 2.3 creates.
13. **confirmed, major.** Section 3 removes routes that the CLI uses until Section 7, and `routes.test.ts:209` plus `taskflow-cli.test.ts:230` exercise them.
14. **confirmed, major.** `api_request` (`taskflow-cli.sh:66-71`) prints the body to stdout and `Error: <m> <url> returned <code>` to stderr. The TS bin (`taskflow-cli-bin.ts:44-47`) prints the body to stderr.
15. **confirmed, major.** Quitting the app kills the backend (`main.ts:281`), and nothing restarts a killed backend (`backend-manager.ts:108`). Item 7 also closes A before item 8 needs it.

Own finding (minor): `terminal-links.ts:73-77` falls back to the raw URL when parsing fails, not `Browser`. Section 2 now keeps the raw-URL fallback.

Outcome: blocker plus majors confirmed, so round 2 runs.
