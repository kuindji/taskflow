Changes required. Recovery can remain stuck on a stale established tunnel, and repeated host-key failures reopen dismissed blocking dialogs. Focused tests and workspace typechecks passed but do not cover these cases.

Full review comments:

- [P2] Rebuild stale live tunnels during recovery — /Users/kuindji/Projects/taskflow/packages/ui/src/stores/backend-store.ts:584-586
  If the backend restarts onto a new port after automatic recovery opens SSH but before the WebSocket handshake or bootstrap completes, the failed attach leaves an established tunnel forwarding to the old port. Later attempts reuse it because `openTunnel` returns established tunnels without probing again, so the new port-refresh fallback never runs. This branch also bypasses manual Retry's tunnel teardown, leaving recovery stuck until detach/reattach. Allow recovery to invalidate an unusable live tunnel while preserving attachment intent.

- [P2] Preserve host-key dialog dismissal across automatic retries — /Users/kuindji/Projects/taskflow/packages/ui/src/stores/backend-store.ts:293-295
  When a recovering remote reports an unknown or changed host key, each automatic attempt replaces the failure with a new object. `MachinesMenu` records dismissed failures by object identity, so closing the dialog only dismisses that attempt: the next retry opens the blocking dialog again, indefinitely. I reproduced the dialog reopening after dismissal on the next automatic attempt. Deduplicate unchanged failures or track dismissal by machine and failure signature.
