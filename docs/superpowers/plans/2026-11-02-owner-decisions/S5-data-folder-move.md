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
   A failure part way leaves data split today: items move one by one and
   each source is removed (`data-dir-migrator.ts:78,153`) while the location
   pointer is written only afterwards (`handlers/settings.ts:104`). Copy every
   item first, write the pointer only when all are in place, delete sources
   last; on failure remove the copies and keep the old folder and pointer.
   (Same-filesystem `rename` may stay if completed renames are rolled back on
   failure.) Writing the pointer is the commit point. Before it: roll back
   copies and release the gate. After it: never touch the destination, keep
   the gate closed and restart; a failed source delete is only leftover
   cleanup (log it), not a rollback.
   The commit itself must be durable and loud: `writeDataLocation`
   (`data-dir-migrator.ts:45`) writes in place, and `config.ts:13` falls back
   to the base dir on a torn file, so write a temp file and rename it. Reset
   to default commits by removing the pointer, but `clearDataLocation`
   (`:52`) swallows errors: it must throw, so a failed removal counts as a
   pre-commit failure (roll back), not as committed.
   "adopt" mode (`handlers/settings.ts:97`) moves nothing but still switches
   folders: same gate, busy check, pointer commit and restart.
2. Before moving, refuse with a clear error if any session is running or a
   flow run is running/paused on this backend. UI shows it. A one-time check
   is not enough: the scheduler admits launches on its own
   (`scheduler-service.ts:223`) and store writes can recreate moved items
   mid-move. Hold a migration gate from the check until restart: the
   scheduler fires nothing, and session/flow starts and data writes are
   refused. Requests admitted before the gate can still finish during the
   move (`createSession` awaits store reads before it spawns,
   `session-lifecycle.ts:401`; `FlowStore.withMutation` bodies read then
   write, `flow-store.ts:127`). So: close admission, wait for in-flight
   launches and store mutations to drain, then run the busy check, then move.
   On a failure before the pointer commit, release the gate; after it, keep
   it closed (item 1).
3. After a successful move, the backend must come back on the new folder.
   Pick one, based on what Electron and a headless backend can do:
   - Electron respawns the backend (add a restart to `backend-manager`,
     triggered by a backend response flag or exit code), the UI reconnects;
   - or the UI tells the user to relaunch and Electron `app.relaunch()`s.
   A headless/remote backend (no Electron) must not be left half-switched.
   It cannot "keep serving the old folder" after the move: the migrator
   renames or copies-then-deletes (`data-dir-migrator.ts:78`), so the old
   paths are gone. Without a restarter, the move must be refused or deferred
   (e.g. recorded and done at next start before stores load). Do not move
   and keep serving. Remove the live TaskStore re-point if the restart
   makes it pointless.
   Respawn in Electron is not a socket reconnect: each start picks a new
   port and token from the handshake (`electron/src/main.ts:238`,
   `backend-manager.ts:111`), and the renderer's `Connection` has a fixed
   origin (`ui/src/lib/connection.ts:49`). Respawn would have to republish
   both to main and renderer; `app.relaunch()` avoids that and is the
   simpler choice unless there is a reason against it.
4. The "Data Folder Changed" alert text matches what happens.

Tests: migrator moves the new items; a failure after some items are copied
leaves the old folder complete and still configured; a source delete
failing after another source item was already deleted keeps the complete
new folder and the new pointer, the gate closed, and triggers the restart;
a failed pointer write or pointer removal (reset) leaves the old folder
selected at next start; a write and a launch
admitted before the gate finish before the move starts; the refusal while busy; a scheduled
launch and a data write during the move are refused; the no-restarter path
leaves data readable; adopt mode is gated and restarts; whatever restart signal is added. Owner check: change and reset the folder in the
packaged app.
