**Verdict: Changes required.** Found 2 majors and 2 minors. Read-only source review; no files changed or live apps started.

1. **Major — S6 Task 6.3: plain-browser reconnects never publish terminal readiness.**

   **Plan:** [06-terminal.md:157](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-30-t3code-adoptions/06-terminal.md:157), Step 6.

   **Evidence:** [WebSocketProvider.tsx:8](/Users/kuindji/Projects/taskflow/packages/ui/src/providers/WebSocketProvider.tsx:8) opens the standalone browser connection directly. Only the desktop branch calls `store.attach` at line 28. Store reconnect handling is installed through `followSocket` at [backend-store.ts:458](/Users/kuindji/Projects/taskflow/packages/ui/src/stores/backend-store.ts:458). The provider’s own status subscription only updates React state at [WebSocketProvider.tsx:47](/Users/kuindji/Projects/taskflow/packages/ui/src/providers/WebSocketProvider.tsx:47).

   **Trace:** a plain-browser terminal disconnects, misses its final output, then reconnects. S6 publishes readiness only from store `attach`/`rehandshake`, which this connection never invokes. With no later output, neither gap detection nor backpressure drain repairs the missing tail. The connection overlay does not remount the workspace, as shown at [App.tsx:134](/Users/kuindji/Projects/taskflow/packages/ui/src/App.tsx:134).

   **Fix:** include the standalone connection in the validated readiness path. Add a no-desktop-bridge reconnect test proving that a quiet terminal requests a fresh snapshot without remounting.

2. **Major — S4 Task 4.2: exhausted authentication recovery hides the controls needed to recover a primary remote.**

   **Plan:** [04-auth-remote-clients.md:54](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-30-t3code-adoptions/04-auth-remote-clients.md:54), unauthorized rejection and token-edit recovery.

   **Evidence:** closing primary clears registry primary at [connection-registry.ts:87](/Users/kuindji/Projects/taskflow/packages/ui/src/lib/connection-registry.ts:87). The primary listener then reports disconnected at line 195. [App.tsx:30](/Users/kuindji/Projects/taskflow/packages/ui/src/App.tsx:30) displays a full-screen `fixed inset-0 z-50` overlay whenever disconnected. The Machines trigger and Return to local button remain beneath it at [MachinesMenu.tsx:274](/Users/kuindji/Projects/taskflow/packages/ui/src/components/sidebar/MachinesMenu.tsx:274) and [MachinesMenu.tsx:396](/Users/kuindji/Projects/taskflow/packages/ui/src/components/sidebar/MachinesMenu.tsx:396).

   **Trace:** work as a manually authenticated remote, then rotate its token where SSH cannot read the replacement. S4 exhausts its refresh, drops primary and stops retrying. The overlay remains “Connecting to backend…” and intercepts clicks on both the token-editor entry point and Return to local. The new dialog save test starts inside an already-open dialog, so it misses this problem.

   **Fix:** give the disconnected primary overlay reachable recovery actions, including editing the token and returning to local. Add a full-shell regression covering exhausted primary authentication followed by token correction.

3. **Minor — S6 Task 6.1: one existing snapshot test contradicts the new async contract.**

   **Plan:** [06-terminal.md:270](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-30-t3code-adoptions/06-terminal.md:270) says existing snapshot calls gain `await`.

   **Evidence:** [pty-manager-snapshot.test.ts:173](/Users/kuindji/Projects/taskflow/packages/backend/tests/services/pty-manager-snapshot.test.ts:173) requests a snapshot inside `onData`, then asserts `reported < sequence` at line 196. Output queues headless parsing immediately before invoking `onData` at [pty-manager.ts:270](/Users/kuindji/Projects/taskflow/packages/backend/src/services/pty-manager.ts:270).

   **Trace:** with S6 implemented correctly, awaiting that snapshot waits for the emitted sequence. Its reported sequence is therefore at least that sequence, contradicting the retained assertion. Adding `await` also requires restructuring the callback’s asynchronous result collection.

   **Fix:** explicitly replace this test. Assert that the request stays pending while parsing is held, then resolves with the captured sequence and corresponding content after parsing completes.

4. **Minor — S13 checklist 1 requires rejection logs that S5 removes.**

   **Plan:** [13-verify.md:10](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-30-t3code-adoptions/13-verify.md:10), alongside S5 Task 5.2.

   **Evidence:** [server.ts:74](/Users/kuindji/Projects/taskflow/packages/backend/src/ws/server.ts:74) has no request logger, and [response-helpers.ts:8](/Users/kuindji/Projects/taskflow/packages/backend/src/api/routes/response-helpers.ts:8) only constructs responses. S5 explicitly deletes the report-only logger without adding enforcement logging.

   **Trace:** correctly rejected requests return 403 but produce no required backend log entry. Conversely, “no auth rejection in the log” becomes an ineffective check once rejection logging is removed.

   **Fix:** verify response/network evidence and absence of side effects instead of expecting backend log lines.

The seven round-2 fixes checked as follows:

| Row | Result |
|---|---|
| 1. Primary restoration | **Holds.** `setPrimaryBackend(liveId)` restores both registry primary and its status subscription after S3 or S4 reattachment. Attempt checks prevent restoration by a late attach after intentional detach; switching primary elsewhere also defeats the condition. The prescribed real-drop tests can fail when restoration is omitted. |
| 2. Async snapshot callers/fakes | **Production migration holds; test migration needs finding 3.** Both production callers are named, including the HTTP `await`. No additional PTY snapshot callers or existing fakes were missed. |
| 3. Token save retries unauthorized row | **Holds at store/dialog level.** The save explicitly calls `retry` only for a changed token on an unauthorized, wanted row. Finding 2 concerns reaching that dialog when the rejected machine is primary. |
| 4. Registry temporary-file permissions | **Holds.** Unique name, exclusive `wx` creation, mode `0600`, rename and cleanup address the legacy temporary-file case. |
| 5. Pi launch budget | **Holds.** The test now pins the 10,000 ms boundary, child termination and absence of late effects after 60,000 ms. |
| 6. `tf_curl` assertion | **Holds.** Ignoring lines whose first nonblank character is `#` excludes the existing comment while retaining executable-call checks. |
| 7. Wrong-token verification | **Holds.** S13 now separates SSH-readable recovery from unreadable-token rejection. |

The snapshot grep found production calls in `handlers/session.ts:137` and `session-routes.ts:306`; ten test calls in `pty-manager-snapshot.test.ts`; and the fake in `tests/handlers/session.test.ts:97`. S6 also names the route fake that needs adding. The UI’s separate `useConnectivity.getSnapshot` is unrelated.

No auth client from `research-6-auth-surface.md` was omitted by Sections 1, 2, 4 and 5. No additional section-order break was found.