Read-only review completed. The planned TypeScript additions and edits passed an in-memory typecheck for both backend and UI. Injected probes reproduced the process-error and re-registration failures below. I did not run the real-process tests or manual checklist.

For new stopper files, the quoted implementation evidence comes from the planned snippets; those files do not exist yet.

### DS-01, blocker: The PID 1 verification step can kill unrelated processes

**Location:** [05-verify.md:37](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-11-dev-servers/05-verify.md:37), Task 1, Step 2, checklist item 7; Section 1, Task 2, Step 3.

The checklist says, “Register PID `1` (launchd, so EPERM).” The planned stopper collects all descendants of PID 1, excludes only the backend’s own PID, and continues signalling after a denial: `if (errorCode(error) === "EPERM") denied = true`. See [01-backend-core.md:783](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-11-dev-servers/01-backend-core.md:783).

Those descendants include user-owned applications and agents. The real agent process path uses `Bun.spawn([options.command, ...options.args])` in [pty-manager.ts:324](/Users/kuindji/Projects/taskflow/packages/backend/src/services/pty-manager.ts:324). EPERM on launchd does not prevent signalling its user-owned descendants.

An injected probe confirmed that the loop attempts subsequent signals after PID 1 returns EPERM.

**Fix:** Remove this manual check. Exercise EPERM through injected operations. Abort tree signalling when the root signal is denied, before signalling descendants.

### DS-02, blocker: The reuse guard can signal a newer process

**Location:** [01-backend-core.md:753](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-11-dev-servers/01-backend-core.md:753), Task 2, Step 3; comparison at line 881.

There are two concrete failures:

- Windows returns an absolute UTC start timestamp, but the shared comparison still applies `registeredSec + 1`. A process registered at `12:00:00Z` and replaced by one started at `12:00:01Z` is signalled. The injected probe returned `stopped` and recorded SIGTERM.
- POSIX samples `now` **before** awaiting `ps`. Command latency therefore makes the computed start arbitrarily early. With registration at time 0, actual start at +3 seconds, clock sampled at +100 seconds, and `ps` observing at +102 seconds, `etime=99` produces a computed start of +1 second. The probe signalled this newer process too.

The spec requires no signal when the truncated start is later than the truncated registration, [design.md:79](/Users/kuindji/Projects/taskflow/docs/superpowers/specs/2026-10-11-dev-servers-design.md:79). The announced approximation concerns POSIX elapsed-time sampling; it does not justify Windows slack.

**Fix:** Compare Windows timestamps without slack. For POSIX, use the approved absolute start-time query with the already-planned `LC_ALL=C`, or explicitly bound sampling uncertainty and refuse to signal when identity is uncertain. Add Windows +1-second and delayed-`ps` boundary tests.

### DS-03, major: OS-command failures become successful removals or incomplete stops

**Location:** [01-backend-core.md:713](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-11-dev-servers/01-backend-core.md:713), Task 2, Step 3.

The snippet conflates failure with absence:

- `runCommand` catches spawn failures and returns `{ exitCode: -1, stdout: "" }`.
- POSIX `startTime` returns `null` for every nonzero exit and every parse failure.
- POSIX `tree` ignores `exitCode`, so a failed snapshot becomes `[pid]`.
- Windows `startTime` similarly treats query/parsing errors as absence.
- Windows `signal` ignores `taskkill` failures and always returns `"sent"`.
- Windows `running` ignores `tasklist` failures, allowing an empty result to mean everything exited.

Probes returned `gone` when `ps` was unavailable, `stopped` after a failed tree snapshot, and `stopped` when both `taskkill` and `tasklist` failed.

The real WS error path can report exceptions through `error: err instanceof Error ? err.message : "Unknown error"` in [ws/server.ts:121](/Users/kuindji/Projects/taskflow/packages/backend/src/ws/server.ts:121). These branches suppress the errors before that path can handle them.

**Fix:** Distinguish verified absence from query failure. Reject malformed start-time output, check tree and survivor-query exit codes, and inspect `taskkill` results. Preserve the record and surface failures. Add injected tests for each command-failure branch.

### DS-04, major: Windows waits for the parent only

**Location:** [01-backend-core.md:819](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-11-dev-servers/01-backend-core.md:819), Task 2, Step 3; Windows tests at line 569.

Windows `tree(pid)` returns `[pid]`. Consequently, every survivor check examines only the registered parent. If the parent exits during graceful termination while a descendant remains, the stopper returns `stopped`; it never reaches forced termination for that descendant.

The test only asserts that `taskkill` receives `/T`. It cannot establish that all descendants exited. This misses the “all descendants” requirement and the wrapper-tree Review Focus item.

The plan also promises real Windows verification in [01-backend-core.md:365](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-11-dev-servers/01-backend-core.md:365), but Section 5 supplies a POSIX-only checklist using `sh`, `lsof`, and launchd.

**Fix:** Retain descendant identities during the user-triggered Stop, wait for those processes, and force surviving descendants even after the root exits. Add a parent-exits/child-survives test and an explicit Windows verification task.

### DS-05, major: A stale backend Stop deletes a newer registration

**Location:** [01-backend-core.md:1190](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-11-dev-servers/01-backend-core.md:1190), Task 3, Step 3.

The service does:

```ts
const server = await store.get(id);
const outcome = await stopProcess(server.pid, server.registeredAt);
if (await store.remove(id)) await publish();
```

Re-adding a PID deliberately retains its ID. An agent can register the replacement process while an older Stop awaits its reuse query. When that Stop returns `reused`, it deletes the replacement’s registration despite sending no signal.

The real queue serializes individual operations through `const result = previous.then(step)` in [keyed-queue.ts:10](/Users/kuindji/Projects/taskflow/packages/backend/src/services/keyed-queue.ts:10). It does not make the service’s get/await/remove sequence atomic.

The probe re-added the same PID during a deferred `reused` Stop. The new record retained its ID, then disappeared.

**Fix:** Remove only the registration that was inspected. Compare ID and registration version inside one queued comparison-and-removal operation, and document that interface in the index. Add a deferred-stop/re-registration test.

### DS-06, major: Late UI Stop results mutate newer state

**Location:** [04-ui.md:351](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-11-dev-servers/04-ui.md:351), Task 4.1, Step 4.

After success, the snippet removes every row matching `server.id`. A newer registration broadcast with the same ID can therefore be removed by the old request’s completion. The probe produced an empty UI list after broadcasting a replacement registration and resolving the old Stop with `{ ok: true }`.

The reset protection checks only `slices.backends().includes(server.backendId)`. The real helper’s `backends()` returns keys, not generations, in [backend-scope.ts:119](/Users/kuindji/Projects/taskflow/packages/ui/src/lib/backend-scope.ts:119). A recreated backend slice passes this check.

Failure continuations are unguarded too. The real connection closes by rejecting pending requests, `this.failPending(reason, this.epoch)`, in [connection.ts:204](/Users/kuindji/Projects/taskflow/packages/ui/src/lib/connection.ts:204). After reset clears stop states, the queued catch recreates an old error. That probe reproduced `"a:1": { error: "old request error" }`.

**Fix:** Guard every completion with a per-attempt/reset token. Remove a row only if its registration still matches the requested row. Add replacement-broadcast and reset/reconnect tests with deferred responses.

### DS-07, major: Ordinary disconnects leave server rows visible

**Location:** [04-ui.md:389](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-11-dev-servers/04-ui.md:389), Task 4.1, Step 4; reset test at line 175.

The plan clears rows through `registerBackendReset`. Its test explicitly calls both `closeConnection` and `resetBackend`.

The real spontaneous-disconnect path does neither reset. It only executes:

```ts
wasConnected = false;
patch(backendId, { state: "offline" });
```

See [backend-store.ts:471](/Users/kuindji/Projects/taskflow/packages/ui/src/stores/backend-store.ts:471).

Thus a lost tunnel or closed socket leaves its rows and count visible, contradicting the spec’s requirement that disconnected-backend rows vanish.

**Fix:** Add dev-server-specific cleanup to the actual disconnect-status path, preserving other backends’ rows. Refetch after reconnection. Test socket closure without manually invoking `resetBackend`.

### DS-08, major: The registration instruction does not reach every agent type

**Location:** [03-cli-prompt.md:768](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-11-dev-servers/03-cli-prompt.md:768), Task 3, Steps 1 and 3.

The test titled “tells every agent” only calls `buildSystemPrompt`. It never checks what an agent actually receives.

The real OpenCode branch loads `instructions: [skillPath]` and returns its config without using `systemPrompt`, [internal-agent-skill.ts:248](/Users/kuindji/Projects/taskflow/packages/backend/src/services/internal-agent-skill.ts:248). The paragraph is added only to `PROMPT_BASE`, so OpenCode misses it.

Promptless Kimi starts also miss it: `initialInput: prompt ? ... : undefined`, [internal-agent-skill.ts:312](/Users/kuindji/Projects/taskflow/packages/backend/src/services/internal-agent-skill.ts:312). The PTY explicitly skips injection when `initialInput === undefined`, [pty-manager.ts:247](/Users/kuindji/Projects/taskflow/packages/backend/src/services/pty-manager.ts:247).

**Fix:** Deliver the shared instruction through OpenCode’s instruction-file channel and promptless Kimi’s launch path. Test actual launch specs for every supported agent type, including launches without an initial user prompt.

### DS-09, minor: The plan explicitly permits divergent CLI behavior

**Location:** [03-cli-prompt.md:611](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-11-dev-servers/03-cli-prompt.md:611), Task 2, Step 1.

The plan says repeated `remove --pid` is rejected in sh but accepted in TS, and calls that “acceptable.” This contradicts the index’s identical-CLI constraint.

The real parser overwrites repeated values through `flags[name] = args[i + 1] ?? ""`, [cli-flags.ts:28](/Users/kuindji/Projects/taskflow/packages/backend/src/services/cli-flags.ts:28). Existing session-move code already compensates by counting target flags, [taskflow-cli-bin.ts:1323](/Users/kuindji/Projects/taskflow/packages/backend/src/services/taskflow-cli-bin.ts:1323).

There is another discrepancy: Section 3 says `list --all` sends any available context headers, but the TS snippet calls `api("GET", "/api/dev-servers?all=1")` without them.

**Fix:** Reject repeated removal selectors in TS, reuse the existing counting approach, pass context headers for `--all`, and test identical argument/header cases in both harnesses.

### DS-10, minor: Two manual checks contradict the implementation they verify

**Location:** [05-verify.md:41](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-11-dev-servers/05-verify.md:41), Task 1, Step 2, items 8 and 11.

Item 8 expects `--pid abc` to print the backend’s positive-integer error. Both planned CLIs reject it locally with usage text and send no dev-server request.

Item 11 expects CLI help to contain the command-document **path**. The real `getResolvedCliHelp` replaces references with `COMMAND_FILES[filename]`, [internal-agent-skill.ts:130](/Users/kuindji/Projects/taskflow/packages/backend/src/services/internal-agent-skill.ts:130). Section 3 correctly tests inlined syntax and absence of the reference.

**Fix:** Expect usage for `abc`, and use `--pid 0` to verify the backend validation message. Check help for command syntax; check the written skill/system-prompt references separately for the document path.

### DS-11, minor: Deleted-task records remain split into duplicate project groups

**Location:** [04-ui.md:781](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-11-dev-servers/04-ui.md:781), Task 4.2, Step 4.

The grouping key always includes `server.taskId`, even when that task no longer exists. Two deleted tasks and a project-level server consequently produce separate groups with the same project-only heading.

This is a supported lifecycle path. The real deletion action removes tasks from both collections using `withoutTaskFamily`, [task-store.ts:166](/Users/kuindji/Projects/taskflow/packages/ui/src/stores/task-store.ts:166). Server records intentionally survive deletion. The spec groups missing-task records by project name alone.

**Fix:** Resolve the task before calculating the group key; use its ID only when found. Add a test combining project-level records and records from multiple deleted tasks in one project.

Verdict: Changes required.

