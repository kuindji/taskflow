# Section 6: Terminal link cwd, TUI check, manual verification

Read first: the plan index, `handoff.md`, and the spec sections "Terminal links", "TUI", "Testing → Manual" and "Amendments". Section 5 has to be done: it provides `Tab.cwd` and `findSessionTab`.

### Task 10: Terminal links follow the session, not the owner they were mounted with

**Why.** The link providers capture the owner ids of the workspace that first mounted the terminal (`terminal-lifecycle.ts:152-190`), and a cached terminal can be reused within its 50 ms grace period. After a move, three things go wrong:

- relative file links resolve against the *new* owner's worktree, while the agent still runs in its original directory;
- master sessions resolve nothing, because `getWorkingDir` returns `null` for master;
- a URL opened in-app goes to the workspace the terminal was first mounted in.

Section 5 put the session's recorded `cwd` on its tab and added `findSessionTab`. The providers now look the session up **when a link is used**, and fall back to today's owner-based behaviour only when the tab has no `cwd` (legacy records).

**Files:**
- Modify: `packages/ui/src/components/panes/terminal/terminal-links.ts`, `getWorkingDir` (lines 14-30) and `createWebLinkHandler` (lines 71-80).
- Modify: `packages/ui/src/components/panes/terminal/terminal-link-provider.ts`. `createFilePathLinkProvider` (line 119) takes `sessionId`, and line 135 passes it on.
- Modify: `packages/ui/src/components/panes/terminal/terminal-lifecycle.ts`. Pass `sessionId` to both provider factories (lines 179 and 189).
- Test: `packages/ui/src/components/panes/terminal/terminal-links.test.ts` (new).

**Interfaces:**
- Consumes: `Tab.cwd` and `findSessionTab` (Section 5).
- Produces:
  - `getWorkingDir(sessionId: string, taskId?: string, projectId?: string, master?: boolean): string | null`
  - `createWebLinkHandler(sessionId: string, taskId?: string, projectId?: string, master?: boolean)`

- [ ] **Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it } from "bun:test";
import type { Project, Task } from "@taskflow/shared";
import { useProjectStore } from "@/stores/project-store";
import { useSessionStore } from "@/stores/session-store";
import { useTaskStore } from "@/stores/task-store";
import { getWorkingDir } from "./terminal-links";

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
```

If `Project` requires more fields than this fixture has, add them with their empty values. Don't cast.

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test packages/ui/src/components/panes/terminal/terminal-links.test.ts`
Expected: FAIL. `getWorkingDir` ignores the session.

- [ ] **Step 3: Implement**

In `terminal-links.ts`, import `findSessionTab` from `@/stores/session-store`. Rename the existing owner-based body to `ownerWorkingDir(taskId?, projectId?, master?)` (unchanged), then add:

```ts
function getWorkingDir(
    sessionId: string,
    taskId?: string,
    projectId?: string,
    master?: boolean,
): string | null {
    return findSessionTab(sessionId)?.tab.cwd ?? ownerWorkingDir(taskId, projectId, master);
}

function createWebLinkHandler(
    sessionId: string,
    taskId?: string,
    projectId?: string,
    master?: boolean,
) {
    const mountedKey = getWorkspaceKey(taskId, projectId, master);
    return (event: MouseEvent, uri: string) => {
        if (event.metaKey || event.ctrlKey) {
            openExternalUrl(uri);
        } else {
            openUrlInApp(uri, findSessionTab(sessionId)?.workspaceKey ?? mountedKey);
        }
    };
}
```

`findSessionTab` may return a `:right` pane key. `openUrlInApp` adding the browser tab next to the session in that pane is the intended result.

`terminal-link-provider.ts`: `createFilePathLinkProvider(term, sessionId, taskId, projectId, master)` passes `sessionId` to `getWorkingDir`. `terminal-lifecycle.ts`: `getOrCreateTerminal` already has `sessionId`, so pass it as the new first or second argument of `createWebLinkHandler(...)` and `createFilePathLinkProvider(...)`.

- [ ] **Step 4: Run the tests**

```bash
bun test packages/ui/src/components/panes/terminal/terminal-links.test.ts
for f in packages/ui/src/components/panes/terminal/*.test.ts packages/ui/src/lib/terminal-wrapped-links.test.ts; do bun test "$f" || echo "FAILED: $f"; done
```

Expected: PASS.

- [ ] **Step 5: Typecheck, lint, format, commit**

```bash
bun run typecheck
bunx eslint packages/ui/src/components/panes/terminal
bunx prettier --check packages/ui/src/components/panes/terminal/terminal-links.ts packages/ui/src/components/panes/terminal/terminal-link-provider.ts packages/ui/src/components/panes/terminal/terminal-lifecycle.ts packages/ui/src/components/panes/terminal/terminal-links.test.ts
git add packages/ui/src/components/panes/terminal
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
7. Drop a shell tab on a sidebar gap: nothing happens, and the tabs don't reorder.
8. Move a session into Master with the CLI (`taskflow-cli session move --master`), then click a relative file path it prints. It opens relative to the session's original directory.
9. Quit the dev app with Cmd+Q and start it again. The moved session is offered for restore in the task it was moved to (expected behaviour for interrupted agent sessions). Resuming it starts in its original cwd.

Record the result of each step in `handoff.md`.

- [ ] **Step 3: Whole-change review**

Run the `codex-review` skill against the range from the first Section 1 commit to HEAD (`codex exec review --base <commit before Section 1> -m gpt-6.1-sol -c sandbox_mode=read-only`, run in the background). Verify each finding yourself before acting on it. Fix the confirmed ones with tests.

- [ ] **Step 4: Close out**

- Update `handoff.md` to "complete".
- `task-tray log add TSK-3 --type info "<summary>"`, and log each commit with `--type commit`.
- `task-tray task status TSK-3 in-review`. The user moves it to done.
