Changes required. No files were modified. The round-1 corrections are present, and the `snapshot: null` history fallback is sound. The remaining findings are below.

1. **Major — desktop recovery clears the primary backend permanently.**

   **Plan:** `03-remote-connectivity.md`, Task 3.3 Steps 3–5; `04-auth-remote-clients.md`, Task 4.2 Step 3.

   **Evidence:** [backend-store.ts:133](/Users/kuindji/Projects/taskflow/packages/ui/src/stores/backend-store.ts:133) implements `drop()` through `closeConnection`. [connection-registry.ts:87](/Users/kuindji/Projects/taskflow/packages/ui/src/lib/connection-registry.ts:87) clears primary when closing its connection. Successful `attach()` does not restore it.

   **Trace:** the active remote loses its tunnel, or receives `4401` and enters the planned `drop → attach` recovery. Closing clears the registry’s primary id. Reattachment succeeds, but `onPrimaryStatusChange` remains unsubscribed from that backend. The app stays behind its connection overlay, and primary-dependent settings operations fail. A read-only probe reproduced `primaryAfterRecovery: null` after close and successful reopen.

   **Fix:** preserve primary selection during connection replacement, while retaining clearing behavior for actual detach. Add tunnel-loss and live-token-rotation tests asserting the primary id and provider connectivity after recovery.

2. **Major — the snapshot wait amendment misses the HTTP caller.**

   **Plan:** `06-terminal.md`, Task 6.1 snapshot amendment under Planner decisions.

   **Evidence:** [pty-manager.ts:405](/Users/kuindji/Projects/taskflow/packages/backend/src/services/pty-manager.ts:405) currently returns snapshots synchronously. [session-routes.ts:306](/Users/kuindji/Projects/taskflow/packages/backend/src/api/routes/session-routes.ts:306) immediately passes that result into `jsonResponse`, whose argument is `unknown`.

   **Trace:** implementing the parser wait by making `getSnapshot()` asynchronous leaves the HTTP route serializing a Promise. This compiles and returns `200 {}`. I reproduced that response through the real route with an asynchronous snapshot dependency. Both CLI implementations use this endpoint.

   **Fix:** specify the asynchronous snapshot interface and affected callers explicitly. Await it in the HTTP route, update fixtures, and add HTTP coverage for both parser completion and timeout-to-null. Include these files in Section 6’s allowed modification list.

3. **Major — saving a corrected token has no implemented route back from unauthorized state.**

   **Plan:** `04-auth-remote-clients.md`, Task 4.2 Step 3 and Planner decisions 1 and 4; `13-verify.md`, checklist 6.

   **Evidence:** [ManageBackendsDialog.tsx:57](/Users/kuindji/Projects/taskflow/packages/ui/src/components/sidebar/ManageBackendsDialog.tsx:57) only calls `updateBackend`. [backend-registry.ts:460](/Users/kuindji/Projects/taskflow/packages/shared/src/remote/backend-registry.ts:460) persists and announces the change. Renderer refresh preserves the previous state and failure at [backend-store.ts:342](/Users/kuindji/Projects/taskflow/packages/ui/src/stores/backend-store.ts:342).

   **Trace:** exhausted authentication sets `failure.kind = "unauthorized"`. Section 4 makes that row unwanted and stops its controller. Saving the correct token produces a refresh, which preserves that failure. Nothing in the edit steps clears it or starts another attach. The planner decision promises recovery, but the prescribed wiring only saves the token.

   **Fix:** after a successful token edit, explicitly restart recovery for a machine whose attachment intent remains true. Test the actual dialog save through successful reattachment, beyond checking the IPC patch or calling Retry directly in a store test.

4. **Minor — registry persistence can retain a legacy temporary file’s readable permissions.**

   **Plan:** `04-auth-remote-clients.md`, Task 4.1 Step 3 and Registry behavior.

   **Evidence:** [backend-registry.ts:96](/Users/kuindji/Projects/taskflow/packages/shared/src/remote/backend-registry.ts:96) uses the fixed path `backends.json.tmp`. Its writer has no cleanup on failure. The plan changes its write mode to `0600` and incorrectly states that the temporary file is always fresh.

   **Trace:** an interrupted pre-auth write can leave a `0644` temporary file. The first token-bearing write reuses it; `writeFile(..., { mode: 0o600 })` preserves its existing permissions. Rename then publishes a `0644` file containing remote tokens. The proposed fresh-directory permissions test misses this case.

   **Fix:** use a unique, exclusively created `0600` temporary file and cleanup, as Section 1 now does for the handshake. Test with a pre-existing legacy temporary file.

5. **Minor — the Pi launch test does not enforce the selected 10-second budget.**

   **Plan:** `09-agent-discovery.md`, Task 9.3 Step 1, final launch-budget test.

   **Evidence:** the section requires a `10_000` ms limit, but its prescribed assertion only requires completion before `30_000` ms. The real client timeout is [connection.ts:9](/Users/kuindji/Projects/taskflow/packages/ui/src/lib/connection.ts:9); the existing discovery deadline is [runtime-detector.ts:22](/Users/kuindji/Projects/taskflow/packages/backend/src/services/runtime-detector.ts:22).

   **Trace:** a defective 25-second normalization timeout can return `high`, spawn once, release the probe, and satisfy every stated assertion.

   **Fix:** assert the 10-second boundary with the injected clock, including child termination. Advance beyond the original discovery deadline afterward and verify no late effects.

6. **Minor — the CLI source assertion rejects a correct implementation.**

   **Plan:** `02-auth-local-clients.md`, Task 2.4 Step 1.

   **Evidence:** [taskflow-cli.sh:43](/Users/kuindji/Projects/taskflow/packages/backend/src/services/taskflow-cli.sh:43) contains a comment matching the proposed `/(^|[^_a-zA-Z])curl /` expression.

   **Trace:** replacing every executable call with `tf_curl` still leaves that comment. The test therefore finds more than the two permitted wrapper lines.

   **Fix:** exclude comments from the assertion, or replace it with a check that distinguishes executable calls from prose.

7. **Minor — Section 13’s wrong-token check expects rejection where recovery should succeed.**

   **Plan:** `13-verify.md`, checklist 5, final bullet.

   **Evidence:** Section 4’s recovery reads the token through the existing SSH execution path at [tunnel-manager.ts:97](/Users/kuindji/Projects/taskflow/packages/shared/src/remote/tunnel-manager.ts:97), then retries with the refreshed credential. Section 5 Task 5.2 Step 6 item 7 correctly qualifies its rejection test with an unreadable remote token file.

   **Trace:** entering a wrong manual token on an ordinary SSH-readable remote causes one refresh followed by successful attachment. Section 13 instead requires `Remote backend rejected the access token`, so correct behavior fails its checklist.

   **Fix:** copy Section 5’s unreadable-token precondition into Section 13. Keep a separate case proving that a wrong initial token recovers when SSH can read the correct one.

Counts: **0 blockers, 3 major, 4 minor.**

