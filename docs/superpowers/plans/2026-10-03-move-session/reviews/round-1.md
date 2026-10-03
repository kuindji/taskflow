Verdict: **Changes required**. The plan has concrete backend consistency gaps and a drag implementation that will miss sidebar targets.

1. **Blocker — Archive/delete/close operations bypass the move lock.**  
   **Plan:** [03-move-api.md, Task 4, Step 3](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-03-move-session/03-move-api.md:321).  
   **Evidence:** [handlers/task.ts:57](/Users/kuindji/Projects/taskflow/packages/backend/src/handlers/task.ts:57) clears sessions and closes IDs from a previously read task; [handlers/project.ts:56](/Users/kuindji/Projects/taskflow/packages/backend/src/handlers/project.ts:56) similarly closes a snapshot; [handlers/session.ts:73](/Users/kuindji/Projects/taskflow/packages/backend/src/handlers/session.ts:73) removes ownership before closing, outside the registry queue. [task-store.ts:1117](/Users/kuindji/Projects/taskflow/packages/backend/src/services/task-store.ts:1117) deletes all source-task logs.
   
   A source archive can read the session, let the move finish, and then kill the moved PTY. A target archive can read an empty list, accept the moved ref, and archive it without closing the process. Source deletion between ref removal and log rename can delete the moved session’s transcript.
   
   **Fix:** Add shared coordination between moves and owner archive/delete/project removal, covering owner reads through mutation and PTY-close decisions. Serialize `SESSION_CLOSE` through the session queue. Use an unlocked cleanup helper inside queued exit handling to avoid recursive locking. Add barrier-controlled tests for these interleavings.

2. **Blocker — A failed move leaves metadata and the registry pointing to different owners.**  
   **Plan:** [03-move-api.md, Task 4, Step 3](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-03-move-session/03-move-api.md:337); [01-store-log-move.md, Task 1, Step 4](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-03-move-session/01-store-log-move.md:112).  
   **Evidence:** [task-store.ts:1007](/Users/kuindji/Projects/taskflow/packages/backend/src/services/task-store.ts:1007) can reject an owner update; existing filesystem code explicitly handles permission failures at [write-file-atomic.ts:51](/Users/kuindji/Projects/taskflow/packages/backend/src/services/write-file-atomic.ts:51).
   
   If log rename fails, the ref has already left the source and entered the target, but the registry still names the source. Subsequent output continues into the source log, another move cannot find its ref, and task-owned exit cleanup can leave the target ref behind.
   
   **Fix:** Specify rollback or recoverable completion for every mutation failure. Preserve one authoritative owner and its transcript before returning an error. Test failure of target persistence, source persistence, and log rename.

3. **Major — Boot reconciliation does not provide the promised crash recovery.**  
   **Plan:** [03-move-api.md, Task 4, Step 3](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-03-move-session/03-move-api.md:313).  
   **Evidence:** [task-store.ts:265](/Users/kuindji/Projects/taskflow/packages/backend/src/services/task-store.ts:265) reconciles each list independently and retains interrupted agent refs. [session-lifecycle.ts:730](/Users/kuindji/Projects/taskflow/packages/backend/src/services/session-lifecycle.ts:730) finds the first matching owner. [task-store.ts:188](/Users/kuindji/Projects/taskflow/packages/backend/src/services/task-store.ts:188) sweeps logs by owner-plus-session key.
   
   A crash after target insertion leaves two restore entries; reconciliation does not deduplicate them. A crash after source removal but before rename leaves only the target ref, and the boot sweep deletes the source log containing the transcript.
   
   **Fix:** Add a durable move record and recover it before reconciliation and sweeping, or another explicit recovery protocol that resolves both duplicate ownership and log location. Test restart after each persisted move step.

4. **Major — Shutdown neither excludes moves nor drains the new queues.**  
   **Plan:** [02-owner-registry.md, Task 3, Step 3](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-03-move-session/02-owner-registry.md:242), plus Task 4’s unrestricted `moveSession`.  
   **Evidence:** [session-lifecycle.ts:801](/Users/kuindji/Projects/taskflow/packages/backend/src/services/session-lifecycle.ts:801) marks sessions interrupted immediately; [task-store.ts:315](/Users/kuindji/Projects/taskflow/packages/backend/src/services/task-store.ts:315) traverses owners separately; [index.ts:561](/Users/kuindji/Projects/taskflow/packages/backend/src/index.ts:561) closes PTYs and eventually calls `process.exit`. PTY cleanup flushes final output at [pty-manager.ts:292](/Users/kuindji/Projects/taskflow/packages/backend/src/services/pty-manager.ts:292).
   
   An in-flight move can insert its captured live ref into an owner already processed by shutdown, or still be partially persisted when the process exits. Final output can remain queued when shutdown finishes.
   
   **Fix:** Stop admitting moves/creates/resumes, await in-flight ownership mutations, then mark interrupted. Drain output after PTY closure before exiting. Add shutdown tests with a paused move and pending final output.

5. **Major — Moving during resume can transfer the old interrupted ref.**  
   **Plan:** [02-owner-registry.md, Task 3, Step 3](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-03-move-session/02-owner-registry.md:294); [03-move-api.md, Task 4, Step 3](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-03-move-session/03-move-api.md:321).  
   **Evidence:** [session-lifecycle.ts:529](/Users/kuindji/Projects/taskflow/packages/backend/src/services/session-lifecycle.ts:529) spawns before writing the updated live ref at [session-lifecycle.ts:605](/Users/kuindji/Projects/taskflow/packages/backend/src/services/session-lifecycle.ts:605). Resume retains the same session ID at [session-lifecycle.ts:779](/Users/kuindji/Projects/taskflow/packages/backend/src/services/session-lifecycle.ts:779).
   
   During that interval, the registry and PTY exist while storage still contains the interrupted ref. The move can copy its old state and boot ID to the target, then remove the freshly updated source ref.
   
   **Fix:** Gate moves until creation/resume registration completes, or serialize registration ahead of move admission. Test a move while the resume ref update is suspended.

6. **Major — History reads overtake output queued by `onData`.**  
   **Plan:** [02-owner-registry.md, Task 3, Step 3](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-03-move-session/02-owner-registry.md:314).  
   **Evidence:** [handlers/session.ts:120](/Users/kuindji/Projects/taskflow/packages/backend/src/handlers/session.ts:120) reads history directly. [task-store.ts:717](/Users/kuindji/Projects/taskflow/packages/backend/src/services/task-store.ts:717) registers append work only when called. Existing tests emit output and immediately read it at [session.test.ts:376](/Users/kuindji/Projects/taskflow/packages/backend/tests/handlers/session.test.ts:376) and [session.test.ts:427](/Users/kuindji/Projects/taskflow/packages/backend/tests/handlers/session.test.ts:427).
   
   The new outer promise queue delays that call. An immediate history read reserves the log queue first and returns without the preceding output. An in-memory reproduction using the proposed registry confirmed this ordering.
   
   **Fix:** Put session-history reads behind the same session queue through a lifecycle method, including REST consumers. Preserve the existing immediate-read tests.

7. **Blocker — The drag overlay intercepts sidebar hit-testing.**  
   **Plan:** [05-ui-drag.md, Task 9, Steps 3 and 5](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-03-move-session/05-ui-drag.md:445).  
   **Evidence:** Existing [SplitContainer.tsx:200](/Users/kuindji/Projects/taskflow/packages/ui/src/components/workspace/SplitContainer.tsx:200) adds an overlay without disabling pointer events; [TabItem.tsx:35](/Users/kuindji/Projects/taskflow/packages/ui/src/components/workspace/TabItem.tsx:35) does likewise. Installed dnd-kit creates a fixed overlay at [core.esm.js:3630](/Users/kuindji/Projects/taskflow/packages/ui/node_modules/@dnd-kit/core/dist/core.esm.js:3630), with default z-index 999 at line 3907.
   
   `elementFromPoint` normally returns the overlay under the cursor, whose ancestors have no sidebar marker. Valid cards therefore fail to highlight or receive moves.
   
   **Fix:** Set `pointerEvents: "none"` on both overlay wrappers. Add a real-browser test with the overlay mounted.

8. **Major — Drag delta is not always cursor displacement.**  
   **Plan:** [05-ui-drag.md, Task 9, Step 3, `pointerOf`](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-03-move-session/05-ui-drag.md:445).  
   **Evidence:** Installed dnd-kit computes pointer coordinates from raw translation at [core.esm.js:2977](/Users/kuindji/Projects/taskflow/packages/ui/node_modules/@dnd-kit/core/dist/core.esm.js:2977), but emits `scrollAdjustedTranslate` as event delta at [core.esm.js:3225](/Users/kuindji/Projects/taskflow/packages/ui/node_modules/@dnd-kit/core/dist/core.esm.js:3225). The tab strip scrolls at [TabBar.tsx:149](/Users/kuindji/Projects/taskflow/packages/ui/src/components/workspace/TabBar.tsx:149).
   
   After drag auto-scroll, adding that delta to the initial client position hit-tests an offset location. The hook can highlight or move into a different card.
   
   **Fix:** Track actual pointer client coordinates and re-hit-test/revalidate at drop. Test dragging after tab-strip scrolling.

9. **Major — Invalid sidebar drops fall through to tab/pane movement.**  
   **Plan:** [05-ui-drag.md, Task 9, Steps 3 and 5](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-03-move-session/05-ui-drag.md:476).  
   **Evidence:** [TabBar.tsx:86](/Users/kuindji/Projects/taskflow/packages/ui/src/components/workspace/TabBar.tsx:86) reorders whenever `over` names another tab; [SplitContainer.tsx:98](/Users/kuindji/Projects/taskflow/packages/ui/src/components/workspace/SplitContainer.tsx:98) can move between panes. Installed `closestCenter` ranks droppables without requiring pointer containment at [core.esm.js:325](/Users/kuindji/Projects/taskflow/packages/ui/node_modules/@dnd-kit/core/dist/core.esm.js:325).
   
   A shell, flow, or cross-backend sidebar drop returns `false`, but `over` can still identify the nearest workspace tab or pane. This contradicts the specified no-op for invalid sidebar drops.
   
   **Fix:** Distinguish “outside sidebar”, “invalid sidebar target”, and “valid move”. Consume invalid sidebar drops; fall through only for actual workspace drops.

10. **Major — Master-pane tabs do not consistently receive the movable flag.**  
    **Plan:** [05-ui-drag.md, Task 8, Step 3](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-03-move-session/05-ui-drag.md:148).  
    **Evidence:** [session-store.ts:216](/Users/kuindji/Projects/taskflow/packages/ui/src/stores/session-store.ts:216) creates tabs directly without `createSessionTab`. Master synchronization has separate refresh loops at [session-store.ts:625](/Users/kuindji/Projects/taskflow/packages/ui/src/stores/session-store.ts:625) and line 645, which the plan does not change.
    
    A session created into Master’s right pane uses the direct tab path while broadcast insertion is suppressed. Later master refreshes preserve its missing flag, so the live agent cannot be dragged into a task.
    
    **Fix:** Initialize the flag on direct creation and refresh it in both master panes, preferably by reusing the existing sync helper. Add a Master right-pane creation test.

11. **Major — Terminal-link handling misses Master and cached-terminal moves.**  
    **Plan:** [06-links-and-verify.md, Task 10, Step 3](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-03-move-session/06-links-and-verify.md:89).  
    **Evidence:** [terminal-link-provider.ts:135](/Users/kuindji/Projects/taskflow/packages/ui/src/components/panes/terminal/terminal-link-provider.ts:135) resolves through captured owner IDs. [terminal-lifecycle.ts:158](/Users/kuindji/Projects/taskflow/packages/ui/src/components/panes/terminal/terminal-lifecycle.ts:158) reuses cached terminals, and destruction has a 50 ms grace period at [terminal-lifecycle.ts:364](/Users/kuindji/Projects/taskflow/packages/ui/src/components/panes/terminal/terminal-lifecycle.ts:364).
    
    The proposed Master branch still returns `null`, ignoring the moved ref’s cwd. A terminal remounted before cache destruction also retains its old-owner provider; after source removal, that provider cannot find the ref.
    
    **Fix:** Resolve the session’s cwd independently of captured owner IDs, including Master, and refresh owner-dependent link activation when reusing a cached terminal. Test task→Master and reuse during the grace period.

12. **Minor — The new hook test contaminates the required aggregate UI suite.**  
    **Plan:** [05-ui-drag.md, Task 9, Step 1](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-03-move-session/05-ui-drag.md:269).  
    **Evidence:** [session-sync.backend.test.ts:4](/Users/kuindji/Projects/taskflow/packages/ui/src/stores/session-sync.backend.test.ts:4) imports real connection functions absent from the proposed replacement. The test also replaces `document.elementFromPoint` without restoring it.
    
    Running the hook test separately does not prevent its discovery by the plan’s required `bun test packages/ui` command. Adding more stub exports would still replace real connection behavior.
    
    **Fix:** Inject request/dialog/hit-test dependencies into the testable handler factory instead of globally mocking shared modules. Restore DOM overrides.

13. **Minor — The TS command parser does not match the shell parser’s validation.**  
    **Plan:** [04-cli.md, Task 7, Step 3](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-03-move-session/04-cli.md:505).  
    **Evidence:** [cli-flags.ts:10](/Users/kuindji/Projects/taskflow/packages/backend/src/services/cli-flags.ts:10) collapses repeated flags and returns positional arguments separately.
    
    The TS command accepts repeated target flags by retaining the last value, and ignores stray positional arguments. The shell command counts repeated targets and rejects unknown arguments.
    
    **Fix:** Validate target occurrences and reject positionals consistently. Add equivalent malformed-command tests to both implementations.

Checks that were fine:

- For successful moves alone, queued appends, exit cleanup, native-ID discovery, and concurrent moves use the correct serialization model. The two log locks have a consistent acquisition order.
- Ref copying preserves cwd, launch options, native ID, instance, and boot ID. Task/project updater forms and broadcasts preserve other-instance refs and filtering.
- Flow launches carry `flow` metadata, so refusing flow refs is sufficient. Internal sessions retain captured-owner cleanup and remain unavailable for moves.
- The shell `sed` lookup matches the backend’s current compact JSON and UUID IDs. Its conditional lookup is safe under `set -e`; hoisting the request helper preserves its error handling.
- The proposed Bun server/spawn test and conditional `movable: true` spread passed isolated strict-TypeScript checks.
- TUI owner changes destroy and recreate bridges with the new owner, supporting correct history replay.

The output queue remains unbounded. The existing log queue already shares that limitation, so this is not a demonstrated new regression. The plan should nevertheless add a slow-writer/heavy-output check because moves and cleanup now wait behind that backlog.

No files were modified. Package suites were not run; verification used source inspection, in-memory ordering reproduction, and isolated compiler checks.

