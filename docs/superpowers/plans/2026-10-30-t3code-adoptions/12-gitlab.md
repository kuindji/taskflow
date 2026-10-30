# Section 12: GitLab merge requests

Read `handoff.md`, `design.md` §9 and `reviews/research-5-git-desktop.md`. Anchors were verified on 2026-10-30. Keep one small host switch behind `git-pr.ts`; reuse command and normalization rules from t3code `packages/source-control-gitlab/src/server/GitLabCli.ts` and `packages/source-control-gitlab/src/server/gitLabMergeRequests.ts`.

**Files:**

- Modify: `packages/backend/src/services/git-pr.ts:21`, `:49`. Replace hardcoded GitHub creation/lookup with two private command branches and shared result validation. Keep commit and commit-message generation in place.
- Modify: `packages/backend/src/services/git-service.ts:35`, `:478`, `:486`. Add optional injected PR dependencies to the existing service; forward the new named return types. Keep other service methods unchanged.
- Modify: `packages/backend/src/handlers/git.ts:201`, `:211`, `:226`. Persist provider/state on creation and return the discriminated lookup result directly.
- Modify: `packages/shared/src/types/git.ts:17`, `packages/shared/src/types/task.ts:33`, `packages/shared/src/types/ws.ts:532`, `packages/shared/src/constants.ts:9`. Reuse `TaskWorktreePr`, extend it compatibly, add `GitCheckPrResult` alongside the existing Git types and increment the then-current protocol version once for the changed required lookup contract. These modules already export through `packages/shared/src/index.ts:6`, `:7`, `:9`.
- Extend: `packages/backend/tests/services/git-pr.test.ts:6`, `packages/backend/tests/handlers/git.test.ts:11`. Inject a fake command runner and auth results, never real account/provider calls.
- Create: `packages/ui/src/stores/pull-request-store.ts`, `packages/ui/src/stores/pull-request-store.test.ts`, `packages/ui/src/lib/pull-request-labels.ts`, `packages/ui/src/lib/pull-request-labels.test.ts`, and `packages/ui/src/components/workspace/CommitDialog.gitlab.test.tsx`.
- Modify: `packages/ui/src/components/sidebar/hooks/useSidebarData.ts:107`, `:127`; `packages/ui/src/components/sidebar/TaskCard.tsx:321`; `packages/ui/src/components/workspace/TaskHeader.tsx:73`, `:121`, `:160`; `packages/ui/src/components/workspace/CommitDialog.tsx:105`, `:141`, `:188`, `:267`, `:274`, `:298`, `:382`.
- Reuse: `packages/ui/src/stores/store-reset.ts:10` for backend-scoped invalidation; `packages/ui/src/lib/connection-registry.ts:131`'s existing `sendRequest` through the new store. Use the real socket fixture in `packages/ui/src/lib/test-ws-server.ts:21`, as `packages/ui/src/stores/file-store.test.ts:42` does. The existing `packages/ui/src/components/workspace/CommitDialog.test.tsx:15` uses module mocks; do not copy them into new tests.

**Interfaces:**

Consumes `origin`'s remote URL, the branch supplied to `GIT_CHECK_PR`, and existing `GIT_CREATE_PR` fields. Produces provider-aware request metadata and explicit lookup availability. `MSG.GIT_CREATE_PR`, `MSG.GIT_CHECK_PR`, and their payloads keep their existing names and fields. No generic provider registry and no CLI commands/flags are added.

```ts
// types/git.ts
type GitPrProvider = "github" | "gitlab";
type GitPrState = "open" | "closed" | "merged";
type GitPrUnavailableReason =
  | "cli-missing"
  | "not-authenticated"
  | "failed"
  | "unsupported-host";
type GitCheckPrResult =
  | {
      status: "found";
      provider: GitPrProvider;
      pr: TaskWorktreePr & { provider: GitPrProvider; state: GitPrState };
    }
  | { status: "none"; provider: GitPrProvider; pr: null }
  | {
      status: "unavailable";
      provider: GitPrProvider | null;
      pr: null;
      reason: GitPrUnavailableReason;
      message: string;
    };

// types/task.ts. Optional only for pre-existing saved task records.
interface TaskWorktreePr {
  number: number;
  url: string;
  provider?: GitPrProvider;
  state?: GitPrState;
}
// ws.ts. New creation results always include both fields.
interface GitCreatePrResult extends TaskWorktreePr {
  provider: GitPrProvider;
  state: GitPrState;
}

// git-pr.ts. Export the deps because GitService passes them through.
interface GitPrDeps {
  remoteUrl(repoPath: string): Promise<string | null>;
  branch(repoPath: string): Promise<string | null>;
  which(command: "gh" | "glab"): string | null;
  run(input: {
    command: string;
    args: string[];
    cwd: string;
    env?: Record<string, string>;
    stdin?: string;
  }): Promise<{ stdout: string; stderr: string; exitCode: number }>;
}
function createPr(
  repoPath: string,
  title: string,
  body?: string,
  deps?: GitPrDeps,
): Promise<GitCreatePrResult>;
function checkBranchPr(
  repoPath: string,
  branch: string,
  deps?: GitPrDeps,
): Promise<GitCheckPrResult>;
// GitService constructor becomes constructor(deps?: { pr?: GitPrDeps }).
// Existing zero-argument construction and commit methods remain valid.

// pull-request-store.ts. One current result per backend/repo/branch, no durable cache.
interface PullRequestStore {
  byKey: Record<string, GitCheckPrResult>;
  check(
    backendId: string,
    repoPath: string,
    branch: string,
  ): Promise<GitCheckPrResult>;
}
// Export usePullRequestStore, used by sidebar, header and dialog.
// Export key helper only because those three selectors consume it.
function pullRequestKey(
  backendId: string,
  repoPath: string,
  branch: string,
): string;
// pull-request-labels.ts, consumed by all three renderer components.
function pullRequestLabels(provider: GitPrProvider | null): {
  short: "PR" | "MR" | "Request";
  create: string;
  title: string;
  titleField: string;
  agentInstruction: string;
};

// CommitDialog.tsx. The existing exported CommitDialog is the hook-using wrapper.
// Export the body because its no-mock tests import it directly.
function CommitDialogBody(
  props: CommitDialogProps & {
    backendId: string | null;
    defaultAgent: AgentType;
    request<T>(type: string, payload?: unknown): Promise<T>;
    checkPr(branch: string): Promise<GitCheckPrResult>;
    createSession: ReturnType<typeof useSessionStore.getState>["createSession"];
  },
): React.JSX.Element;
```

Implementation detail: use `origin`, matching the existing `GitService.getRemoteUrl`, and store transient lookup failures in UI memory rather than in saved task records.

## Behavior

### Host selection and failures

- Parse HTTPS, SSH URL and scp-style remotes, including subgroup paths and optional `.git`. Extract lowercase host plus full project path; never shell-split the URL. Strip credentials before diagnostics or CLI args. Local filesystem remotes or an absent origin give unavailable with provider null and reason `unsupported-host`. Why: host routing keeps the adapter narrow and prevents GitLab from being sent to `gh`.
- `github.com` always selects GitHub; `gitlab.com` always selects GitLab, regardless of which other accounts are logged in. For any other host, run host-specific auth status for installed CLIs: `gh auth status --hostname <host>` and `glab auth status --hostname <host>`. Exit zero recognizes that provider. Never use `--show-token`, print auth stdout/stderr, parse credential files or trigger an auth login command. Both-success handling is the open question below.
- For a selected provider, absent CLI yields reason `cli-missing`. Auth failure yields `not-authenticated`; command failure, process spawn failure, malformed JSON or malformed records yield `failed`. Return `none` only after a successful, valid empty list. A transport/auth/parse failure is never an empty list.
- Unknown self-hosted remotes for which neither CLI proves a login give `unsupported-host`, with no provider guess. Known public hosts with invalid login return `not-authenticated`. Preserve non-secret command failure details only for the create error; lookup uses the exact generic failed-status message below.
- Resolve CLIs through the existing shell PATH, not Electron's minimal PATH. Default deps use `GitService`'s existing branch/remote-query behavior without recursively invoking PR methods. The runner uses argv and stdin with `GIT_TERMINAL_PROMPT=0`, `GH_PROMPT_DISABLED=1`, and `NO_COLOR=1`. Never inherit a pre-set `GH_HOST`/`GITLAB_HOST` that could route these operations elsewhere; override with the parsed host for the selected tool.
- Exact unavailable messages: `GitHub CLI is not installed`, `GitLab CLI is not installed`, `GitHub CLI is not authenticated for <host>. Run gh auth login --hostname <host>`, `GitLab CLI is not authenticated for <host>. Run glab auth login --hostname <host>`, `Pull request status is unavailable`, `Merge request status is unavailable`, and `No supported pull request provider for remote host <host>`. For no usable remote substitute `unknown` for `<host>`.

### GitHub and GitLab operations

- If adapting source blocks, annotate the command branch with `// Adapted from t3code (MIT, https://github.com/pingdotgg/t3code, 32ecd717): packages/source-control-gitlab/src/server/GitLabCli.ts` and the normalizer with the same prefix ending `packages/source-control-gitlab/src/server/gitLabMergeRequests.ts`. Keep both helpers private to `git-pr.ts`.
- GitHub keeps `gh pr create` with explicit title/body, repository and head branch; pass the body through `--body-file -` and stdin, including empty bodies. Example argv: `gh pr create --repo <host>/<owner>/<repo> --head <branch> --title <title> --body-file -`. Extract and validate the created `/pull/<positive number>` URL. Return provider `github`, state `open`; do not return number zero on parse failure. Keep create operations unbounded by Section 8's read-only Git deadline.
- GitHub find/status uses `gh pr list --repo <host>/<owner>/<repo> --head <branch> --state all --json number,url,state --limit 100`. Normalize `OPEN`, `CLOSED`, `MERGED` to the shared lowercase values. Choose an open request first, otherwise the greatest request number. A successful empty JSON array is `none`.
- GitLab find/status follows t3code's list command: `glab mr list --repo <canonical project URL> --source-branch <branch> --all --per-page 100 --output json`. Normalize `iid`, `web_url`, `state`; `iid` is the project-local MR number, never global `id`. Require positive integer iid, HTTP(S) URL, and a recognized state `opened`, `open`, `closed`, `merged`. Choose open first, otherwise greatest iid. Do not silently drop malformed entries and then claim none. Why: `gitLabMergeRequests.ts` maps GitLab's provider fields to request metadata.
- GitLab creation uses t3code's JSON API pattern, avoiding interactive `mr create` prompts. With `--hostname <host>` on each call, first `glab api projects/<percent-encoded full project path>` to read and validate `default_branch`. Then `glab api --method POST projects/<encoded project>/merge_requests --raw-field source_branch=<branch> --raw-field target_branch=<default branch> --raw-field title=<title> --raw-field description=<body or empty>`. Each complete `key=value` is one argv element; no interpolation into a shell, temporary file, or logs. Normalize the response through the same GitLab record validator and return provider `gitlab`.
- t3code uses a body file for its own API call; here one raw-field argument is sufficient for the existing string API. Preserve newlines, quotes, dollar signs and leading dashes exactly in tests. Do not add push, checkout, merge, approvals, comments, review requests or branch deletion. Existing CommitDialog push behavior stays responsible for pushing.
- Reject creation without a current branch as `Cannot create a request from a detached HEAD`. Reject unsupported provider/CLI/auth with the same selected unavailable message. A successful create with unusable response throws `Request created, but its details could not be read. Refresh request status before retrying.` Do not automatically retry creation, since the request may already exist.
- The selected t3code files provide GitLab API/list patterns and normalization. Official CLI references confirm [host-specific authentication](https://docs.gitlab.com/cli/auth/status/), [MR list JSON/all-state flags](https://docs.gitlab.com/cli/mr/list/), and [the interactive create behavior avoided here](https://docs.gitlab.com/cli/mr/create/). No live GitLab mutation or account probe is part of implementation tests.

### Protocol, persistence and UI

- `GIT_CHECK_PR` returns `GitCheckPrResult` directly, replacing `{ pr }`; its success variants retain that field. `GIT_CREATE_PR` returns `GitCreatePrResult`. The create handler persists the whole normalized metadata object under the task's existing `worktree.pr` and broadcasts the update. Keep its current behavior of not failing a successful remote create merely because task persistence failed.
- Existing stored entries without provider/state are GitHub/open for display because the old adapter created GitHub requests only. Do not rewrite saved records on load. A later successful status poll can replace them with explicit metadata.
- `pull-request-store` keys by `JSON.stringify([backendId, repoPath, branch])`, de-duplicates only concurrent checks, and stores the most recent result. It does not cache success forever or silently reuse another machine's status. Register `pull-request-store` with `registerBackendReset`; reset invalidates that backend's results and in-flight generations. A late answer from a previous backend/reset/branch must not overwrite current state. Connection failures produce unavailable/failed state, not none.
- Sidebar retains its 30-second polling cadence but includes tasks that already have a saved request so merged/closed states can refresh. Only `found` updates `worktree.pr`, and only when metadata differs. `unavailable` preserves saved metadata and remains visible through the status store; `none` does not erase a saved link. Stop overlapping polling passes by sharing the store's in-flight promise for a key.
- Header requests status for its current backend/repository/branch and reads that key only. CommitDialog uses its initial `GIT_STATUS` branch and the same store before enabling request creation. Ignore old async answers when repo/backend/branch changes or the dialog closes. Commit-only and push-only operations remain usable during a lookup failure; only request creation waits for known provider and a usable lookup result.
- Label helper values for GitHub are `PR`, `Create PR`, `Create Pull Request`, `PR Title`, `Create a pull request after pushing.` GitLab values are `MR`, `Create MR`, `Create Merge Request`, `MR Title`, `Create a merge request after pushing.` While provider is unknown use `Request`, `Create Request`, `Create Request`, `Request Title`, `Create a request after pushing.` Do not call a known GitLab request a PR while status is unavailable.
- Apply these labels to header actions, dialog title/button/checkbox/expanded title field, and the commit agent prompt at `CommitDialog.tsx:189`. In links/badges show `PR #<number>` or `MR !<number>` and the state. Reuse existing URL opening. For unavailable status show the exact message next to the existing request action or as its tooltip, and offer `Retry`; do not display `No PR`/`No MR` for failure.
- Add optional `request` and `createSession` dependencies to a testable CommitDialog body component, with production hooks in a wrapper. Keep its public props unchanged. The body accepts a provider-aware lookup function through deps as well. New tests render the body with fakes and real DOM components. Do not extend the existing test's `mock.module` usage.

## Task 12.1: Adapter and protocol

- [ ] **Step 1:** Extend `git-pr.test.ts` with a recording fake runner, injected remote/branch and CLI availability: `github.com selects gh even when glab is authenticated`, `gitlab.com selects glab even when gh is authenticated`, `SSH and HTTPS subgroup remotes resolve the same project`, `self-hosted GitHub uses host-specific authentication`, `self-hosted GitLab uses host-specific authentication`, `missing CLI and missing authentication are unavailable`, `a successful empty list is none`, `a failed or malformed list is unavailable`, `GitLab uses iid instead of id`, `opened closed and merged states normalize correctly`, `open requests precede older closed or merged requests`, `GitLab create sends the exact title and multiline description as argv fields`, `GitHub create sends the exact body on stdin`, `invalid creation output never returns request number zero`, `a create parse failure warns against retrying`, `detached HEAD cannot create a request`. Retain the commit-generation tests already in the file.
- [ ] **Step 2:** Extend handler fakes/tests: `GIT_CHECK_PR preserves found none and unavailable states`, `GitLab creation persists provider and state and broadcasts the task`, `successful remote creation survives task metadata persistence failure`. Run `bun test packages/backend/tests/services/git-pr.test.ts packages/backend/tests/handlers/git.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Resolve the dual-provider host question before implementing that selection branch. Add shared types, optional service deps and the private adapters/validators; wire both handlers. Run the Step 2 command. Expected: PASS. No module mocks or real CLI authentication are needed.

## Task 12.2: Provider labels and status availability

- [ ] **Step 4:** Write `pull-request-store.test.ts` against two real test WebSocket servers, following `file-store.test.ts`: `the same repository on two backends has independent MR status`, `concurrent checks share one request`, `unavailable never overwrites saved request metadata`, `backend reset discards late status results`, `a later check retries after unavailable`, `closed and merged requests remain distinguishable from none`. Write label tests: `GitLab uses MR and a merge request agent instruction`, `old metadata without provider uses GitHub labels`, `an unknown provider uses Request until resolution`.
- [ ] **Step 5:** Write `CommitDialog.gitlab.test.tsx` against injected body deps, using real `act`/`createRoot`: `GitLab renders Create MR and MR Title`, `GitLab agent mode requests a merge request`, `a failed lookup shows unavailable and preserves commit controls`, `request creation stays disabled until provider lookup completes`, `a stale GitHub response cannot relabel a new GitLab repository`. Run `bun test packages/ui/src/stores/pull-request-store.test.ts packages/ui/src/lib/pull-request-labels.test.ts packages/ui/src/components/workspace/CommitDialog.gitlab.test.tsx`. Expected: FAIL.
- [ ] **Step 6:** Implement the status store, label helper, sidebar polling, header/card metadata and dialog body/wrapper. Use one label helper everywhere; no scattered host tests in JSX. Run the Step 5 command and `bun test packages/ui/src/components/workspace/CommitDialog.test.tsx`. Expected: PASS.
- [ ] **Step 7:** Run `bun run typecheck`, `bun test packages/backend`, `bun test packages/shared`, `bun test packages/ui` and `bun test packages/tui`. Expected: PASS. Lint changed TS/TSX files and run `bunx prettier --check <changed files>`; format only changed paths. Verify a saved legacy `{ number, url }` still renders without a migration.
- [ ] **Step 8:** Record UI acceptance with fake backend results: GitHub PR, GitLab MR, none, missing CLI, bad auth, failed query, merged MR, and remote machine switch at the same repo path. Confirm Retry rechecks status and does not repeat creation. Do not create real requests or probe user accounts as a test. If opening a local app, inspect running processes first and do not reuse another agent's app.
- [ ] **Step 9:** Run `git diff --check`, stage only this section's files, and commit `feat(git): support GitLab merge requests with explicit status availability`. No push or trailers.

## Planner decisions (2026-10-30)

- **A host authenticated in both `gh` and `glab` is ambiguous.** Status is unavailable, with the exact message `Remote host is authenticated in both gh and glab; provider selection is ambiguous`. github.com and gitlab.com are never ambiguous, since they map by name before the auth check. `design.md` §9 is amended to match.
