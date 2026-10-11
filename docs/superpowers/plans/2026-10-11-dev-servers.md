# Running Dev Servers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agents register the dev servers they start (PID and label) through `taskflow-cli`. The desktop sidebar lists every registered server across connected backends, and each one can be stopped.

**Architecture:**
- **Records:** declared by agents only. They're kept per backend instance in `~/.config/taskflow/dev-servers-<instanceId>.json`.
- **Service:** a `DevServerService` wraps the store and the one-shot process stopper. It broadcasts the full list after every change.
- **Transport:** the CLI talks HTTP; the desktop UI talks WS.
- **Stopping:** a stop runs the PID-reuse guard, then signals the PID's whole process tree, registered PID first, with SIGTERM and then SIGKILL. It reports `ok` or an error.

**Tech Stack:** Bun, TypeScript, POSIX sh, React + zustand, bun:test (happy-dom preload for UI tests).

**Spec:** `docs/superpowers/specs/2026-10-11-dev-servers-design.md`. Read it before starting any section.

**Tracking:** TaskTray `TSK-4` (`task-tray log add TSK-4 --type info "..."`).

## How this plan is laid out

Each section is a separate file in `2026-10-11-dev-servers/`, written so it can be implemented in a fresh session. Before starting a section, read `2026-10-11-dev-servers/handoff.md` (status and facts carried between sections), then the section file and the spec. When a section is done, update the handoff. The chain protocol is in `2026-10-11-dev-servers/chain.md`.

| # | Section | File | Depends on |
|---|---|---|---|
| 1 | Shared types, `DevServerStore`, process stopper, `DevServerService` | `01-backend-core.md` | — |
| 2 | Config path, HTTP routes, WS handlers, wiring in `index.ts` / `routes.ts` | `02-backend-api.md` | 1 |
| 3 | CLI `devserver` group (sh + TS bin), command doc, prompt paragraph | `03-cli-prompt.md` | 2 |
| 4 | Desktop UI: store, bootstrap fetch, toolbar button, popover | `04-ui.md` | 2 |
| 5 | Manual verification, final whole-change review, close-out | `05-verify.md` | 3, 4 |

Sections 3 and 4 are independent of each other.

## Cross-section interfaces (fixed; every section uses these exact names)

**Shared** (`packages/shared/src/types/dev-server.ts`, re-exported the same way `notification.ts` is):

```ts
export interface DevServer {
    id: string;
    pid: number;
    label: string;
    registeredAt: string; // ISO
    projectId: string;
    taskId?: string;
    sessionId?: string;
}
export interface DevServerListResponse {
    devServers: DevServer[];
}
export interface DevServerStopPayload {
    id: string;
}
export type DevServerStopResult = { ok: true } | { ok: false; error: string };
```

`MSG` (`packages/shared/src/constants.ts`, next to the `NOTIFICATION_*` entries):
- `DEV_SERVER_LIST: "devserver:list"`
  - As a WS request: `{}` → `DevServerListResponse`.
  - As a broadcast event: payload `DevServerListResponse`, the full list for that backend.
- `DEV_SERVER_STOP: "devserver:stop"`: WS request `DevServerStopPayload` → `DevServerStopResult`.

**Backend** (Section 1 produces, Section 2 consumes):
- `services/dev-server-store.ts`. It follows `NotificationStore`'s mutation pattern.

  ```ts
  interface DevServerInput { pid: number; label: string; projectId: string; taskId?: string; sessionId?: string }
  class DevServerStore {
      constructor(filePath: string);
      list(): Promise<DevServer[]>;
      get(id: string): Promise<DevServer | null>;
      add(input: DevServerInput): Promise<DevServer>; // same pid → replace label/owner/registeredAt, keep id
      remove(id: string): Promise<boolean>;
      removeByPid(pid: number): Promise<boolean>;
      removeIfUnchanged(server: DevServer): Promise<boolean>; // only while id and registeredAt still match
  }
  ```
- `services/dev-server-service.ts`:

  ```ts
  interface DevServerService {
      list(): Promise<DevServer[]>;
      add(input: DevServerInput): Promise<DevServer>; // validates, throws DevServerInputError
      remove(id: string): Promise<boolean>;
      removeByPid(pid: number): Promise<boolean>;
      stop(id: string): Promise<DevServerStopResult>;
  }
  function createDevServerService(deps: {
      store: DevServerStore;
      broadcast: (event: WsEvent) => void;
      stopProcess?: StopProcess; // injectable for tests; default = real implementation from process-stopper.ts
  }): DevServerService;
  class DevServerInputError extends Error {}
  ```
  Every mutation that changes the list (`add`, a `remove` or `removeByPid` that returns `true`, a `stop` that removes the record) broadcasts `{ type: MSG.DEV_SERVER_LIST, payload: { devServers } }`.
- `services/process-stopper.ts`:

  ```ts
  type StopOutcome =
      | { status: "stopped" }  // tree signalled and gone
      | { status: "gone" }     // pid not running
      | { status: "reused" }   // started after registeredAt; no signal sent
      | { status: "failed"; error: string };
  type StopProcess = (pid: number, registeredAt: string) => Promise<StopOutcome>;
  ```
  The service removes the record for `stopped`, `gone` and `reused` with `store.removeIfUnchanged(server)`, so a re-registration of the same PID made while the stop ran survives. It returns `{ ok: true }`. For `failed` it keeps the record and returns `{ ok: false, error }`. If the stopper throws (an OS command failed), `stop` rejects and the WS request fails with that message. A failed command never reads as "gone" or "stopped".
- `config.devServersFile = join(BASE_DIR, \`dev-servers-${instanceId}.json\`)`. This goes on the `config` object, not in `buildDataPaths`, so a data-dir change doesn't move it. Added in Section 2.

**HTTP** (Section 2 produces, Section 3 consumes):
- **`POST /api/dev-servers`**
  - Headers: `x-taskflow-project-id` (required), plus `x-taskflow-task-id` and `x-taskflow-session-id` when set.
  - Body: `{ pid, label }`.
  - Responses: 201 with the `DevServer`; 400 `{ error }`.
- **`GET /api/dev-servers`**
  - Default: the caller's owner's records. With a task header, those with that `taskId`. With only a project header, those with that `projectId` and no `taskId`.
  - `?all=1`: every record; no headers needed.
  - Responses: 200 `DevServerListResponse`; 400 when there's no project header and no `all`.
- **`DELETE /api/dev-servers/:id`** and **`DELETE /api/dev-servers?pid=<pid>`**
  - Responses: 200 `{ success: true }`; 404 `{ error: "Dev server not found" }`; 400 for a bad `pid`.

## Global Constraints

- **Tooling:** use `bun` for everything, never npm or yarn. Run UI tests **from the repo root** (`bun test packages/ui/...`) and one file at a time, because `mock.module` leaks across files.
- **TypeScript:** no `as any` and no eslint-disable comments. The notification handler's `typed<T>` helper and its existing disable comment are reused, not copied. Don't export anything nothing imports.
- **Commits:** conventional prefix (`feat(shared):`, `feat(backend):`, `feat(cli):`, `feat(ui):`, `test:`, `docs:`). **No `Co-Authored-By` trailer** (project CLAUDE.md).
- **Branching:** work on `main`. No branches or worktrees.
- **Formatting:** `bun run format` rewrites the whole repo, so never run it. Use `bunx prettier --write <files>` on changed files only.
- **CLI:** `taskflow-cli` has two implementations, the POSIX script (macOS/Linux) and the TS bin (Windows). Both change identically.
- **Tests:** new tests must not use `mock.module`. Inject dependencies instead.
- **Taskflow tracks nothing on its own:** no polling, no scanning, no PID capture at spawn. A record is removed only by a stop or a remove.
- **Error strings** (exact; shown to agents and users):
  - `Missing required header: x-taskflow-project-id`
  - `Field 'pid' must be a positive integer`
  - `Field 'label' is required and must be a non-empty string`
  - `Field 'label' must be at most 80 characters`
  - `Dev server not found`
  - `Could not stop pid <pid>: operation not permitted`
  - `Could not stop pid <pid>: process is still running`
- **Prompt paragraph** (exact text, added to `PROMPT_BASE`):

  > When you start a dev server or another long-running process the user is meant to open or use (dev or preview servers, Storybook, local API servers), register it as soon as it's running: `taskflow-cli devserver add --pid <pid> --label "<what> :<port>"`. If you stop a server you registered, run `taskflow-cli devserver remove --pid <pid>`.
- **UI copy** (exact): popover header `Running dev servers`; button `Stop` / `Stopping…`; empty state `No dev servers running`; icon `aria-label` and tooltip `Dev servers`.

## Review Focus

1. **A stale record whose PID now belongs to an unrelated process.** Stop must not signal it; it just removes the record. The start time is absolute (`lstart` in UTC on POSIX, `StartTime` on Windows), compared in whole seconds with no slack. Pinned in Section 1: the reuse-guard test with a live `sleep` started after `registeredAt` (asserting it's still alive afterwards), and the same-second / next-second boundary test.
2. **`bun run dev` style trees.** The registered PID is a wrapper whose child holds the port. Stop must take the child down too, even when the wrapper exits first, on Windows as well. Pinned in Section 1: the parent and child `sleep` tree test, plus the fake-ops test where a descendant outlives the root.
2a. **A PID the backend may not signal** (PID 1, another user's daemon). The registered PID is signalled first, and a refusal stops everything, so its descendants are never touched. Pinned in Section 1 (the refusal tests for the stopper and for both ops).
2b. **An OS command that fails** (`ps` missing, process table unreadable, `taskkill` refused). It fails the stop and never reads as "gone" or "stopped". Pinned in Section 1 (the ops tests).
3. **Stop must never kill the agent's own shell or process group.** No `kill(-pgid)` anywhere. Pinned in Section 1 (a test spawns the tree under a parent that must survive), and the reviewer greps for negative-PID signals.
4. **A stop that fails** (EPERM, or a process that survives SIGKILL) keeps the row and shows the error under it. The button comes back, and the next attempt clears the error. Pinned in Section 1 (injected `failed` outcome keeps the record) and Section 4 (popover error and retry test).
5. **Multiple backends.** Rows from each backend are stopped through that backend's own connection. A reset drops only that backend's rows. A machine that's offline (a dropped socket, no reset) has its rows hidden. The browser dev renderer's primary, which has no machine row, still shows its rows. A stop that settles after a reset, or after a re-registration of the same id, changes nothing it shouldn't. Pinned in Section 4: the two-backend store tests, the stale-completion tests, and the offline-machine component tests.

## Execution notes

- **After every section:**
  - `bun run typecheck`;
  - `bunx eslint <changed files>` and `bunx prettier --check <changed files>`;
  - the section's tests;
  - the full suite of the package you touched (`cd packages/backend && bun test`; UI files one by one from the root).
- **Flaky test:** `platform.test.ts` "resolveConfigBaseDir … isolated backend" fails occasionally and passes on rerun. Rerun once before investigating.
- **Final review:** when all sections are done, run a whole-change review (`codex-review` skill, gpt-6.1-sol) before marking TSK-4 in review.

## Plan review log

- **Round 1** (gpt-6.1-sol, `2026-10-11-dev-servers/reviews/round-1.md`; triage in `round-1-triage.md`): 2 blockers and 6 majors confirmed, 3 minors confirmed. The DS-08 part about promptless Kimi was rejected as a pre-existing, all-prompt limitation.
  - Section 1 (stopper): rewritten around `processes()` snapshots, root-first signalling that stops at the first refusal, `lstart` in UTC with no slack, and failures that throw.
  - Section 1 (service): `removeIfUnchanged` added.
  - Section 3: OpenCode gets the prompt file; the TS CLI matches sh on repeated `--pid` and `--all` headers.
  - Section 4: stale-completion tokens, a `registeredAt`-matched row removal, the offline-machine filter, and the deleted-task grouping fix.
  - Section 5: the PID 1 check was replaced; the CLI and help checks were corrected; offline and Windows items were added.
- **Round 2** (gpt-6.1-sol, `2026-10-11-dev-servers/reviews/round-2.md`; triage in `round-2-triage.md`): all round 1 fixes hold except DS-10's "no request" wording. 2 majors and 4 minors confirmed.
  - Section 4: the live-rows filter also shows primary's rows when primary has no machine row (browser dev renderer), with a test; opening the popover clears stop errors too; the reset/refetch test uses holder objects so it compiles; the component fake drops a meaningless `void`.
  - Section 3: header assertions use `toContain`; the TS bin rejects a bare `--` and `remove -x` like sh, with tests on both sides.
  - Section 5: browser vs Electron noted; item 8 allows the owner lookup; item 10 adds the late-failure/reopen check.
- **Round 3** (gpt-6.1-sol, `2026-10-11-dev-servers/reviews/round-3.md`; triage in `round-3-triage.md`): all round 2 fixes hold. 1 minor confirmed: Section 5 item 10 reopens while the backend is still stopped, because a resumed backend runs the timed-out stop and removes the row. Reviews done.
