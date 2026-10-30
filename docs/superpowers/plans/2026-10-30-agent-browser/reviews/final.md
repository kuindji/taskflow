**Changes required. Four major findings.** Reviewed `91a3e89c..4a0807fe`, excluding docs, against the spec amendments and accepted deviations.

1. **Major. CDP request-ID reuse exposes other targets.** [cdp-filter.ts:120](/Users/kuindji/Projects/taskflow/packages/backend/src/services/cdp/cdp-filter.ts:120), [response filtering:306](/Users/kuindji/Projects/taskflow/packages/backend/src/services/cdp/cdp-filter.ts:306)  
   Send `Target.getTargets` with ID `1`, then `Browser.getVersion` with the same ID before the first reply. The second request overwrites the recorded method, so the `getTargets` reply bypasses filtering. A filter-level reproduction returned other-task and app-window target IDs and URLs. This exposes target information; it does not demonstrate cross-tab control.  
   **Fix:** reject duplicate outstanding IDs, or assign unique upstream IDs and map replies back. Drop unrecognized replies instead of forwarding them unfiltered.

2. **Major. Child creation during close leaves an orphan.** [browser-tab-service.ts:142](/Users/kuindji/Projects/taskflow/packages/backend/src/services/browser-tab-service.ts:142), [openChild:245](/Users/kuindji/Projects/taskflow/packages/backend/src/services/browser-tab-service.ts:245)  
   Closing snapshots the family, then awaits host/store operations while the parent remains available to `openChild`. A concurrent `Target.createTarget` can add a child outside that snapshot. After close finishes, the child remains loaded with a missing parent. The in-memory reproduction also showed that subsequent `closeForOwner` skips it because it only closes roots.  
   **Fix:** mark the family closing before the first await, reject new children and popup adoption beneath it, and recheck parent validity after creation completes.

3. **Major. A timed-out capture can block every later freeze.** [electron-views.ts:168](/Users/kuindji/Projects/taskflow/electron/src/browser-host/electron-views.ts:168)  
   If Chromium’s first capture never settles, its caller receives `""` after three seconds, but `captureTail` remains pending. The next capture waits for that tail **before starting its deadline**. After the pane is shown again, another overlay therefore waits indefinitely for `freeze`, leaving the native view above the overlay. A probe using the extracted capture implementation reproduced this.  
   **Fix:** start each caller’s deadline immediately, including queue time, while retaining serialization of the actual Chromium captures.

4. **Major. Promoting a backend can leave its master browser tabs missing.** [session-subscriptions.ts:174](/Users/kuindji/Projects/taskflow/packages/ui/src/stores/session-subscriptions.ts:174)  
   When returning to the local backend, its browser list can arrive before it becomes primary. Master tabs are ignored at that point. Promotion does not rerun synchronization, and unchanged heartbeats do not broadcast, so those tabs remain absent until another registry change. Reproduced with the actual stores.  
   **Fix:** subscribe to primary changes and reconcile master browser tabs from the cached registry when promotion occurs.

No additional findings in heartbeat staleness, restart reconciliation, CDP method restrictions/nested sessions/socket cleanup, control-server authentication, popup ownership, permission/protocol policy, hosted positioning, or fallback rendering. No CLI parity defects or specified project-rule violations found.

Validation passed: **297 focused tests**, workspace typechecking, ESLint on 89 changed TS/TSX files, and `sh`/`dash` syntax checks. Live Electron acceptance checks were not run. No repository changes made.