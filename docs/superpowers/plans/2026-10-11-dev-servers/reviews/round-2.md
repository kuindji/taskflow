- DS-01: holds. Root-first signalling stops on refusal; the PID 1 manual check is removed.
- DS-02: holds. POSIX uses UTC `lstart`; both platforms compare whole seconds without slack.
- DS-03: holds. Spawn/query failures propagate; POSIX verifies absence with `kill(pid, 0)`.
- DS-04: holds. Windows captures descendants and checks every captured PID for exit.
- DS-05: holds. Comparison and removal run together inside the store queue.
- DS-06: holds. Reset tokens protect completions; successful removal also matches `registeredAt`. The new regression test has a compile error below.
- DS-07: holds for desktop disconnects. Offline-machine rows and counts are hidden. The filter breaks the browser verification path below.
- DS-08: holds. OpenCode receives the prompt file before the skill. The documented Kimi limitation is accepted.
- DS-09: holds for repeated `remove --pid` and `list --all` headers. Other CLI parity differences remain below.
- DS-10: does not hold completely. Usage/help expectations are corrected, but the assertion that invalid input causes no backend request overlooks owner adoption.
- DS-11: holds. Missing tasks join the project group; archived tasks retain their titles.

Validation used in-memory TypeScript overlays and eslint against the repository configuration, plus injected runtime probes. Backend overlays typechecked; UI overlays produced one TypeScript error. New tests produced two eslint errors. Probes confirmed the stopper and store fixes and reproduced the UI/CLI failures below. No files were modified; package suites and real Windows commands were not run.

DS2-01, major. Section 5’s browser renderer cannot display the feature.

Location: [04-ui.md:939](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-11-dev-servers/04-ui.md:939), Task 4.2, Step 4; [05-verify.md:11](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-11-dev-servers/05-verify.md:11), Task 1, Step 1.

The plan filters through:

```ts
const attached = new Set(machines.filter((m) => m.state === "attached").map((m) => m.id));
return devServers.filter((d) => attached.has(d.backendId));
```

Section 5 explicitly starts “the browser UI.” The real browser connection path is documented as “one connection to `VITE_BACKEND_PORT`, no machines” in [WebSocketProvider.tsx:7](/Users/kuindji/Projects/taskflow/packages/ui/src/providers/WebSocketProvider.tsx:7). It sets primary and opens a connection without creating a machine row. [useSidebarData.ts:49](/Users/kuindji/Projects/taskflow/packages/ui/src/components/sidebar/hooks/useSidebarData.ts:49) bootstraps that primary, so records can be fetched, but the planned filter hides all of them.

Consequently, checklist item 2 cannot produce the button, and the subsequent Stop/popover checks cannot run.

Fix: run Section 5 against a sandboxed Electron renderer. If browser verification is retained, explicitly support its connected primary without a machine row and add a test for that path while preserving desktop offline filtering.

DS2-02, minor. A late Stop failure restores an error after the popover closes.

Location: [04-ui.md:433](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-11-dev-servers/04-ui.md:433), Task 4.1, Step 4; [04-ui.md:1031](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-11-dev-servers/04-ui.md:1031), Task 4.2, Step 4.

Closing performs `if (!next) clearStopErrors()`, but an outstanding request can subsequently execute `setStopState(key, { error: result.error })`. Reopening clears nothing.

Concrete trigger: click Stop, close while it is pending, let it fail, then reopen. The old error appears, contrary to [design.md:199](/Users/kuindji/Projects/taskflow/docs/superpowers/specs/2026-10-11-dev-servers-design.md:199). This is possible with ordinary delayed failures and timeouts: the real connection rejects a pending request after its timeout in [connection.ts:176](/Users/kuindji/Projects/taskflow/packages/ui/src/lib/connection.ts:176).

The injected probe produced `{ "a:1": { error: "old failure" } }` after closing had cleared errors.

Fix: clear completed errors on opening as well as closing, preserving `"stopping"`. Add the deferred-failure/close/reopen scenario to verification.

DS2-03, major. The reset/refetch regression test does not typecheck.

Location: [04-ui.md:246](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-11-dev-servers/04-ui.md:246), Task 4.1, Step 2.

The snippet sets `finish = undefined`, assigns it inside the asynchronous responder, then calls:

```ts
finish?.({ ok: true });
```

TypeScript retains the known `undefined` narrowing because it cannot infer that the callback ran through `until`. The in-memory check reports TS2349 at plan line 260: “This expression is not callable. Type 'never' has no call signatures.”

The real harness invokes the responder on message arrival and later replies through `answer.then(reply)`, [test-ws-server.ts:46](/Users/kuindji/Projects/taskflow/packages/ui/src/lib/test-ws-server.ts:46). It supplies no synchronous assignment guarantee to TypeScript.

Fix: use a deferred holder object, as Section 1’s service test already does:

```ts
const pending: { finish?: (result: DevServerStopResult) => void } = {};
```

Assign and read `pending.finish`; use a separate holder for each phase.

DS2-04, minor. Two test snippets fail the required strict eslint checks.

Locations: [03-cli-prompt.md:108](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-11-dev-servers/03-cli-prompt.md:108), Task 1, Step 1; [04-ui.md:784](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-11-dev-servers/04-ui.md:784), Task 4.2, Step 1.

The CLI header assertion passes `expect.arrayContaining(...)` to a typed `toEqual`. Installed Bun declarations define `AsymmetricMatcher = any` at `node_modules/.bun/@types+bun@1.3.11/node_modules/bun-types/test.d.ts:1900`. Eslint reports `@typescript-eslint/no-unsafe-argument`.

The component fake uses:

```ts
stopDevServer: async () =>
    void useDevServerStore.setState(...)
```

Zustand’s `setState` already returns `void`, [vanilla.d.ts:4](/Users/kuindji/Projects/taskflow/packages/ui/node_modules/zustand/vanilla.d.ts:4). Eslint reports `@typescript-eslint/no-meaningless-void-operator`.

Both checks are enabled through `strictTypeChecked`, [eslint.config.js:30](/Users/kuindji/Projects/taskflow/eslint.config.js:30).

Fix: assert each expected header with `toContain`. Give the fake an async block body that calls `setState` without the `void` operator. Neither fix requires a cast or disable comment.

DS2-05, minor. The CLIs still disagree on unknown short flags and the end-of-flags sentinel.

Location: [03-cli-prompt.md:692](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-11-dev-servers/03-cli-prompt.md:692), Task 2, Step 3; shell branches at lines 365 and 393.

The shell rejects `devserver remove -x` through `-*)` and rejects `devserver list --` through its unknown-argument branch.

The TS implementation delegates to the real parser, which recognizes flags only when `arg.startsWith("--")` and treats `--` as a sentinel, [cli-flags.ts:16](/Users/kuindji/Projects/taskflow/packages/backend/src/services/cli-flags.ts:16). Thus:

- `remove -x` sends `DELETE /api/dev-servers/-x`.
- `list --` succeeds and sends `GET /api/dev-servers`.

The probes reproduced both differences. They violate Section 3’s unknown-flag rule and the [identical-CLI constraint](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-11-dev-servers.md:127).

Fix: validate these arguments locally in `handleDevserver` to match the shell. Add both cases to both harnesses; leave the shared parser’s existing command behavior unchanged.

DS2-06, minor. The invalid-PID manual check incorrectly forbids the owner lookup.

Location: [05-verify.md:41](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-11-dev-servers/05-verify.md:41), Task 1, Step 2, item 8.

The checklist expects `--pid abc` to fail locally and says “the sandbox backend receives no request.” Its prescribed environment includes `TASKFLOW_SESSION_ID`.

The real shell performs `GET /api/sessions/$TASKFLOW_SESSION_ID/owner` before command dispatch, [taskflow-cli.sh:89](/Users/kuindji/Projects/taskflow/packages/backend/src/services/taskflow-cli.sh:89). The binary similarly calls `await adoptSessionOwner()` before dispatch, [taskflow-cli-bin.ts:1401](/Users/kuindji/Projects/taskflow/packages/backend/src/services/taskflow-cli-bin.ts:1401). A made-up session returning 404 still receives that request.

Fix: require **no `/api/dev-servers` request**, allowing the owner lookup. Alternatively, prescribe an explicit global owner flag for this check so adoption is skipped.

Verdict: Changes required.

