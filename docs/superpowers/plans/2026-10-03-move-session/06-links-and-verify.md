# Section 6: Terminal link cwd, TUI check, manual verification

Read first: the plan index, `handoff.md`, and the spec sections "Terminal links", "TUI", "Testing → Manual" and "Amendments". Section 5 has to be done: it provides `Tab.cwd` and `findSessionTab`.

### Task 10: Terminal links follow the session, not the owner they were mounted with

**Why.** The link providers capture the owner ids of the workspace that first mounted the terminal (`terminal-lifecycle.ts:152-190`), and a cached terminal can be reused within its 50 ms grace period. After a move, three things go wrong:

- relative file links resolve against the *new* owner's worktree, while the agent still runs in its original directory;
- master sessions resolve nothing, because `getWorkingDir` returns `null` for master;
- a URL opened in-app goes to the workspace the terminal was first mounted in;
- a file link checks the file on, and opens it in, the workspace the terminal was first mounted in (`terminal-link-provider.ts` captures `workspaceKey` at line 125 and passes it, with the mounted owner ids, to `handlePathActivation`). If that owner is later deleted, `workspaceBackendId` returns null and the link stops working;
- with a CLI editor configured (`settings.editor.internalEditor`, detected on the machine), a non-Markdown file link in Master opens nothing. Activation forwards only `taskId` and `projectId` (`terminal-link-provider.ts:283`), so `openFileInApp` calls `createSession({})`, which throws `Either taskId, projectId, or master is required` (`session-store.ts:175`) into a `void`ed promise. The editor session also ignores the pane: `openFileInApp` never passes `targetWorkspaceKey`, so it lands in the owner's left pane even when the link was clicked in the right one;
- a bare filename link (`a.ts`, `.env`) passes no owner at all (`terminal-link-provider.ts:219`), so with a CLI editor `openFileInApp` returns at `if (!owner) return` (`open-file.ts:62`) and nothing opens, in any workspace;
- `createSession` marks the owner in `pendingSessionCreates` when it gets a `targetWorkspaceKey` (`session-store.ts:190-192`) and clears the mark only after the request succeeds (line 226). Once file links forward their pane key, a failed editor create (detached machine, timeout, backend error) leaves the mark set, and syncs stop giving that owner's new sessions a tab (`session-sync.ts:123`), including sessions moved into it.

Section 5 put the session's recorded `cwd` on its tab and added `findSessionTab`. The providers now look the session up **when a link is used**, and fall back to today's owner-based behaviour only when the tab has no `cwd` (legacy records).

**Files:**
- Modify: `packages/ui/src/components/panes/terminal/terminal-links.ts`, `getWorkingDir` (lines 14-30) and `createWebLinkHandler` (lines 71-80).
- Modify: `packages/ui/src/components/panes/terminal/terminal-link-provider.ts`. `createFilePathLinkProvider` (line 119) takes `sessionId`. It resolves the working dir and the workspace through the session on every `provideLinks` call and again in each link's `activate`.
- Modify: `packages/ui/src/components/panes/terminal/terminal-lifecycle.ts`. Pass `sessionId` to both provider factories (lines 179 and 189).
- Modify: `packages/ui/src/lib/open-file.ts`. `openFileInApp` takes a `SessionOwnerRef` and creates the CLI editor session in `workspaceKey`.
- Modify: `packages/ui/src/stores/session-store.ts`. `createSession` releases its `pendingSessionCreates` mark in `finally`.
- Create: `packages/ui/src/lib/test-headless-terminal.ts`. `createTerminalWithText` moves here from `terminal-wrapped-links.test.ts`, which imports it.
- Test: `packages/ui/src/components/panes/terminal/terminal-links.test.ts` (new).
- Test: `packages/ui/src/lib/open-file.test.ts` (new).
- Test: `packages/ui/src/stores/session-store.create.test.ts` (new).

**Interfaces:**
- Consumes: `Tab.cwd` and `findSessionTab` (Section 5).
- Produces:
  - `getWorkingDir(sessionId: string, taskId?: string, projectId?: string, master?: boolean): string | null`
  - `createWebLinkHandler(sessionId: string, taskId?: string, projectId?: string, master?: boolean)`
  - `sessionWorkspace(sessionId: string, taskId?: string, projectId?: string, master?: boolean): { workspaceKey: string | null; owner: SessionOwnerRef }`. The workspace (pane) key of the session's tab now, else the key it was mounted with, plus that workspace's owner: `{ taskId }`, `{ projectId }`, `{ master: true }`, or `{}` when there is no workspace. Exported for `terminal-link-provider.ts`.
  - `openFileInApp(filePath: string, workspaceKey: string | null, owner?: SessionOwnerRef, line?: number)`. Same callers; the owner type widens from `{ taskId?; projectId? }`. A CLI editor session is created with `targetWorkspaceKey: workspaceKey`.
  - `createTerminalWithText(text: string, cols?: number): Promise<Terminal>` in `@/lib/test-headless-terminal` (test helper, moved unchanged).

- [ ] **Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it } from "bun:test";
import type { Project, Task } from "@taskflow/shared";
import { useProjectStore } from "@/stores/project-store";
import { useSessionStore } from "@/stores/session-store";
import { useTaskStore } from "@/stores/task-store";
import { getWorkingDir, sessionWorkspace } from "./terminal-links";

const target: Task & { backendId: string } = {
    id: "target",
    projectId: "p1",
    title: "Target",
    description: "",
    notes: "",
    worktree: { enabled: true, path: "/repo/.worktrees/target", branch: "task/target", pr: null },
    sessions: [],
    attributes: [],
    createdAt: "2026-10-03T00:00:00.000Z",
    status: "active",
    archivedAt: null,
    pinned: false,
    backendId: "local",
};

const project: Project & { backendId: string } = {
    id: "p1",
    name: "repo",
    path: "/repo",
    sessions: [],
    attributes: [],
    createdAt: "2026-10-03T00:00:00.000Z",
    backendId: "local",
};

describe("getWorkingDir", () => {
    beforeEach(() => {
        useProjectStore.setState({ projects: [project] });
        useTaskStore.setState({ tasks: [target] });
    });

    it("prefers the session's own cwd, wherever its tab now is", () => {
        useSessionStore.setState({
            tabsByWorkspace: {
                "task:target": [
                    {
                        id: "s1",
                        type: "claude",
                        label: "Claude",
                        sessionId: "s1",
                        cwd: "/repo/.worktrees/source",
                    },
                ],
            },
        });

        // Captured owner ids from the first mount no longer matter.
        expect(getWorkingDir("s1", "some-old-task")).toBe("/repo/.worktrees/source");
        expect(getWorkingDir("s1", undefined, undefined, true)).toBe("/repo/.worktrees/source");
    });

    it("falls back to the owner's directory for a tab without a cwd", () => {
        useSessionStore.setState({
            tabsByWorkspace: {
                "task:target": [{ id: "s1", type: "claude", label: "Claude", sessionId: "s1" }],
            },
        });

        expect(getWorkingDir("s1", "target")).toBe("/repo/.worktrees/target");
    });
});

describe("sessionWorkspace", () => {
    it("follows the session's tab, including into a right pane", () => {
        useSessionStore.setState({
            tabsByWorkspace: {
                "task:target:right": [{ id: "s1", type: "claude", label: "Claude", sessionId: "s1" }],
            },
        });

        expect(sessionWorkspace("s1", "some-old-task")).toEqual({
            workspaceKey: "task:target:right",
            owner: { taskId: "target" },
        });
    });

    it("falls back to the workspace the terminal was mounted in", () => {
        useSessionStore.setState({ tabsByWorkspace: {} });

        expect(sessionWorkspace("s1", undefined, "p1")).toEqual({
            workspaceKey: "project:p1",
            owner: { projectId: "p1" },
        });
        expect(sessionWorkspace("s1", undefined, undefined, true)).toEqual({
            workspaceKey: "master",
            owner: { master: true },
        });
    });

    it("reports Master for a session whose tab moved there", () => {
        useSessionStore.setState({
            tabsByWorkspace: {
                master: [{ id: "s1", type: "claude", label: "Claude", sessionId: "s1" }],
            },
        });

        expect(sessionWorkspace("s1", "some-old-task")).toEqual({
            workspaceKey: "master",
            owner: { master: true },
        });
    });
});
```

`packages/ui/src/lib/open-file.test.ts` drives `openFileInApp` against a real socket. `startTestServer` (`@/lib/test-ws-server`) stands in for the backend, and `openConnection` + `setPrimary` (`@/lib/connection-registry`) make it the primary, which is the machine `workspaceBackendId("master")` returns. The last case drives a bare filename link from a real provider on a headless terminal:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { MSG } from "@taskflow/shared";
import type { AppSettings, SessionRef, Task } from "@taskflow/shared";
import type { ILink } from "@xterm/xterm";
import { createFilePathLinkProvider } from "@/components/panes/terminal/terminal-link-provider";
import { closeConnection, openConnection, setPrimary } from "@/lib/connection-registry";
import { createTerminalWithText } from "@/lib/test-headless-terminal";
import { startTestServer } from "@/lib/test-ws-server";
import type { TestServer } from "@/lib/test-ws-server";
import { useSessionStore } from "@/stores/session-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useTaskStore } from "@/stores/task-store";
import { openFileInApp } from "./open-file";

let server: TestServer;
let created = 0;
const editorRefs: SessionRef[] = [];

beforeAll(async () => {
    server = startTestServer("local", (type) => {
        if (type === MSG.SYSTEM_INFO) {
            return { editors: [{ id: "nvim", name: "Neovim", type: "internal" }] };
        }
        if (type === MSG.SESSION_CREATE) {
            const id = `editor-${++created}`;
            editorRefs.push(editorRef(id));
            return { sessionId: id };
        }
        if (type === MSG.TASK_LIST) return { tasks: [{ ...target, sessions: [...editorRefs] }] };
        if (type === MSG.FILE_STAT) return { exists: true, isDirectory: false };
        return {};
    });
    await openConnection("local", server.origin);
    setPrimary("local");
});

afterAll(() => {
    closeConnection("local", "detach");
    server.stop();
});

beforeEach(() => {
    server.received.length = 0;
    useSessionStore.setState({ tabsByWorkspace: {}, activeTabByWorkspace: {} });
    useSettingsStore.setState({ settings: settingsWith("nvim") });
    useTaskStore.setState({ tasks: [{ ...target, backendId: "local" }] });
});

function sessionCreates() {
    return server.received.filter((r) => r.type === MSG.SESSION_CREATE).map((r) => r.payload);
}

/** Link activation `void`s its work; wait for the request it ends in. */
async function untilSessionCreate(): Promise<void> {
    for (let i = 0; i < 100 && sessionCreates().length === 0; i++) {
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
}

describe("openFileInApp with a CLI editor", () => {
    it("opens a file from Master in a Master editor session", async () => {
        await openFileInApp("/repo/src/a.ts", "master", { master: true }, 3);

        expect(sessionCreates()).toEqual([
            expect.objectContaining({ master: true, type: "editor", filePath: "/repo/src/a.ts" }),
        ]);
        expect(useSessionStore.getState().tabsByWorkspace.master?.map((t) => t.sessionId)).toEqual([
            "editor-1",
        ]);
    });

    it("puts the editor session in the pane the link was clicked in, and keeps it there", async () => {
        await openFileInApp("/repo/src/a.ts", "task:target:right", { taskId: "target" });
        useSessionStore.getState().syncWithTasks("local", useTaskStore.getState().tasks);

        const tabs = useSessionStore.getState().tabsByWorkspace;
        expect(tabs["task:target:right"]?.map((t) => t.sessionId)).toEqual(["editor-2"]);
        expect((tabs["task:target"] ?? []).map((t) => t.sessionId)).not.toContain("editor-2");
    });

    it("opens a bare filename link from a Master session", async () => {
        useSessionStore.setState({
            tabsByWorkspace: {
                master: [{ id: "s1", type: "claude", label: "Claude", sessionId: "s1", cwd: "/repo" }],
            },
        });
        const term = await createTerminalWithText("see a.ts here", 40);
        const provider = createFilePathLinkProvider(term, "s1", undefined, undefined, true);
        const links = await new Promise<ILink[] | undefined>((resolve) =>
            provider.provideLinks(1, resolve),
        );
        const link = links?.find((l) => l.text === "a.ts");
        expect(link).toBeDefined();

        link?.activate(new MouseEvent("click"), "a.ts");
        await untilSessionCreate();

        expect(sessionCreates()).toEqual([
            expect.objectContaining({ master: true, type: "editor", filePath: "/repo/a.ts" }),
        ]);
    });
});
```

Build `settingsWith(internalEditor)`, `target` and `editorRef(id)` as the smallest `AppSettings`, `Task` and `SessionRef` fixtures the types accept (copy `target` from `terminal-links.test.ts`; for `AppSettings`, start from the defaults the settings store tests use, if any, and set `editor.internalEditor`; `editorRef` is a live `editor` ref). Don't cast. Match the `SESSION_CREATE` payload field names to what `createSession` actually sends (`editorId`/`filePath` may sit under an editor options object); assert on the real shape. If `openFileInApp` returns before the tab is added (it `void`s `createSession`), await `createSession` inside it instead: `await store.createSession(...)`, which every caller already `void`s. `createSession` ends with `refetchRecords`, which asks for `TASK_LIST`; the answer above holds each editor ref it handed out, so the fetch succeeds. The resync runs from `useSidebarData`'s effect in the app, which this test doesn't mount, so the test calls `syncWithTasks` itself.

Move `createTerminalWithText` (and the headless `Terminal` it loads) from `packages/ui/src/lib/terminal-wrapped-links.test.ts` into `packages/ui/src/lib/test-headless-terminal.ts`, exported, and import it in both tests. Its existing `as unknown as Terminal` stays as it is; it's the one bridge from the headless build to the xterm type.

`packages/ui/src/stores/session-store.create.test.ts` pins the released mark. No server: a `backendId` with no connection makes `sendRequest` reject with `BackendDetachedError`.

```ts
import { beforeEach, describe, expect, it } from "bun:test";
import type { SessionRef, Task } from "@taskflow/shared";
import { useSessionStore } from "./session-store";

beforeEach(() => {
    useSessionStore.setState({ tabsByWorkspace: {}, activeTabByWorkspace: {} });
});

describe("createSession", () => {
    it("lets syncs place the owner's sessions after a targeted create fails", async () => {
        await expect(
            useSessionStore
                .getState()
                .createSession(
                    { taskId: "target", backendId: "detached" },
                    "editor",
                    "nvim: a.ts",
                    undefined,
                    undefined,
                    undefined,
                    { editorId: "nvim", filePath: "/repo/a.ts" },
                    undefined,
                    "task:target:right",
                ),
        ).rejects.toThrow();

        useSessionStore.getState().syncWithTasks("local", [{ ...target, sessions: [movedIn] }]);

        expect(
            useSessionStore.getState().tabsByWorkspace["task:target"]?.map((t) => t.sessionId),
        ).toEqual(["moved-in"]);
    });
});
```

`target` is the same `Task` fixture without `backendId`; `movedIn` is a live `claude` `SessionRef` with id `moved-in`. Before the fix, the base pane stays empty.

If `Project` requires more fields than this fixture has, add them with their empty values. Don't cast.

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test packages/ui/src/components/panes/terminal/terminal-links.test.ts`
Expected: FAIL. `getWorkingDir` ignores the session.

Run: `bun test packages/ui/src/stores/session-store.create.test.ts`
Expected: FAIL. The base pane stays empty: the failed create left its mark.

- [ ] **Step 3: Implement**

In `terminal-links.ts`, import `findSessionTab` from `@/stores/session-store`, `baseWorkspaceKey` from `@/stores/session-helpers`, and the type `SessionOwnerRef` from `@taskflow/shared` (Section 1). Rename the existing owner-based body to `ownerWorkingDir(taskId?, projectId?, master?)` (unchanged), then add:

```ts
function getWorkingDir(
    sessionId: string,
    taskId?: string,
    projectId?: string,
    master?: boolean,
): string | null {
    return findSessionTab(sessionId)?.tab.cwd ?? ownerWorkingDir(taskId, projectId, master);
}

/**
 * The workspace (pane) key of the session's tab now, else the one its
 * terminal was mounted with, and that workspace's owner ids.
 */
function sessionWorkspace(
    sessionId: string,
    taskId?: string,
    projectId?: string,
    master?: boolean,
): { workspaceKey: string | null; owner: SessionOwnerRef } {
    const workspaceKey =
        findSessionTab(sessionId)?.workspaceKey ?? getWorkspaceKey(taskId, projectId, master);
    const base = workspaceKey ? baseWorkspaceKey(workspaceKey) : null;
    if (base?.startsWith("task:")) return { workspaceKey, owner: { taskId: base.slice(5) } };
    if (base?.startsWith("project:")) {
        return { workspaceKey, owner: { projectId: base.slice(8) } };
    }
    if (base === "master") return { workspaceKey, owner: { master: true } };
    return { workspaceKey, owner: {} };
}

function createWebLinkHandler(
    sessionId: string,
    taskId?: string,
    projectId?: string,
    master?: boolean,
) {
    return (event: MouseEvent, uri: string) => {
        if (event.metaKey || event.ctrlKey) {
            openExternalUrl(uri);
        } else {
            openUrlInApp(uri, sessionWorkspace(sessionId, taskId, projectId, master).workspaceKey);
        }
    };
}
```

Export `sessionWorkspace`. `findSessionTab` may return a `:right` pane key. `openUrlInApp` adding the browser tab next to the session in that pane, and `openFileInApp` adding an editor tab there, is the intended result. `workspaceBackendId` already accepts pane keys.

`terminal-link-provider.ts`: `createFilePathLinkProvider(term, sessionId, taskId, projectId, master)`.

- Drop the `const workspaceKey = getWorkspaceKey(…)` captured at the top.
- In `provideLinks`, compute `getWorkingDir(sessionId, taskId, projectId, master)` (as now, per call) and use `sessionWorkspace(sessionId, taskId, projectId, master).workspaceKey` for the bare-name `cachedFileStat` backend.
- In every link's `activate`, resolve the session's workspace at click time:

```ts
                        activate(event: MouseEvent, text: string) {
                            const { workspaceKey, owner } = sessionWorkspace(
                                sessionId,
                                taskId,
                                projectId,
                                master,
                            );
                            void handlePathActivation(text, workingDir, workspaceKey, event, owner);
                        },
```

  The bare-name link's `activate` is the same code. It passes the owner too; today it passes none, so a CLI editor never opens a bare filename.
- `handlePathActivation` replaces its `taskId?, projectId?` parameters with one `owner?: SessionOwnerRef` and passes it straight to `openFileInApp(resolved, workspaceKey, owner, line)`. Nothing else in it changes.

`open-file.ts`: type the `owner` parameter as `SessionOwnerRef` (import from `@taskflow/shared`), and pass `workspaceKey` as `createSession`'s `targetWorkspaceKey` (its ninth argument, after `cwd`, which stays `undefined`). `FileExplorer`, `SearchPanel`, `EditedFilesList`, `WikiPanel` and `EditorPaneImpl` pass base workspace keys, where the target equals the owner's default key, so their behaviour is unchanged. `MarkdownPaneImpl` passes its own tab's pane key, which can be `:right`; a CLI editor opened from a Markdown link in the right pane now opens there too, as terminal links do. An owner of `{}` still reaches `createSession` and throws there; the terminal link never sends one, because `sessionWorkspace` returns `{}` only when `workspaceKey` is null and `openFileInApp` returns first.

`session-store.ts`, `createSession`: run the `SESSION_CREATE` request in `try`, and in `finally` delete `pendingKey` from `pendingSessionCreates` (replacing the delete after `addTab`). `addTab` follows in the same synchronous run after the request resolves, so no sync can slip in between:

```ts
        let sessionId: string;
        try {
            ({ sessionId } = await sendRequest<SessionCreateResponse>(backendId, MSG.SESSION_CREATE, {
                // payload unchanged
            }));
        } finally {
            if (pendingKey) pendingSessionCreates.delete(pendingKey);
        }
```

`terminal-lifecycle.ts`: `getOrCreateTerminal` already has `sessionId`, so pass it as the new first or second argument of `createWebLinkHandler(...)` and `createFilePathLinkProvider(...)`.

- [ ] **Step 4: Run the tests**

```bash
bun test packages/ui/src/components/panes/terminal/terminal-links.test.ts
bun test packages/ui/src/lib/open-file.test.ts
bun test packages/ui/src/stores/session-store.create.test.ts
for f in packages/ui/src/components/panes/terminal/*.test.ts packages/ui/src/lib/terminal-wrapped-links.test.ts; do bun test "$f" || echo "FAILED: $f"; done
```

Expected: PASS.

- [ ] **Step 5: Typecheck, lint, format, commit**

```bash
bun run typecheck
UI_FILES=(
    packages/ui/src/components/panes/terminal/terminal-links.ts
    packages/ui/src/components/panes/terminal/terminal-link-provider.ts
    packages/ui/src/components/panes/terminal/terminal-lifecycle.ts
    packages/ui/src/components/panes/terminal/terminal-links.test.ts
    packages/ui/src/lib/open-file.ts
    packages/ui/src/lib/open-file.test.ts
    packages/ui/src/lib/test-headless-terminal.ts
    packages/ui/src/lib/terminal-wrapped-links.test.ts
    packages/ui/src/stores/session-store.ts
    packages/ui/src/stores/session-store.create.test.ts
)
bunx eslint "${UI_FILES[@]}"
bunx prettier --check "${UI_FILES[@]}"
git add "${UI_FILES[@]}"
git commit -m "fix(ui): terminal links follow the session's own cwd and workspace"
```

### Task 11: TUI check and manual verification

No code is expected. If a check fails, fix it in the owning section's files, with a test, and record it in `handoff.md`.

- [ ] **Step 1: TUI follows a move**

`packages/tui/src/sessions/owner.ts` derives each owner's sessions from the task, project and master lists, which `TASK_UPDATED` / `PROJECT_UPDATED` / `MASTER_SESSIONS_LIST` refresh. Confirm this by adding one case to `packages/tui/src/sessions/owner.test.ts`: after a session id moves from task A's `sessions` to task B's in the store view, `sessionsForOwner` returns it for B and not for A. Run `cd packages/tui && bun test src/sessions/owner.test.ts`. Commit with `test(tui): sessions follow a move between owners`.

- [ ] **Step 2: Manual run against a sandboxed dev backend**

Follow memory `project_dev_backend_sandbox`: fake `HOME` plus `TASKFLOW_DEV_PORT`, never the real data dir. Start the dev app (`bun run dev:backend` and `bun run dev:electron` with that environment). Then:

1. Create project P with tasks A and B. Start a Claude session at P's project level and let it print some output.
2. Drag its tab onto task A's card. The card highlights while hovered. The tab leaves P's tabs. Open A: the tab is there and the transcript replays.
3. Drag the same tab from A onto project row P. It moves back. Open a shell tab in A, start dragging it: no card highlights, and dropping it on a card does nothing.
4. Inside the agent, run `taskflow-cli task create "Moved here"`. Then run `taskflow-cli session move --task <new id>`, then `taskflow-cli task`. It must print the new task.
5. Split the workspace (right pane) and drag a tab from the right pane onto a card. The move works the same.
6. Drag a tab, wait for the tab strip to scroll (many tabs), then drop on a card. The card that highlighted is the one that receives the session.
7. Drop a shell tab on a sidebar gap, then an agent tab on the sidebar's top toolbar and on its bottom toolbar: nothing happens each time, and the tabs don't reorder.
8. Move a session into Master with the CLI (`taskflow-cli session move --master`), then click a relative file path it prints. It opens relative to the session's original directory, in a Master editor tab. Delete the task the session came from and click the path again: it still opens. Set Settings → Editor → internal editor to a detected CLI editor (e.g. nvim) and click a non-Markdown path again, then a bare filename it prints (e.g. `package.json`): a Master editor session opens on each file.
9. Quit the dev app with Cmd+Q and start it again. The moved session is offered for restore in the task it was moved to (expected behaviour for interrupted agent sessions). Resuming it starts in its original cwd.

Record the result of each step in `handoff.md`.

- [ ] **Step 3: Whole-change review**

Run the `codex-review` skill against the range from the first Section 1 commit to HEAD (`codex exec review --base <commit before Section 1> -m gpt-6.1-sol -c sandbox_mode=read-only`, run in the background). Verify each finding yourself before acting on it. Fix the confirmed ones with tests.

- [ ] **Step 4: Close out**

- Update `handoff.md` to "complete".
- `task-tray log add TSK-3 --type info "<summary>"`, and log each commit with `--type commit`.
- `task-tray task status TSK-3 in-review`. The user moves it to done.
