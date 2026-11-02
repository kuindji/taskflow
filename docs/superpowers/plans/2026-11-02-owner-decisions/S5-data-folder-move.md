# S5 — Data folder change moves everything, then restarts (A01 R1-2)

Decision: move every data-folder item, then restart the backend rather than
re-point stores live. Refuse the change while sessions or flow runs are
active.

Today:
- `packages/backend/src/services/data-dir-migrator.ts:22` `DATA_ITEMS` moves
  `projects.json`, `tasks`, `archive`, `task-logs`, `session-logs`,
  `sessions`, `themes`. Missing: `flows/` (holds `actions.json`,
  `builtin-actions.json`), `flow-runs/`, `schedules.json`,
  `notifications.json`. Check `config` in the backend for any other path
  under `dataDir` (grep `dataDir` in the config builder) and include it.
- `packages/backend/src/handlers/settings.ts` runs the change and re-points
  only TaskStore. FlowStore, ScheduleStore, NotificationStore, ThemeService
  (built in `packages/backend/src/index.ts:125-392`) keep old paths.
- UI: `packages/ui/src/components/settings/SettingsModal.tsx:137-250`
  (confirm, change, reset, "Data Folder Changed" alert).
- Electron: `electron/src/backend-manager.ts` has `startBackend` and no
  respawn.

Work:
1. Add the missing items to `DATA_ITEMS`; keep the existing conflict
   handling for a destination that already has data.
2. Before moving, refuse with a clear error if any session is running or a
   flow run is running/paused on this backend. UI shows it.
3. After a successful move, the backend must come back on the new folder.
   Pick one, based on what Electron and a headless backend can do:
   - Electron respawns the backend (add a restart to `backend-manager`,
     triggered by a backend response flag or exit code), the UI reconnects;
   - or the UI tells the user to relaunch and Electron `app.relaunch()`s.
   A headless/remote backend (no Electron) must not be left half-switched:
   if it cannot restart itself, it must say so and keep serving the old
   folder until restarted. Remove the live TaskStore re-point if the restart
   makes it pointless.
4. The "Data Folder Changed" alert text matches what happens.

Tests: migrator moves the new items; the refusal while busy; whatever
restart signal is added. Owner check: change and reset the folder in the
packaged app.
