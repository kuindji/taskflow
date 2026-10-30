Read-only review. No files were modified by this review. The sandbox blocked a WebSocket listener probe; those findings rely on code and protocol evidence.

1. **Blocker — `01-auth-core.md`, Task 1.2 Step 5: an existing handshake file can expose the API token.**

   The plan writes the token with `writeFile(..., { mode: 0o600 })` and treats the file as private. However, [config.ts:178](/Users/kuindji/Projects/taskflow/packages/backend/src/config.ts:178) supports a fixed `TASKFLOW_PORT_FILE`, and the existing writer at [index.ts:528](/Users/kuindji/Projects/taskflow/packages/backend/src/index.ts:528) creates it without restrictive permissions. An existing `0644` file retains those permissions when overwritten. Node documents that `mode` affects newly created files only. [API documentation](https://nodejs.org/api/fs.html#fspromiseswritefilefile-data-options)

   **Fix:** publish the handshake through a fresh, exclusively created `0600` temporary file and rename it. Add an upgrade test that starts with a readable legacy handshake file and verifies that the token-bearing replacement is `0600`.

2. **Major — `04-auth-remote-clients.md`, Task 4.2 Step 3: the desktop’s live `4401` refresh is bypassed.**

   The plan calls `onUnauthorized` after publishing disconnected status, but its listener retries only rows still marked `"attached"`. The existing status subscription immediately changes an attached row to `"offline"` at [backend-store.ts:473](/Users/kuindji/Projects/taskflow/packages/ui/src/stores/backend-store.ts:473). Furthermore, socket reconnects enter `rehandshake`, whose current implementation has no unauthorized recovery branch at [backend-store.ts:419](/Users/kuindji/Projects/taskflow/packages/ui/src/stores/backend-store.ts:419).

   **Fix:** route unauthorized failures from both `attach` and `rehandshake` through one recovery function, guarded by attachment intent and generation rather than the current `"attached"` label. Test token rotation through the real status subscription and reconnect path.

3. **Major — `04-auth-remote-clients.md`, Task 4.3 Step 3: the TUI resets its refresh allowance before authentication succeeds.**

   The plan clears the refresh gate whenever the machine goes online. Currently, `WsClient` publishes connected status directly from WebSocket `onopen` at [client.ts:94](/Users/kuindji/Projects/taskflow/packages/tui/src/net/client.ts:94), and `MachineSession` treats that as online at [machine-session.ts:381](/Users/kuindji/Projects/taskflow/packages/tui/src/opentui/machine-session.ts:381). An unauthorized socket is deliberately upgraded before receiving `4401`, so another rejected attempt can reset the gate and obtain another refresh indefinitely.

   **Fix:** reset the gate only after a successful application handshake, such as `SYSTEM_INFO`. Add a live-reconnect test where the refreshed token remains wrong and assert exactly one refresh before permanent rejection.

4. **Major — `04-auth-remote-clients.md`, Task 4.3 Step 3 and Planner decision 1: Section 4 reinstates the stopped-backend failure that Section 3 removes.**

   Section 4 instructs the TUI adapter to call `policy.stop()` for both `"no-backend"` and `"unauthorized"`. Section 3 explicitly removes the existing `"no-backend"` stop at [machine-session.ts:430](/Users/kuindji/Projects/taskflow/packages/tui/src/opentui/machine-session.ts:430). This also contradicts `design.md` §2’s retry-until-disconnected rule. The tunnel manager returns `"no-backend"` for an unavailable backend, not merely an authentication failure.

   **Fix:** stop automatic recovery for exhausted token rejection only. Keep `"no-backend"` retryable and retain Section 3’s regression test across Section 4.

5. **Major — `06-terminal.md`, Task 6.1’s snapshot amendment and Tasks 6.3–6.4: parser timeout can permanently lose a quiet terminal’s tail.**

   The plan returns the current snapshot after the 2000 ms parser deadline, with no indication that it missed the captured issued sequence. The backend increments the issued sequence before parsing at [pty-manager.ts:262](/Users/kuindji/Projects/taskflow/packages/backend/src/services/pty-manager.ts:262), while snapshots expose only the parsed sequence at [pty-manager.ts:431](/Users/kuindji/Projects/taskflow/packages/backend/src/services/pty-manager.ts:431).

   For example, the last batch is sequence 10, the client never receives it, and the parser remains at 9 until the deadline. The replacement reports 9; the client also knows only about 9, so continuity checks pass. When parsing later reaches 10, nothing triggers another recovery.

   **Fix:** amend the design and section so timeout cannot produce an apparently complete replacement. Returning `snapshot: null` to force the queued history fallback preserves the existing response shape. Test this exact dropped-tail case with no subsequent output.

6. **Major — `09-agent-discovery.md`, Task 9.3 Step 3: launch-time discovery can outlive the session-create request.**

   The plan awaits a Pi probe with a 60,000 ms deadline before constructing and spawning the session. Both clients time requests out after 30,000 ms: [connection.ts:9](/Users/kuindji/Projects/taskflow/packages/ui/src/lib/connection.ts:9) and [client.ts:28](/Users/kuindji/Projects/taskflow/packages/tui/src/net/client.ts:28). The UI awaits that request before completing session creation at [session-store.ts:198](/Users/kuindji/Projects/taskflow/packages/ui/src/stores/session-store.ts:198).

   A slow probe therefore reports a failed create, then launches the session later. Retrying can create another session.

   **Fix:** give launch normalization a separate, shorter discovery budget with enough margin below the request timeout, then use the planned `high` fallback. Add a delayed-probe lifecycle test that verifies the request completes before its deadline and no late spawn occurs.

7. **Minor — `04-auth-remote-clients.md`, Tasks 4.2 and 4.3 Step 1: the proposed `4401` tests assert the wrong promise behavior.**

   The tests require `open()` and `connect()` to reject when the server upgrades and immediately closes. Existing implementations resolve those promises on `onopen`: [connection.ts:99](/Users/kuindji/Projects/taskflow/packages/ui/src/lib/connection.ts:99) and [client.ts:94](/Users/kuindji/Projects/taskflow/packages/tui/src/net/client.ts:94). A later close cannot reject an already fulfilled promise. Completing the upgrade establishes the connection and produces the open event. [WebSocket standard](https://websockets.spec.whatwg.org/#feedback-from-the-protocol)

   **Fix:** assert that the application handshake or pending request rejects with `BackendUnauthorizedError`, and that retries stop. Include an explicitly open-then-close case rather than relying on packet timing.

8. **Minor — `01-auth-core.md`, Task 1.3 Steps 1–4: `upgradeHeaders` can select a protocol the client never offered.**

   The helper returns `"taskflow"` whenever it sees any `taskflow.auth.*` offer, including an auth-only offer. Both server upgrade sites currently accept upgrade options at [server.ts:81](/Users/kuindji/Projects/taskflow/packages/backend/src/ws/server.ts:81) and [server.ts:94](/Users/kuindji/Projects/taskflow/packages/backend/src/ws/server.ts:94). Selecting an unoffered protocol makes a conforming client fail the handshake, preventing the intended connection or observable `4401`. [RFC 6455 §4.1](https://datatracker.ietf.org/doc/html/rfc6455#section-4.1)

   **Fix:** select `"taskflow"` only when explicitly offered. Require the documented pair for subprotocol authentication, reject auth-only offers explicitly, and test both offer orders with `"taskflow"` present.

9. **Minor — `03-remote-connectivity.md`, Task 3.1 Step 1; `13-verify.md`, checklist 8: the required `ssh -G` output is incorrect.**

   Section 3 requires `controlpath none`; Section 13 additionally requires `controlmaster no`. Using the existing parser-test approach at [tunnel-args.test.ts:90](/Users/kuindji/Projects/taskflow/packages/shared/src/remote/tunnel-args.test.ts:90), a read-only probe on installed OpenSSH 10.5p1 produced `controlmaster false`, `controlpersist no`, and no `controlpath` entry when given the planned overrides.

   **Fix:** normalize the parser output and accept an omitted disabled ControlPath. Keep separate exact-argv assertions for `ControlPath=none`; update the manual checklist accordingly.

10. **Minor — `11-editor-discovery.md`, Step 1 and Windows candidate rules: the positive tests contradict the selected Windows policy.**

    The section lists new `.cmd` candidates and requires `"Windows JetBrains installs and Toolbox scripts are found"`. Its final decision and `design.md` §8 prohibit adding those `.cmd` candidates. The actual launcher uses direct argv spawning at [file.ts:124](/Users/kuindji/Projects/taskflow/packages/backend/src/handlers/file.ts:124).

    **Fix:** replace the stale candidate instructions with the native executable list. Make Toolbox `.cmd` fallback a rejection test, while separately preserving existing PATH behavior.

11. **Minor — `05-auth-browser-enforce.md`, Task 5.2 Step 2; `13-verify.md`, checklist 7: CDP assertions contradict the gate and routing contracts.**

    Section 13 expects altered or cross-tab keys to return `404`, while Section 5 explicitly authenticates before routing and requires `401`. Section 5 also requires every table row to reach its handler with a Bearer token, including the old unkeyed `/cdp/tab1/json/version` path. After Task 5.1 changes the whitelist, that old path cannot reach the API router. The whitelist precedes routing at [server.ts:88](/Users/kuindji/Projects/taskflow/packages/backend/src/ws/server.ts:88).

    **Fix:** expect `401` for invalid keys without another credential. Separate authorized valid-route cases from obsolete-path cases, which should return `404`. Exercise discovery through `<endpoint>/json/version`.

12. **Minor — `design.md`, source-checkout command at line 8: fetching the abbreviated commit will not obtain the required reference checkout.**

    The command uses `git fetch --depth 1 origin 32ecd717` in a newly initialized repository. That abbreviation is not a fully spelled object ID and is treated as a remote ref. Git’s fetch contract permits a ref or a full hexadecimal object name. [Git documentation](https://git-scm.com/docs/git-fetch#Documentation/git-fetch.txt-ltrefspecgt)

    **Fix:** record the full commit SHA and fetch that exact SHA. Keep the short form for attribution comments if desired.

**Counts: 1 blocker, 5 major, 6 minor.**

