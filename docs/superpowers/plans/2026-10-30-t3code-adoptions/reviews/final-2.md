Changes required.

1. Authentication and client compatibility: none. The anonymous response returns before upgrades or routing. The checked header, method and path variants expose no bypass. Tunnel readiness still receives `"Taskflow backend"`, and the renderer offers both protocols, so refusing auth-only offers does not break it.

2. Schedule persistence: **Major — the File Provider fallback preserves the original race.** [schedule-store.ts:55](/Users/kuindji/Projects/taskflow/packages/backend/src/services/schedule-store.ts:55) calls a helper that performs a plain truncating write under macOS `~/Library/CloudStorage` at [write-file-atomic.ts:42](/Users/kuindji/Projects/taskflow/packages/backend/src/services/write-file-atomic.ts:42). If schedule B writes while A’s spawn resolves, A’s unlocked read can parse an empty file and close its successfully spawned session. Reproduced using the current store and scheduler with an in-memory filesystem: `Unexpected EOF`, followed by `closeSession("session-a")`. The normal rename path completed successfully with no temp files left.

3. Scheduled shell selection: none. `systemShellPath` can be null when detection returns no shells. It becomes `undefined`, and [session-lifecycle.ts:527](/Users/kuindji/Projects/taskflow/packages/backend/src/services/session-lifecycle.ts:527) throws `"shell path is required for shell sessions"`. The scheduler records the spawn failure and advances the schedule; there is no implicit shell fallback.

4. Tests: none beyond the persistence gap above. All 24 auth tests and both new socket regressions passed. The two changed auth tests failed against pre-fix code. Source inspection confirms the socket assertions and inode assertion reject their respective old behavior. Counterfactual socket execution and the filesystem suite were blocked by sandbox listener/temp-file restrictions.

No files edited.

