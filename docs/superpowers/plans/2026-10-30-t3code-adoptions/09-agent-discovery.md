# Section 9: Account-aware Codex discovery and Pi thinking levels

Apply design.md §6. Read the index, design and handoff first. Anchors below were verified against the current source on 2026-10-30. Split the work into Tasks 9.1–9.3, each suitable for one implementation session. Discovery uses short-lived CLI probes; interactive sessions continue to use PTYs.

**Files:**

- Modify: `packages/backend/src/services/runtime-detector.ts:24`, `:99`, `:159`, `:293`, `:317`. Reuse the existing model normalization and deadlines; add pagination/account diagnostics and Pi RPC discovery through injected process dependencies.
- Read/reuse without changing account precedence: `packages/backend/src/services/agent-accounts.ts:40` inherited home, `:52` `resolveAgentAccount`, `:99` `accountEnv`, `:107` `headlessAgentEnv`. Discovery must use these helpers instead of resolving account names or constructing home variables again.
- Create: `packages/backend/src/handlers/agent-discovery.ts`, `packages/backend/tests/handlers/agent-discovery.test.ts`. Extract the Codex registration from the index into this testable handler.
- Modify: `packages/backend/src/index.ts:477` Codex and `:481` Pi registrations. Pass the existing store/settings dependencies and real discovery functions into the new handler.
- Modify: `packages/shared/src/types/agent.ts:93`, `:116`, `:127`, `:201` and `packages/shared/src/types/ws.ts:293`, `:301`. Add the small diagnostic/capability contracts below. Preserve existing model fields, Pi level union and message strings.
- Create: `packages/shared/src/utils/pi-thinking.ts`, `packages/shared/src/utils/pi-thinking.test.ts`. Follow the colocated pure-test style in `packages/shared/src/utils/terminal-snapshot.test.ts:1`. Export only the two functions below, both used by backend/UI. Modify `packages/shared/src/index.ts:13` to re-export them.
- Modify: `packages/ui/src/components/settings/CodexModelSelect.tsx:11`, `:19`, `:38`; `packages/ui/src/components/shared/CodexOptions.tsx:21`, `:88`, `:140`; `packages/ui/src/components/settings/sections/CodexSection.tsx:5`, `:30`; `packages/ui/src/components/settings/sections/AgentAccountsSection.tsx:9`, `:133`, `:140`; `packages/ui/src/components/settings/SettingsModal.tsx:560`, `:576`.
- Create: `packages/ui/src/lib/agent-discovery.ts`. Share the typed Codex request function between the model picker and account diagnostics. It is also the injected default for component tests.
- Modify: `packages/ui/src/components/workspace/AgentOptionsPanel.tsx:27`, `:157`, `:363`. Carry the explicit account and optional project into discovery without writing an inherited account into launch options.
- Modify the existing launch-context callers: `packages/ui/src/components/workspace/AgentOptionsDialog.tsx:5`, `:30`; `packages/ui/src/components/workspace/AgentDropdownMenu.tsx:110`, `:487`; `packages/ui/src/components/sidebar/TaskCard.tsx:474`; `packages/ui/src/components/sidebar/NewTaskDialog.tsx:387`; `packages/ui/src/components/schedules/ScheduleForm.tsx:416`; `packages/ui/src/components/flows/ActionEditor.tsx:228`.
- Modify: `packages/ui/src/components/flows/FlowEditor.tsx:33`, `:81`, `:395`; `packages/ui/src/components/flows/FlowActionList.tsx:22`, `:169`; `packages/ui/src/components/flows/InlineActionEditor.tsx:15`, `:80`. Forward the owning backend and selected project through the existing props chain. Any preview wording for a global template is conditional on the planner's answer below. `packages/ui/src/components/flows/BuiltinActionEditor.tsx:32`, `:190` already carries its owning backend; modify its preview wording only after that answer.
- Read/reuse: `packages/ui/src/hooks/useActiveWorkspace.ts:86`, `packages/ui/src/hooks/useWorkspaceBackend.ts:9`, `packages/ui/src/stores/settings-store.ts:16`, `packages/ui/src/stores/project-store.ts:30`. Use backend-scoped settings/projects and the current workspace's project, rather than the primary machine's configuration for a remote launch.
- Modify: `packages/ui/src/components/settings/PiModelSelect.tsx:10`, `:30`, `:36`; `packages/ui/src/components/shared/PiOptions.tsx:13`, `:47`, `:65`; `packages/ui/src/components/settings/sections/PiSection.tsx:24` only as needed to pass the shared discovery dependency in tests. Settings already uses primary's `PiOptions`; keep that route.
- Modify: `packages/backend/src/services/session-lifecycle.ts:82`, `:449`, `:455`; `packages/backend/src/services/headless-agent.ts:97`. Normalize Pi options after defaults are merged and before command construction, including saved action/schedule and headless requests.
- Create: `packages/backend/src/services/pi-options.ts`, `packages/backend/tests/services/pi-options.test.ts`. One async backend normalization helper, used by session lifecycle and the headless runner.
- Extend: `packages/backend/tests/services/runtime-detector.test.ts:67`, `:111`; `packages/backend/tests/services/agent-accounts.test.ts:1`; `packages/backend/tests/handlers/session.test.ts:115`; `packages/backend/tests/services/headless-agent.test.ts:133`; `packages/ui/src/components/settings/sections/AgentAccountsSection.test.tsx:1`.
- Create: `packages/ui/src/components/settings/CodexModelSelect.test.tsx`, `packages/ui/src/components/shared/CodexOptions.test.tsx`, `packages/ui/src/components/settings/sections/CodexSection.test.tsx`, `packages/ui/src/components/settings/PiModelSelect.test.tsx`, `packages/ui/src/components/shared/PiOptions.test.tsx`, `packages/ui/src/components/workspace/AgentOptionsPanel.discovery.test.tsx`.
- Read/reuse: `packages/backend/tests/test-router.ts:8`; `packages/backend/tests/handlers/dev-server.test.ts:1` dependency-driven tests; `packages/ui/src/components/settings/sections/AgentAccountsSection.test.tsx:20` real React DOM/event helpers; `packages/ui/tests/preload.ts:1` existing DOM setup. The older `packages/ui/src/components/workspace/AgentOptionsPanel.test.tsx:1` uses `mock.module`; do not copy that approach or add more module mocks.
- Inspect only: `packages/backend/src/services/internal-agent-skill.ts:281` and `packages/backend/tests/services/internal-agent-skill.test.ts:1`. Keep the existing Pi `--model`, `--thinking` and `--tools` command builder. Normalize options before this synchronous builder instead of duplicating discovery in it.

**Interfaces:**

Consumes `AgentAccount`, `CodexLaunchOptions.account`, `DEFAULT_AGENT_ACCOUNT_ID`, `INHERIT_AGENT_ACCOUNT`, `CodexModelInfo`, `PiModelInfo`, `PiThinkingLevel`, `CodexModelsResponse`, `PiModelsResponse`, and existing account-resolution helpers.

Produces these shared additions, using the existing shared barrel exports:

```ts
// types/agent.ts. Public diagnostics contain no credentials or raw account response.
type CodexAccountStatus =
    | { state: "signed-in"; label: string }
    | { state: "signed-out" }
    | { state: "unknown" };

// types/ws.ts. Same MSG.CODEX_MODELS = "codex:models".
interface CodexModelsPayload {
    account?: string; // id/name/"default"; absent means inherit through project/default
    projectId?: string;
}
interface CodexModelsResponse {
    models: CodexModelInfo[];
    account: CodexAccountStatus;
}

// Addition to PiModelInfo, optional for an older attached backend/table fallback.
interface PiModelInfo {
    // Existing fields remain unchanged.
    supportsXhigh?: boolean;
}

// Additive field on the existing PiModelsResponse.
interface PiModelsResponse {
    models: PiModelInfo[];
    defaultModel?: string; // full provider/id from get_state, if available
}

// utils/pi-thinking.ts, imported by backend and UI.
declare function supportsPiXhigh(model: unknown): boolean;
declare function normalizePiThinkingLevel(
    level: PiThinkingLevel,
    supportsXhigh: boolean,
): PiThinkingLevel;
```

Discovery functions and their injected process adapter stay in `runtime-detector.ts`. Export the functions because the handler, launch normalizer and tests use them; keep adapter types local when type inference suffices.

```ts
interface ProbeProcess {
    stdout: ReadableStream<Uint8Array>;
    stderr: ReadableStream<Uint8Array>;
    write(line: string): Promise<void>;
    end(): Promise<void>;
    exited: Promise<number>;
    kill(): void;
}
interface ProbeDeps {
    now?: () => number; // defaults to Date.now; shared RPC/fallback budget
    resolveCli?: (name: string, path: string) => string | null;
    spawn?: (argv: string[], options: {
        env: Record<string, string | undefined>;
        cwd?: string;
    }) => ProbeProcess;
    schedule?: (callback: () => void, delayMs: number) => () => void;
}
// Default adapter wraps Bun.which/Bun.spawn and its FileSink, with pipe stdio.
declare function fetchCodexModels(
    env?: Record<string, string | undefined>,
    deps?: ProbeDeps,
): Promise<CodexModelsResponse>;
declare function fetchPiModels(
    options?: { env?: Record<string, string | undefined>; cwd?: string },
    deps?: ProbeDeps,
): Promise<PiModelsResponse>;

// handlers/agent-discovery.ts
declare function registerAgentDiscoveryHandlers(deps: {
    router: Router;
    taskStore: Pick<TaskStore, "getProject">;
    settingsStore: Pick<SettingsStore, "get">;
    fetchCodexModels: typeof fetchCodexModels;
}): void;

// ui/lib/agent-discovery.ts
declare function loadCodexDiscovery(
    backendId: string,
    payload: CodexModelsPayload,
): Promise<CodexModelsResponse>;

// services/pi-options.ts; used only when a Pi launch requests xhigh.
declare function normalizePiLaunchOptions(
    options: PiLaunchOptions,
    context: { env: Record<string, string | undefined>; cwd?: string },
    discover?: typeof fetchPiModels,
    budgetMs?: number, // default PI_LAUNCH_DISCOVERY_BUDGET_MS = 10_000, private constant
): Promise<PiLaunchOptions>;
```

`CodexModelSelect`/`CodexOptions` gain `account?: string`, `projectId?: string`, `discoveryKey?: string` and an optional `loadDiscovery?: typeof loadCodexDiscovery`. `CodexSection` gains `defaultAccount: string`, `discoveryKey: string` and optional `loadDiscovery?: typeof loadCodexDiscovery` and forwards them. `AgentOptionsPanel`/`AgentOptionsDialog` gain `projectId?: string`; the panel also accepts optional `loadDiscovery?: typeof loadCodexDiscovery` for its Codex child. `AgentAccountsSection` gains optional `backendId?: string | null` and `loadDiscovery?: typeof loadCodexDiscovery`. `PiModelSelect` gains `onModelsChange?: (response: PiModelsResponse) => void` and `loadModels?: (backendId: string) => Promise<PiModelsResponse>`; `PiOptions`/`PiSection` forward the same optional injected loader. Defaults use `sendRequest`, so normal callers need no test-specific setup.

## Behavior

### Codex environment, protocol and diagnostics

- The handler accepts `{}` and an omitted payload for existing consumers. Reject non-object/non-string supplied fields with exactly `Invalid Codex discovery request`. Treat UI `inherit` as absent before sending; the backend also translates it to absent rather than resolving it as a named account.
- Resolve `projectId` on the receiving backend with `getProject`. An unknown supplied project rejects with `Project not found: ${projectId}`. Obtain that backend's current settings. Build probe env with `headlessAgentEnv("codex", { type: "codex", account }, settings, project)`. This reuses launch → project → global-default precedence, inherited `CODEX_HOME`, named-home overrides and the cleaned shell PATH. Never mutate `process.env` or accept a client-supplied home directory.
- Explicit `account: "default"` pins the built-in inherited home even when another account is the global default. A missing account inherits. Preserve the resolver's exact unknown-account error, for example `Unknown Codex account "gone" (from launch options)`.
- Spawn `codex app-server --listen stdio://` with the resolved env. Reuse the existing initialize parameters and `initialized` notification. Give every subsequent request its own numeric id and match responses by id across arbitrary newline/chunk boundaries and interleaved notifications. Extract the existing model-entry normalization into a private helper; keep `parseCodexAppServerOutput(output)` working for its current id-2 fixtures by calling that helper.
- Read `account/read` with `{}` before model discovery. Never send login/logout, token refresh requests, thread creation or prompts. Reduce the response to the diagnostic union. `chatgpt` uses its non-empty email or `ChatGPT`; `apiKey` uses `API key`; `amazonBedrock` uses `Amazon Bedrock`. An explicit null account means `signed-out`; a missing/malformed account result or failed request means `unknown`. Do not expose auth files, tokens, raw records or plan data.
- Request `model/list` first with `{}`, then with `{ cursor: nextCursor }` until the cursor is null, absent or empty. Preserve page order, keep the first model for a duplicate id, and filter hidden models after normalization. A repeated cursor or failed/malformed later page is a failed inventory, never a silently complete first page. Return `models: []` for that failure while retaining any valid account diagnostic already read.
- Keep the existing 60,000 ms model-list deadline for the entire probe, not per page. Missing CLI, timeout and protocol failure return an empty inventory with `unknown` account unless valid diagnostics already arrived. Do not classify a transport failure as signed out. Always cancel the deadline, close stdin and terminate/release the child/streams on success or failure. Cleanup must not wait indefinitely after the deadline.
- Change the index registration to the extracted handler and injected real function. Existing model consumers still read `.models`; the additive `.account` does not require a TUI change. Do not add a generic provider framework.

Why: t3code `apps/server/src/provider/CodexProvider.ts:353`, `:469`, `:525` follows cursors, supplies the chosen home and reads account status.

### Codex UI and launch context

- Remove the backend-only Codex model cache in `CodexModelSelect`. Use cancellable uncached requests through `loadCodexDiscovery`, shared with account diagnostics. Existing `createPerBackendCache` only accepts a backend id and cannot identify an account/home change. Do not change that helper for this section.
- Refetch on backend, account, project or account-configuration identity changes. Compute `discoveryKey` from backend-scoped Codex `accounts`/`defaultAccount` and the matching backend/project's Codex account override. Clear model data and call `onModelsChange([])` before loading a new context; ignore late answers for the old context. Key the `CodexOptions` instance by that context so its reasoning-level effect cannot apply the previous account's model capabilities during the transition.
- Settings passes `settings.codex.defaultAccount` to `CodexSection` and primary's id to account diagnostics. Each saved Codex account row probes its own id. Add one diagnostic row for built-in `default` as well. Unsaved draft homes are not probe targets; probe only after the existing blur/save round-trip. Refetch when a saved row's home changes, and on remount. Claude rows retain their current behavior.
- Exact text: `Checking sign-in...`, `signed in as ${label}`, `not signed in`, `Sign-in status unavailable`. Use `Default account` for the built-in diagnostic row. A failed probe must not show `not signed in`. Authentication status does not block custom model entry or a launch; the CLI remains authoritative.
- Preserve current model strings `Codex default`, `Loading models...` and `Search models... (Enter for custom)`, custom-entry behavior and model-specific reasoning controls. Empty inventories and probe failures retain the existing text-input fallback. A selected model absent from an account's inventory remains visible as its saved value.
- In `AgentOptionsPanel`, pass explicit selected account or `undefined` when the selected value is `inherit`; pass the caller's project id. Continue emitting an absent account for inherited launch options. Do not resolve inheritance on the client and persist the resolved account accidentally.
- Carry project context through the verified callers: `TaskCard` uses `task.projectId`; `NewTaskDialog` and `ScheduleForm` use their selected `projectId`; `ActionEditor` passes its selected project and its `backendId`; `AgentDropdownMenu` uses `useActiveWorkspace().project?.id`, forwarding through `AgentOptionsDialog`. Master has no project. Query the receiving backend's settings/project data, even for remote workspaces.
- For inline actions in a project-scoped flow, forward `FlowEditor`'s existing `backendId` and selected `projectId` through `FlowActionList` and `InlineActionEditor` to `AgentOptionsPanel`. Add those optional props to the two intermediate components; no new store or account resolver is needed.
- Reusable action definitions with no fixed launch project are covered by the open question below. Do not silently claim that a global-default probe represents every eventual launch account.

Implementation detail: an uncached request per active account/context is simpler than adding a second cache-key and invalidation system. Share request construction, not credential state.

### Pi capability evidence and discovery

The installed CLI is `@earendil-works/pi-coding-agent` 0.74.2. Source inspection, not a live model/provider call, established:

- Its `dist/cli/list-models.js:51` prints only `reasoning` as the `thinking` yes/no column. `--list-models` cannot establish `xhigh` support.
- Its `dist/modes/rpc/rpc-mode.js:370` returns `session.modelRegistry.getAvailable()` in `get_available_models`, including each resolved model's `thinkingLevelMap`. Its `dist/core/model-registry.js:208` merges model overrides; reading only the user's models.json would omit built-ins and merged metadata.
- Its `dist/cli/args.js:53` supports `--no-session`, and `:27` supports `--mode rpc`. t3code independently uses `get_state` and `get_available_models` in `packages/provider-pi/src/server/status.ts:158`.

These installed-package paths are evidence, not paths to hard-code in Taskflow. Use the CLI found through `buildShellPath` on the receiving machine, including remote machines.

- Probe `pi --mode rpc --no-session` without a prompt. Keep its normal extension/model discovery, so custom model registrations are not silently removed. Send `{"id":"taskflow-state","type":"get_state"}` and `{"id":"taskflow-models","type":"get_available_models"}` as newline-delimited requests. Match each response by id and require `type: "response"`, the expected `command`, and `success: true`. Never send `prompt`, `set_model` or `set_thinking_level`. Kill the ephemeral child after discovery.
- Reuse the Codex process adapter, line/chunk reader and single overall 60,000 ms deadline. Pi's protocol is different; share only byte transport/deadline/cleanup helpers. Drain stderr without returning it to clients.
- Honor an explicitly supplied probe env, including its PATH and Pi home variables. Without one, use the existing cleaned backend environment and `buildShellPath`. For the table fallback, retain the current stdout-first/stderr-second behavior, with the same env/cwd and remaining deadline.
- Normalize raw models into the existing fields plus `supportsXhigh`. Use raw `provider`, `id`, `contextWindow`, `maxTokens`, `reasoning` and `input`; skip entries without a string provider/id and deduplicate by full `provider/id`. Format token counts as K/M display strings, matching the table's existing labels. Forward no raw headers or model configuration.
- `supportsPiXhigh` follows t3code's opt-in rule exactly for Taskflow's existing levels: require `reasoning === true`, a non-array object `thinkingLevelMap`, and an `xhigh` value that is neither null nor undefined. No model-name allowlist, provider heuristic or inference from `thinking: yes`. Preserve Taskflow's level union through `xhigh`; do not add t3code's `max` level.
- Derive optional `defaultModel` from the full provider/id of `get_state`'s current model. If state discovery fails but model discovery succeeds, return the models without a default. If RPC is unavailable/fails before the deadline, retain the existing `--list-models` fallback with its existing parser and leave `supportsXhigh` absent. Run the fallback through the injected process adapter with only the remaining discovery budget. If the deadline has expired, return an empty inventory instead of starting another 60,000 ms probe. The fallback cannot advertise xhigh. An older CLI or backend without metadata is also unproven support.
- Keep the table parser's current public signature and existing tests. Its lack of xhigh data is intentional. No direct import of the installed package, vendored registry, model-name table or hand-parsed models.json.

Why: t3code `packages/provider-pi/src/server/thinkingCapabilities.ts:67` requires model opt-in for extended levels.

### Pi selection and launch normalization

- `normalizePiThinkingLevel` returns `high` only when its input is `xhigh` and support is false; all other existing levels pass through. Reuse this function for the visible selector value and emitted/launch options. Keep existing lower-level choices unchanged in this adoption.
- `PiModelSelect` loads inventory on mount/context change, rather than waiting until its popover first opens, and reports it through `onModelsChange`. This lets `PiOptions` know capability before the user opens either picker. Clear inventory on backend changes and ignore stale results. Preserve custom entry and the current model badges.
- `PiOptions` matches the full `provider/id` selected value, or `defaultModel` when unset. Include `xhigh` only when `supportsXhigh === true`. Show a saved unsupported or unproven `xhigh` as `High` immediately, including loading/failure states, using the shared normalization function. Wait until discovery settles before automatically calling `onThinkingChange("high")`; a loading render must not erase a saved xhigh that the answer will prove supported. After settlement, model/capability changes emit high when support is absent. New picker choices cannot select xhigh while it is unproven, and the backend normalizes launches even when the UI lookup is still pending. Keep the existing label `Xhigh` for the supported option, `High` for the fallback, and the existing CLI hints `Reasoning level (--thinking)`/`Model for Pi session (--model)`.
- UI normalization alone is insufficient for a saved schedule/action or headless request. `normalizePiLaunchOptions` returns the original options without probing unless `thinking === "xhigh"`. For xhigh, discover using the actual launch env/cwd. Match an exact full model key, or the probe's `defaultModel` if the option is absent; preserve xhigh only on an explicitly supporting model. Unknown/custom shorthand model values and discovery failure normalize to high. Return a copied options object; do not rewrite settings/action/schedule files.
- Add `discoverPiModels?: typeof fetchPiModels` to `SessionLifecycleDeps`; call the shared backend normalizer after settings/default merge and before storing `effectiveAgentOptions`/building the launch command. Use the launch cwd and `headlessAgentEnv("pi", resolvedAgentOptions, settings, project)` for the same cleaned environment and shell PATH used by PTY launches. This covers session creation and resumption, flow steps and schedules through their existing lifecycle path. Catch discovery rejection in the normalizer and return the high fallback rather than failing an otherwise valid launch. **Launch budget:** the normalizer runs inside `SESSION_CREATE` and the HTTP create/resume routes, and both clients time requests out at 30 000 ms (`ui/src/lib/connection.ts:9`, `tui/src/net/client.ts:26`). It therefore gives discovery its own 10 000 ms budget, not the 60 000 ms model-list deadline: past it, the launch goes ahead with `high` and the probe child is killed and released. A slow probe must never make the client see a failed create and then a late spawn.
- Add an optional second deps parameter to `runHeadlessAgent`, `{ discoverPiModels?: typeof fetchPiModels; spawn?: typeof Bun.spawn }`, with real defaults. Normalize a Pi request's options with the request's env/cwd before calling `buildHeadlessCommand`. New tests use those deps rather than replacing global `Bun.spawn`. Leave synchronous command builders and existing real flags unchanged.
- `PiSection` continues to use the shared `PiOptions` implementation for defaults. Headless mode continues to omit tools. Do not change the POSIX or TS taskflow-cli commands; this section changes agent discovery and launches, not Taskflow CLI syntax.

Implementation detail: probe only xhigh launches that need capability evidence. Use the existing deadline and conservative high fallback instead of persisting a capability registry.

If copying either small t3code algorithm, retain the exact attribution form, for example `// Adapted from t3code (MIT, https://github.com/pingdotgg/t3code, 32ecd717): packages/provider-pi/src/server/thinkingCapabilities.ts`. Reimplementation must remain plain Bun/TypeScript with no Effect dependency.

## Task 9.1: Codex account environment, pages and diagnostics

### Steps

- [ ] **Step 1:** Extend `runtime-detector.test.ts` with a fake duplex process injected through `ProbeDeps`. Make replies depend on actual request ids/cursors and split responses across chunks. Keep existing parser/version tests. Name new tests:
  - `Codex discovery follows every nextCursor and filters hidden models`
  - `Codex discovery preserves page order and deduplicates model ids`
  - `Codex discovery matches response ids across chunks and notifications`
  - `Codex discovery passes the supplied CODEX_HOME without changing process.env`
  - `Codex discovery reads account status without login or token refresh`
  - `Codex account diagnostics distinguish ChatGPT, API key, Bedrock and signed out`
  - `Codex protocol failure is unknown rather than signed out`
  - `a failed page or repeated cursor never returns a partial model inventory`
  - `a failed model inventory retains an already read account diagnostic`
  - `the whole Codex probe has one deadline and always releases its child`

  Write `handlers/agent-discovery.test.ts` with `TestRouter`, injected store/settings functions and recorded probe env. Extend `agent-accounts.test.ts` only for missing precedence coverage; reuse `settingsWith`, `projectWith`, `emptyEnv` and existing helpers.
  - `Codex discovery resolves explicit account before project before global default`
  - `Codex default pins the inherited home even when a named account is global default`
  - `Codex discovery uses the receiving backend's settings and preserves inherited CODEX_HOME`
  - `Codex discovery rejects an unknown project or account before spawning`
  - `an omitted Codex discovery payload keeps existing clients working`
- [ ] **Step 2:** Run `bun test packages/backend/tests/services/runtime-detector.test.ts packages/backend/tests/services/agent-accounts.test.ts packages/backend/tests/handlers/agent-discovery.test.ts`. Expected: FAIL on missing contracts/handler and pagination/account behavior.
- [ ] **Step 3:** Implement shared Codex payload/status types, the process adapter, complete protocol exchange and the extracted handler. Reuse `headlessAgentEnv`/`resolveAgentAccount` unchanged. Wire the index registration. Update only affected fixtures to the additive response shape.
- [ ] **Step 4:** Run the Step 2 command. Expected: PASS. Inspect fake transcripts to assert exact argv, env, request methods and cursor bodies; do not assert source text or require a real signed-in account.
- [ ] **Step 5:** Run `bun run typecheck`, `bun test packages/backend/tests`, `bun test packages/shared` and `bun test packages/tui/src/settings`. Expected: PASS. The last suite protects the existing `.models` consumer. Run changed-path Prettier/ESLint and `git diff --check`; classify independently reproduced baseline failures separately.
- [ ] **Step 6:** Stage only reviewed Task 9.1 paths and commit `fix(agents): discover all Codex models with the selected account`. No push or trailers.

## Task 9.2: Codex model selection and per-account diagnostics

### Steps

- [ ] **Step 1:** Write the new Codex picker/options/section tests and extend `AgentAccountsSection.test.tsx` using its real DOM helpers and an injected `loadDiscovery` promise. Seed/reset actual zustand stores where needed. Add `AgentOptionsPanel.discovery.test.tsx` independently of the older module-mocked file. Use optional request-loader deps on the components under test; no new `mock.module`.
  - `Codex settings queries the configured default account on primary`
  - `Codex launch options query the selected account on the launch backend`
  - `Codex inherited launch discovery carries projectId without pinning an account`
  - `switching Codex accounts clears models and ignores the old reply`
  - `changing a saved Codex home refetches its models and diagnostics`
  - `a backend switch never retains the previous account's model capabilities`
  - `each saved Codex account and built-in default shows its own sign-in status`
  - `a failed account probe shows Sign-in status unavailable`
  - `incomplete account drafts are not probed before save`
  - `Claude account editing does not start a Codex probe`
  - `Codex custom model entry and empty-inventory fallback remain available`
  - `a selected account's supported reasoning levels drive Codex options`
- [ ] **Step 2:** Run `bun test packages/ui/src/components/settings/CodexModelSelect.test.tsx packages/ui/src/components/shared/CodexOptions.test.tsx packages/ui/src/components/settings/sections/CodexSection.test.tsx packages/ui/src/components/settings/sections/AgentAccountsSection.test.tsx packages/ui/src/components/workspace/AgentOptionsPanel.discovery.test.tsx`. Expected: FAIL.
- [ ] **Step 3:** Implement the shared loader, uncached context-aware effects, props and exact diagnostic text. Carry the verified project/backend contexts through the listed launch callers. Preserve local account drafts and existing save/delete behavior. Apply the planner's answer below before claiming reusable-template context coverage.
- [ ] **Step 4:** Run the Step 2 command. Expected: PASS. Check the listed call sites directly for the forwarded project/backend/account values. Use fake requests in tests; do not open a shared app or start a backend for this step.
- [ ] **Step 5:** Run `bun run typecheck`, `bun test packages/ui` and `bun test packages/backend/tests/handlers/agent-discovery.test.ts`. Expected: PASS. Run changed-path Prettier/ESLint and `git diff --check`.
- [ ] **Step 6:** Commit `feat(settings): show Codex account discovery and sign-in status`. Stage reviewed paths only; no push or trailers.

## Task 9.3: Pi model capability discovery and effective thinking

### Steps

- [ ] **Step 1:** Write `packages/shared/src/utils/pi-thinking.test.ts`, using raw model objects rather than provider names:
  - `xhigh requires reasoning and an explicit non-null thinkingLevelMap entry`
  - `missing, null, malformed and non-reasoning metadata do not advertise xhigh`
  - `unsupported xhigh normalizes to high and all other levels pass through`

  Extend `runtime-detector.test.ts` using the same injected duplex process from Task 9.1:
  - `Pi RPC discovery reads resolved model thinkingLevelMap values`
  - `Pi discovery reads the default full model key from get_state`
  - `Pi discovery correlates response ids and never sends a prompt`
  - `Pi RPC failure falls back to table models without claiming xhigh support`
  - `Pi discovery has one deadline and releases the ephemeral process`

  Write `PiModelSelect.test.tsx`/`PiOptions.test.tsx` with injected loaders:
  - `Pi inventory loads before the model popover opens`
  - `Pi offers Xhigh only for the selected model with declared support`
  - `Pi shows and emits High for a saved unsupported xhigh`
  - `Pi loading does not overwrite a saved xhigh that discovery proves supported`
  - `Pi default-model capability comes from the discovery response`
  - `Pi missing metadata and a late backend reply cannot enable Xhigh`
  - `Pi model changes normalize thinking while preserving tools and custom input`

  Write `pi-options.test.ts` and extend the existing session/headless tests with injected discovery and recorded argv:
  - `non-xhigh Pi launch options do not start discovery`
  - `a saved Pi action or schedule sends --thinking high when xhigh is unsupported`
  - `an explicitly supporting Pi model retains --thinking xhigh`
  - `Pi normalization uses the effective model after session defaults are merged`
  - `Pi discovery failure and unknown shorthand models fall back to high`
  - `headless Pi normalization uses request env and cwd without rewriting options`
  - `resumed Pi sessions normalize saved xhigh before building their PTY command`
  - `a Pi probe slower than the launch budget falls back to high, spawns once within the budget and releases the probe` (injected clock/discovery: with a probe that never answers, the launch spawns with `--thinking high` once the clock passes 10 000 ms and not before; the probe child is killed by then; advancing past the 60 000 ms discovery deadline afterwards causes no second spawn and no late write of options)
- [ ] **Step 2:** Run `bun test packages/shared/src/utils/pi-thinking.test.ts packages/backend/tests/services/runtime-detector.test.ts packages/backend/tests/services/pi-options.test.ts packages/backend/tests/handlers/session.test.ts packages/backend/tests/services/headless-agent.test.ts packages/ui/src/components/settings/PiModelSelect.test.tsx packages/ui/src/components/shared/PiOptions.test.tsx`. Expected: FAIL.
- [ ] **Step 3:** Implement the two shared pure helpers with attribution where adapted, the additive Pi model/default fields and RPC/table discovery. Implement the common backend normalizer and call it at both launch boundaries through injected deps. Implement eager Pi UI discovery, capability-gated options and visible/emitted high fallback. Reuse the same helper in settings and launch panels; leave actual CLI flags and synchronous command builders intact.
- [ ] **Step 4:** Run the Step 2 command and `bun test packages/backend/tests/services/internal-agent-skill.test.ts`. Expected: PASS. Assert actual emitted Pi argv and persisted session options for the lifecycle fixture, alongside the visible selector value. Discovery tests must not call installed agents or providers.
- [ ] **Step 5:** Run `bun run typecheck`, `bun test packages/backend/tests`, `bun test packages/shared`, `bun test packages/ui` and `bun test packages/tui/src/settings`. Expected: PASS. Run changed-path Prettier/ESLint and `git diff --check`. Do not run root formatting or start shared simulators/apps.
- [ ] **Step 6:** Commit `fix(agents): gate Pi xhigh on discovered model support`. Stage only reviewed paths; no push or trailers. Record commits, validation and the planner's template decision in the chain handoff.

## Planner decisions (2026-10-30)

1. **Templates with no launch project preview the owning backend's global-default account.** Label the preview exactly `Models for the default account; launch may inherit a project account`. Launch-time account inheritance is unchanged. Task 9.2 can complete with this.
