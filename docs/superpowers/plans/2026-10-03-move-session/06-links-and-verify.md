# Section 6: Terminal link cwd, TUI check, manual verification

Read first: the plan index, `handoff.md`, and the spec sections "Terminal links", "TUI" and "Testing → Manual". Section 5 has to be done.

### Task 10: Resolve relative terminal links against the session's own cwd

**Why.** A moved session's terminal is rebuilt when its tab mounts in the target workspace. That happens because tabs that leave a workspace are destroyed after 50 ms. On rebuild, `createFilePathLinkProvider` is given the *target* owner. `getWorkingDir` then resolves relative paths against the target's worktree, but the agent is still running in the source's. The fix is to prefer `SessionRef.cwd`.

**Files:**
- Modify: `packages/ui/src/components/panes/terminal/terminal-links.ts`, `getWorkingDir` (lines 14-30).
- Modify: `packages/ui/src/components/panes/terminal/terminal-link-provider.ts`. `createFilePathLinkProvider` (line 119) gets `sessionId`, and line 135 passes it on.
- Modify: `packages/ui/src/components/panes/terminal/terminal-lifecycle.ts` (line 189). Pass `sessionId` into `createFilePathLinkProvider`.
- Test: `packages/ui/src/components/panes/terminal/terminal-links.test.ts` (new).

**Interfaces:**
- Produces: `getWorkingDir(sessionId: string, taskId?: string, projectId?: string, master?: boolean): string | null`. Returns the session's recorded `cwd` when the owner's session list has one, and otherwise falls back to today's owner-based directory.

- [ ] **Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it } from "bun:test";
import type { Project, SessionRef, Task } from "@taskflow/shared";
import { useProjectStore } from "@/stores/project-store";
import { useTaskStore } from "@/stores/task-store";
import { getWorkingDir } from "./terminal-links";

const moved: SessionRef = {
    id: "s1",
    type: "claude",
    label: "Claude",
    createdAt: "2026-10-03T00:00:00.000Z",
    cwd: "/repo/.worktrees/source-task",
};

function task(sessions: SessionRef[]): Task & { backendId: string } {
    return {
        id: "target",
        projectId: "p1",
        title: "Target",
        description: "",
        notes: "",
        worktree: { enabled: true, path: "/repo/.worktrees/target", branch: "task/target", pr: null },
        sessions,
        attributes: [],
        createdAt: "2026-10-03T00:00:00.000Z",
        status: "active",
        archivedAt: null,
        pinned: false,
        backendId: "local",
    };
}

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
    });

    it("prefers the session's own cwd over the owner's worktree", () => {
        useTaskStore.setState({ tasks: [task([moved])] });

        expect(getWorkingDir("s1", "target")).toBe("/repo/.worktrees/source-task");
    });

    it("falls back to the owner's directory when the session has no cwd", () => {
        useTaskStore.setState({ tasks: [task([{ ...moved, cwd: undefined }])] });

        expect(getWorkingDir("s1", "target")).toBe("/repo/.worktrees/target");
    });
});
```

If `Project` requires more fields than this fixture has, add them with their empty values. Keep the fixture typed; do not cast.

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test packages/ui/src/components/panes/terminal/terminal-links.test.ts`
Expected: FAIL. The first case returns the target worktree.

- [ ] **Step 3: Implement**

```ts
function getWorkingDir(
    sessionId: string,
    taskId?: string,
    projectId?: string,
    master?: boolean,
): string | null {
    if (taskId) {
        const task = useTaskStore.getState().tasks.find((t) => t.id === taskId);
        if (!task) return null;
        const cwd = task.sessions.find((session) => session.id === sessionId)?.cwd;
        if (cwd) return cwd;
        const project = useProjectStore.getState().projects.find((p) => p.id === task.projectId);
        if (!project) return null;
        return task.worktree.enabled && task.worktree.path ? task.worktree.path : project.path;
    }
    if (projectId) {
        const project = useProjectStore.getState().projects.find((p) => p.id === projectId);
        const cwd = project?.sessions.find((session) => session.id === sessionId)?.cwd;
        return cwd ?? project?.path ?? null;
    }
    if (master) {
        return null;
    }
    return null;
}
```

`createFilePathLinkProvider(term, sessionId, taskId, projectId, master)` passes `sessionId` to `getWorkingDir`. In `terminal-lifecycle.ts`, `getOrCreateTerminal` already has `sessionId`, so pass it as the second argument.

- [ ] **Step 4: Run the tests**

```bash
bun test packages/ui/src/components/panes/terminal/terminal-links.test.ts
for f in packages/ui/src/components/panes/terminal/*.test.ts packages/ui/src/lib/terminal-wrapped-links.test.ts; do bun test "$f" || echo "FAILED: $f"; done
```

Expected: PASS.

- [ ] **Step 5: Typecheck, lint, format, commit**

```bash
bun run typecheck
bunx eslint packages/ui/src/components/panes/terminal/terminal-links.ts packages/ui/src/components/panes/terminal/terminal-link-provider.ts packages/ui/src/components/panes/terminal/terminal-lifecycle.ts packages/ui/src/components/panes/terminal/terminal-links.test.ts
bunx prettier --check packages/ui/src/components/panes/terminal/terminal-links.ts packages/ui/src/components/panes/terminal/terminal-link-provider.ts packages/ui/src/components/panes/terminal/terminal-lifecycle.ts packages/ui/src/components/panes/terminal/terminal-links.test.ts
git add packages/ui/src/components/panes/terminal
git commit -m "fix(ui): resolve terminal file links against the session's own cwd"
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
6. Quit the dev app with Cmd+Q and start it again. The moved session is offered for restore in the task it was moved to (expected behaviour for interrupted agent sessions). Resuming it starts in its original cwd.

Record the result of each step in `handoff.md`.

- [ ] **Step 3: Whole-change review**

Run the `codex-review` skill against the range from the first Section 1 commit to HEAD (`codex exec review --base <commit before Section 1> -m gpt-6.1-sol -c sandbox_mode=read-only`, run in the background). Verify each finding yourself before acting on it. Fix the confirmed ones with tests.

- [ ] **Step 4: Close out**

- Update `handoff.md` to "complete".
- `task-tray log add TSK-3 --type info "<summary>"`, and log each commit with `--type commit`.
- `task-tray task status TSK-3 in-review`. The user moves it to done.
