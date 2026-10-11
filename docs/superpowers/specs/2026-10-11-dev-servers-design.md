# Running Dev Servers — Design

Date: 2026-10-11
Status: approved in chat, pending spec review
Tracking: TaskTray TSK-4

## Problem

Agents start dev servers that the user doesn't know about. Sometimes the user
does know, but has already closed the session and can't tell what to stop.
Closing a session kills only the PTY's direct child, so a dev server an agent
started keeps running as an orphan.

## Goals

1. When an agent starts a dev server, it reports the PID and a label through
   `taskflow-cli`. The agent prompt requires this.
2. The desktop UI lists every registered server across all connected backends
   and can stop each one.
3. Stopping a record whose process is gone, or whose PID now belongs to a
   different process, just removes the record.

## Non-goals

- Taskflow tracks nothing on its own. There's no process scanning, port
  detection, liveness polling or PID capture at spawn. The list holds what
  agents declared, nothing more.
- No TUI support in this iteration.
- No `stop` command for agents. Stopping is a user action in the desktop UI.
- No navigation from a popover row to its task.
- Records aren't tied to session or task lifecycle (see Storage).

## Record

Shared type in `packages/shared`:

```ts
interface DevServer {
    id: string; // uuid
    pid: number;
    label: string; // e.g. "UI dev server :5173"
    registeredAt: string; // ISO timestamp; also the PID-reuse guard
    projectId: string;
    taskId?: string; // owner at registration time
    sessionId?: string; // informational only
}
```

## Backend

### Storage

- **Location:** one JSON file per backend instance, in the local config dir:
  `join(BASE_DIR, "dev-servers-<instanceId>.json")`.
- **Why not the data dir:** the data dir can be moved or synced, and a PID only
  means something on the machine that issued it.
- **Store pattern:** the same mutation-serialised read/modify/write store as
  `NotificationStore`:
  - `list()`;
  - `add(input)`: re-adding a PID that already exists on this instance
    replaces that record's label, owner and `registeredAt` in place and keeps
    its `id`;
  - `remove(id)`;
  - `removeByPid(pid)`.
- **Lifecycle:** closing a session, archiving or deleting a task, or moving a
  session never touches the records. Only a stop or an explicit remove deletes
  one.

### Stop service

`stopDevServer(id)` runs once per user click, in this order:

1. **Look up the record.** If it's unknown, return `{ ok: true }`; it's
   already gone.
2. **PID-reuse guard.** Read the process start time once.
   - POSIX: `ps -o lstart= -p <pid>`.
   - Windows: PowerShell `(Get-Process -Id <pid>).StartTime`.
   - If the process doesn't exist, remove the record and return `{ ok: true }`.
   - If the start time, truncated to seconds, is later than `registeredAt`
     truncated to seconds, the PID belongs to a different process. Remove the
     record, send no signal, and return `{ ok: true }`.
3. **Collect the tree** (POSIX). Run `ps -A -o pid=,ppid=` once and collect
   the PID plus all of its descendants.
   - Deliberately not a process-group kill: background jobs from a
     non-interactive shell share the agent's process group, so a group kill
     could take the agent down with it.
4. **Signal** (POSIX).
   - Send SIGTERM to every PID in the tree.
   - Poll for up to 3 s until none of them are alive.
   - Send SIGKILL to the survivors and poll briefly again.
5. **Signal** (Windows). Run `taskkill /PID <pid> /T`, wait the same way, then
   `taskkill /PID <pid> /T /F`.
6. **Result.**
   - If every PID is gone, remove the record and return `{ ok: true }`.
   - On `EPERM`, or if any PID survives SIGKILL, keep the record and return
     `{ ok: false, error }` with a human-readable message such as
     `Could not stop pid 1022: operation not permitted`.

Child processes go through Bun's spawn helpers. Signals use `process.kill`,
and `ESRCH` while signalling counts as "already gone".

### API (HTTP, used by the CLI)

All routes read the caller's owner from the existing `X-Taskflow-Project-Id`,
`X-Taskflow-Task-Id` and `X-Taskflow-Session-Id` headers, in the same way as
`POST /api/notifications`.

- **`POST /api/dev-servers`**
  - Body: `{ pid, label }`.
  - Validates that `pid` is a positive integer and that `label` is non-empty
    after trimming and at most 80 characters.
  - Returns the stored record. Validation errors return a 400 with a readable
    message.
- **`GET /api/dev-servers`**
  - Returns the caller's owner's records: the task when a task ID is present,
    otherwise the project's records that have no `taskId`.
  - `?all=1` returns every record on the backend.
- **`DELETE /api/dev-servers/:id`** and **`DELETE /api/dev-servers?pid=<pid>`**
  - Remove a record without sending a signal.
  - Return 404 if nothing matched.

### WebSocket (used by the desktop UI)

- **`DEV_SERVERS_LIST`** (event): the full list for this backend. It's sent on
  connect and broadcast after every change (add, remove, a successful stop).
  The lists are tiny, so there's no diffing.
- **`DEV_SERVER_STOP`** (request): `{ id }` → `{ ok: true }` or
  `{ ok: false, error }`.

Each backend sends its list over the connection the desktop UI already has open
to it, so remote backends work with no extra code.

## CLI

A new `devserver` group, implemented in both `taskflow-cli.sh` and
`taskflow-cli-bin.ts`:

```
taskflow-cli devserver add --pid <pid> --label "<label>"
taskflow-cli devserver list [--all]
taskflow-cli devserver remove <id>
taskflow-cli devserver remove --pid <pid>
```

- **Owner:** comes from the session context, the same way it does for
  `notify`. Owner adoption for moved sessions already runs before dispatch.
- **Errors:** writes use `api_request` (the shell script) or `api()` (the TS
  bin), so the backend's validation message reaches the agent.
- **Output:** JSON, like the other commands.

### Docs

- New file `taskflow-cli-devserver-commands.md`, imported into
  `internal-agent-skill.ts` and registered in `COMMAND_FILES`.
- `taskflow-cli-skill.md` gets the matching `@taskflow-cli-devserver-commands.md`
  path line. The doc stays a path that agents read on demand; it isn't inlined.
- The doc lists syntax only. There are no hints about how to find a PID.

## Agent prompt

One paragraph added to `PROMPT_BASE` in `internal-agent-skill.ts`, so every
agent type gets it:

> When you start a dev server or another long-running process the user is
> meant to open or use (dev or preview servers, Storybook, local API servers),
> register it as soon as it's running:
> `taskflow-cli devserver add --pid <pid> --label "<what> :<port>"`. If you
> stop a server you registered, run `taskflow-cli devserver remove --pid <pid>`.

## Desktop UI

### Toolbar icon

- **Placement:** a `Server` (lucide) icon button in `SidebarToolbar`, with a
  count badge totalled across every connected backend.
- **Visibility:** shown only when the count is above zero, or while its
  popover is open.

### Popover

It follows the `NotificationPopover` pattern and matches mock B from
brainstorming.

- **Header:** "Running dev servers".
- **Grouping:**
  - Rows are grouped by `<project name> · <task title>`, or just
    `<project name>` when the record has no `taskId` or the task no longer
    exists.
  - When the servers come from more than one backend, each group header also
    shows the backend's name.
- **Rows:** the label, a muted line `pid <pid> · <relative registeredAt>`, and
  a Stop button.
- **Stopping:**
  - There's no confirmation. While the request runs, the button reads
    "Stopping…" and is disabled.
  - On `{ ok: true }` the row goes away, because the backend's list broadcast
    no longer includes it.
  - On `{ ok: false, error }` the error appears in destructive colour under
    the row and the button comes back. The error clears on the next attempt or
    when the popover closes.
- **Empty:** if the list becomes empty while the popover is open, it shows
  "No dev servers running". The icon disappears once the popover closes.

### State

- **Store:** `stores/dev-server-store.ts` (Zustand) holds the lists keyed by
  `backendId`, plus a per-record stop status (`stopping` or an error string).
  Components read it through selectors with stable empty defaults.
- **Subscriptions:** `stores/dev-server-subscriptions.ts` handles
  `DEV_SERVERS_LIST` per backend, following `session-subscriptions.ts`, and
  clears a backend's list when that backend disconnects.
- **Stop:** sent with `DEV_SERVER_STOP` through the connection registry for the
  record's backend.

## Error handling summary

| Situation                                                  | Result                                                                 |
| ---------------------------------------------------------- | ---------------------------------------------------------------------- |
| CLI with no project context                                | Error from the CLI, as `notify` does                                   |
| Invalid pid or label                                       | 400 with a message; the CLI prints it and exits non-zero               |
| Stop: process doesn't exist                                | Record removed and the row disappears                                  |
| Stop: PID reused (process started after `registeredAt`)    | Record removed, no signal sent                                         |
| Stop: `EPERM`                                              | Record kept, error shown under the row                                 |
| Stop: survives SIGKILL                                     | Record kept, error shown under the row                                 |
| Backend disconnects                                        | That backend's rows vanish from the popover until it reconnects        |

## Testing

- **Backend store:** add, idempotent re-add by PID, remove by ID and by PID,
  and a missing file reading as empty.
- **Stop service**, against real `sleep` processes:
  - a parent with a child: both die on SIGTERM;
  - a child that traps SIGTERM: it gets SIGKILL;
  - a missing PID: the record is removed and `ok` is returned;
  - the PID-reuse guard: a `registeredAt` set before the process started
    removes the record and sends no signal (the process is still alive
    afterwards).
- **Routes:**
  - validation;
  - owner scoping for `GET`;
  - `?all=1`;
  - both `DELETE` forms.
- **CLI:** `devserver add`, `list` and `remove`, covered in
  `taskflow-cli.test.ts` for the shell script and in the TS bin tests.
- **`internal-agent-skill.test.ts`:** the prompt paragraph is present, and the
  new doc is written and referenced by path.
- **UI:** a component test for the popover covering grouping (including
  backend names when there are several backends), the "Stopping…" state, the
  error state, and the icon hiding at zero. Run UI component tests per file.

## Amendments

### Plan review round 1 (2026-10-11)

1. **Start time (POSIX).** It is read with `ps -o lstart=` under `LC_ALL=C TZ=UTC` and parsed as UTC, so it doesn't depend on locale or DST. The reuse rule is as written above, with no slack: reused iff the start, truncated to seconds, is later than `registeredAt` truncated to seconds.
2. **Signal order.** The registered PID is signalled first. Signalling stops at the first refusal (EPERM, or a `taskkill` failure for a PID that's still running), so a process the backend may not signal never has its descendants signalled.
3. **Windows.** The tree comes from one `Get-CimInstance Win32_Process` snapshot. A child that started before its parent is skipped, because Windows keeps a dead parent's PID as `ppid`. Survivor checks cover every PID in the tree, not just the parent. Each PID is ended with `taskkill /PID <pid> /F`, in both phases and without `/T`, because a taskkill without `/F` doesn't stop console processes.
4. **Command failures.** A failed or missing OS command fails the stop: the WS request errors, and the record stays. It never reads as "process gone" or "stopped". A failed `ps` start-time read counts as "gone" only when `kill(pid, 0)` returns ESRCH.
5. **Re-registration during a stop.** The stop removes the record only while its `id` and `registeredAt` are unchanged (`DevServerStore.removeIfUnchanged`), so a re-add of the same PID made meanwhile survives. In the UI, an `ok` removes the row only when its `registeredAt` also matches.
6. **Desktop UI, Section 4 plan:**
   - The button sits in `TaskSidebar`'s bottom-left toolbar group, directly after the notification bell (where the bell actually lives), not in `SidebarToolbar`.
   - The `DEV_SERVER_LIST` subscription lives inline in `stores/dev-server-store.ts`, following `notification-store.ts`; there's no separate subscriptions file.
   - A group's task title is looked up in both live and archived tasks. Records whose task is in neither list join the project's group.
7. **Disconnects.** A dropped socket only marks the machine `offline`, and no store is reset. So the popover and the badge show rows only from machines whose state is `attached`, which hides an offline backend's rows. Reconnecting refetches through `bootstrapBackend`. A stop request that settles after its backend was reset changes nothing.
8. **Agent prompt delivery.** OpenCode takes no system prompt, so `PROMPT_BASE` (with the paragraph) is written to `taskflow-agent-prompt.md` next to `SKILL.md`, and OpenCode loads it as an instruction file before the skill. **Known limitation:** Kimi started without a prompt receives no Taskflow instructions at all. That's existing behaviour for its typed-input channel, and this feature doesn't change it.

### Plan review round 2 (2026-10-11)

9. **Browser dev renderer.** It opens one connection to primary and creates no machine rows. The popover and the badge show primary's rows while no machine row exists for primary. Every other backend still needs an `attached` machine row.
10. **Stop errors and the popover.** Opening the popover clears stop errors as well as closing it, because a stop still pending at close can fail afterwards. A stop in progress keeps `"stopping"`.
11. **CLI parity.** The TS bin rejects what the sh `case` rejects: a bare `--` where a flag could stand (all three subcommands) and a `remove` argument starting with `-`. `--` as a flag's value (`--label --`) is accepted by both.

### Section 1 implementation review (2026-10-11)

12. **The backend's own process.** A stop of a record whose PID is the backend's own (or `<= 0`) fails with `operation not permitted` before any process command runs, and the record stays. When the backend is a descendant of the registered PID, the tree walk leaves out the backend and everything under it, because those are the sessions it runs.

### Amendments (implementation, 2026-10-11)

Every deviation recorded during implementation:

- **Section 1:** the backend's-own-process guard (item 12 above, review fix `bbf73d40`). Two stopper tests were added for it.
- **Section 2:** no code deviations. The sandboxed smoke run needed a readiness poll and explicit `TASKFLOW_CONFIG_DIR` / `TASKFLOW_PORT_FILE`.
- **Sections 3 and 4:** no code deviations.
- **Section 5 (manual verification):** no defects found. macOS `sh -c '<one command>'` execs the command in place, which leaves no wrapper. The wrapper-tree check ran `sh -c 'bunx serve -l 5198 .; :'` so `sh` stayed the server's parent. The offline-machine and Windows checks weren't run. Windows stop is unit-tested only and hasn't been verified on a real machine.
