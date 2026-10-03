**Verdict: Changes required.** Eight round‑1 findings are resolved; five remain partially unresolved.

1. **Blocker — `SESSION_CLOSE` still bypasses move serialization.**  
   **Plan:** [03-move-api.md, Tasks 6–7, Step 3](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-03-move-session/03-move-api.md:585).  
   **Evidence:** [handlers/session.ts:75](/Users/kuindji/Projects/taskflow/packages/backend/src/handlers/session.ts:75) awaits direct owner removal before closing; [session-lifecycle.ts:230](/Users/kuindji/Projects/taskflow/packages/backend/src/services/session-lifecycle.ts:230) reads and mutates ownership outside the session queue.  
   Close can remove the source ref while a move is persisting its target, invalidating the move’s assumptions. Neither revised section changes this handler. **Fix:** add a queued lifecycle close operation and route `SESSION_CLOSE` through it. Keep an unlocked removal helper for already-queued exit cleanup. Round‑1 #1 remains partial.

2. **Blocker — Archive introduces an indirect lock cycle through native discovery.**  
   **Plan:** [02-owner-registry.md, Task 4, Step 3](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-03-move-session/02-owner-registry.md:244), and [03-move-api.md, Task 6, Step 3](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-03-move-session/03-move-api.md:585).  
   **Evidence:** archive awaits `failFlowByIds` at [handlers/task.ts:153](/Users/kuindji/Projects/taskflow/packages/backend/src/handlers/task.ts:153). FlowRunner holds its owner lock while awaiting launch at [flow-runner.ts:104](/Users/kuindji/Projects/taskflow/packages/backend/src/services/flow-runner.ts:104). Launch acquires the native-discovery lock at [session-lifecycle.ts:511](/Users/kuindji/Projects/taskflow/packages/backend/src/services/session-lifecycle.ts:511), released only after discovery’s persistence callback finishes at [line 722](/Users/kuindji/Projects/taskflow/packages/backend/src/services/session-lifecycle.ts:722).  
   Concrete cycle: a plain Codex session’s move waits for archive’s owner lock; archive waits for FlowRunner; FlowRunner’s launch waits for that session’s native lock; discovery now waits behind its move on the session queue. Progress depends on stale-lock takeover after 30 seconds, which also breaks launch exclusion. **Fix:** release the native launch lock once discovery finishes identifying the native ID, before awaiting queued metadata persistence. Add a barrier-controlled regression test.

3. **Major — Rollback is still inconsistent, including after a single Master write failure.**  
   **Plan:** [03-move-api.md, Task 5, Step 3](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-03-move-session/03-move-api.md:396).  
   **Evidence:** [task-store.ts:238](/Users/kuindji/Projects/taskflow/packages/backend/src/services/task-store.ts:238) pushes into the Master cache before persistence; [line 245](/Users/kuindji/Projects/taskflow/packages/backend/src/services/task-store.ts:245) similarly removes before persistence.  
   A failed target Master write leaves a cached duplicate, while the move only reverses the log rename. A failed source Master removal leaves the registry naming Master but its cached ref missing. Separately, swallowed undo failures can leave duplicate refs or output split across owners. **Fix:** make Master mutations restore/reload their cache on failure, and define recoverable handling for failed undo rather than logging and continuing normally. Test both Master directions and correlated persistence failures. Round‑1 #2 remains partial.

4. **Major — Shutdown redirects queued output back to the original owner.**  
   **Plan:** [02-owner-registry.md, Task 4, Step 3, `onExit`](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-03-move-session/02-owner-registry.md:196).  
   **Evidence:** [pty-manager.ts:295](/Users/kuindji/Projects/taskflow/packages/backend/src/services/pty-manager.ts:295) flushes output before calling `onExit`; shutdown closes PTYs at [index.ts:568](/Users/kuindji/Projects/taskflow/packages/backend/src/index.ts:568).  
   The proposed shutdown exit branch deletes `owners` synchronously. Any pending append subsequently evaluates `ownerNow()` and falls back to `spawnOwner`, recreating the old log after a successful move. I reproduced this ordering in memory. **Fix:** retain the current owner through the output drain, or queue deregistration after pending appends. Round‑1 #4 remains partial.

5. **Major — Shutdown still admits and overlooks creates/resumes.**  
   **Plan:** [03-move-api.md, Task 5, Step 3, `prepareForShutdown`](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-03-move-session/03-move-api.md:330).  
   **Evidence:** [session-lifecycle.ts:298](/Users/kuindji/Projects/taskflow/packages/backend/src/services/session-lifecycle.ts:298) admits creation; spawning precedes persistence at [line 529](/Users/kuindji/Projects/taskflow/packages/backend/src/services/session-lifecycle.ts:529), and resume calls creation at [line 779](/Users/kuindji/Projects/taskflow/packages/backend/src/services/session-lifecycle.ts:779).  
   Only moves are gated and tracked. An already-started create/resume can persist a live ref after shutdown has visited its owner. **Fix:** gate create/resume admission and await admitted registrations before marking sessions interrupted. This is another outstanding part of round‑1 #4.

6. **Major — Owner coordination does not cover concurrent instances sharing storage.**  
   **Plan:** [01-store-log-move.md, Task 2, Step 3](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-03-move-session/01-store-log-move.md:370).  
   **Evidence:** [config.ts:28](/Users/kuindji/Projects/taskflow/packages/backend/src/config.ts:28) shares projects, tasks and archives between instances. Existing task mutations acquire cross-process file locks at [task-store.ts:981](/Users/kuindji/Projects/taskflow/packages/backend/src/services/task-store.ts:981).  
   The new owner queue exists only within one `TaskStore`. A dev-instance archive/delete can therefore mutate a main-instance move’s source or target between its persisted steps. Individual file locks do not protect the complete transaction. **Fix:** coordinate owner operations across processes using separate shared owner-lock paths, acquired in sorted order. Do not reuse record mutation locks recursively.

7. **Major — Cached file-link activation still uses the old owner.**  
   **Plan:** [06-links-and-verify.md, Task 10, Step 3](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-03-move-session/06-links-and-verify.md:141).  
   **Evidence:** [terminal-link-provider.ts:125](/Users/kuindji/Projects/taskflow/packages/ui/src/components/panes/terminal/terminal-link-provider.ts:125) captures `workspaceKey`; activation passes captured owner IDs at [line 168](/Users/kuindji/Projects/taskflow/packages/ui/src/components/panes/terminal/terminal-link-provider.ts:168). Those determine file-stat routing and editor ownership at [line 260](/Users/kuindji/Projects/taskflow/packages/ui/src/components/panes/terminal/terminal-link-provider.ts:260).  
   The revision updates cwd and web links, but file links still open in the source workspace. Deleting that source can make backend lookup return null and links stop working. **Fix:** resolve the current workspace/backend and owner when providing and activating file links, including bare-name links and Master. Round‑1 #11 remains partial.

8. **Major — Two proposed tests fail deterministically; race tests remain timing-dependent.**  
   **Plan:** [01-store-log-move.md, Task 2, Step 1](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-03-move-session/01-store-log-move.md:287), and [03-move-api.md, Task 5, Step 1](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-03-move-session/03-move-api.md:154).  
   The owner-lock test expects the first `[a,b]` operation to reserve B immediately. Nested acquisition reserves B later, so the reproduced result before release is `["archive b", "archive c"]`. The native-ID test resolves discovery and immediately drains an empty queue; the discovery callback enqueues persistence afterward. The archive/delete tests’ 10 ms sleeps also cannot guarantee acquisition order across the awaited file operations at [task-store.ts:1007](/Users/kuindji/Projects/taskflow/packages/backend/src/services/task-store.ts:1007).  
   **Fix:** use explicit acquisition/persistence barriers and await the discovery write’s completion. The rollback `spyOn` snippets type-check against the current, non-overloaded `updateTask`.

9. **Major — Invalid drops on sidebar chrome still reach workspace movement.**  
   **Plan:** [05-ui-drag.md, Task 9, Step 5](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-03-move-session/05-ui-drag.md:754).  
   **Evidence:** the marker covers only the scrolling list at [TaskSidebar.tsx:443](/Users/kuindji/Projects/taskflow/packages/ui/src/components/sidebar/TaskSidebar.tsx:443). The top toolbar at [line 411](/Users/kuindji/Projects/taskflow/packages/ui/src/components/sidebar/TaskSidebar.tsx:411) and bottom toolbar at [line 476](/Users/kuindji/Projects/taskflow/packages/ui/src/components/sidebar/TaskSidebar.tsx:476) remain outside it.  
   Dropping there returns “outside sidebar” and permits `closestCenter`-based reordering or pane movement. **Fix:** mark the complete sidebar region, preserving the existing scrolling layout, and test both toolbar drops. Round‑1 #9 remains partial.

Round‑1 findings resolved:

- **#3:** repair of the normal persisted crash windows.
- **#5:** registration after create/resume persistence.
- **#6:** history reads joining the session queue.
- **#7:** overlay-safe hit-testing.
- **#8:** actual pointer coordinates.
- **#10:** Master movable refresh and safe array copying.
- **#12:** dependency injection replacing shared-module mocks.
- **#13:** repeated-target and positional CLI validation.

The current session-tab producers use the session ID as the tab ID. The pointer listener and EventTarget injection fit the current PointerSensor and DOM preload. `--` inside a session ID survives the repair parser; generated owner IDs are UUIDs.

No files were modified. Verification used source inspection, isolated in-memory reproductions, and a virtual TypeScript check. Package suites were not run.

