import { describe, it, expect } from "bun:test";
import { ChangeTracker } from "../../src/services/change-tracker";
import { MSG } from "@taskflow/shared";
import type { ChangeStats, GitStatusResult, WsEvent } from "@taskflow/shared";
import type { GitService } from "../../src/services/git-service";

class FakeGitService {
    statusCalls: string[] = [];
    fetchCalls: string[] = [];

    async numstat(): Promise<Array<{ path: string; additions: number; deletions: number }>> {
        return [];
    }

    async status(repoPath: string): Promise<GitStatusResult> {
        this.statusCalls.push(repoPath);
        return {
            branch: "main",
            stagedFiles: [],
            unstagedFiles: [],
            ahead: 0,
            behind: 0,
        };
    }

    async fetch(repoPath: string): Promise<void> {
        this.fetchCalls.push(repoPath);
    }
}

async function waitFor(condition: () => boolean, timeoutMs = 1500): Promise<void> {
    const started = Date.now();
    while (!condition()) {
        if (Date.now() - started > timeoutMs) {
            throw new Error("Timed out waiting for condition");
        }
        await Bun.sleep(25);
    }
}

describe("ChangeTracker", () => {
    it("invalidates both the project and nested worktree targets", async () => {
        const git = new FakeGitService();
        const events: WsEvent[] = [];
        const tracker = new ChangeTracker(git as unknown as GitService, (event) => {
            events.push(event);
        });
        const projectPath = "/repo";
        const worktreePath = "/repo/.worktrees/task-one";

        (tracker as unknown as { startPolling: () => void }).startPolling = () => {};

        tracker.track("project-id", projectPath);
        tracker.track("task-id", worktreePath);

        tracker.invalidate(worktreePath);

        await waitFor(() => git.statusCalls.length === 2);

        expect(git.statusCalls).toEqual([projectPath, worktreePath]);
        expect(events.filter((event) => event.type === MSG.GIT_CHANGE_STATS)).toHaveLength(2);
        tracker.dispose();
    });

    it("polls both the project and nested worktree after a file change inside the worktree", async () => {
        const git = new FakeGitService();
        const tracker = new ChangeTracker(git as unknown as GitService, (_event) => {});
        const projectPath = "/repo";
        const worktreePath = "/repo/.worktrees/task-one";

        (tracker as unknown as { startPolling: () => void }).startPolling = () => {};

        tracker.track("project-id", projectPath);
        tracker.track("task-id", worktreePath);

        tracker.onFileChanged("/repo/.worktrees/task-one/src/index.ts");

        await waitFor(() => git.statusCalls.length === 2);

        expect(git.statusCalls).toEqual([projectPath, worktreePath]);
        tracker.dispose();
    });

    it("clears tracked state for a removed target", () => {
        const git = new FakeGitService();
        const events: Array<{ targetId: string; stats: ChangeStats | null }> = [];
        const tracker = new ChangeTracker(git as unknown as GitService, (event) => {
            if (event.type === MSG.GIT_CHANGE_STATS) {
                events.push(event.payload as { targetId: string; stats: ChangeStats | null });
            }
        });

        (tracker as unknown as { startPolling: () => void }).startPolling = () => {};

        tracker.track("task-id", "/repo/.worktrees/task-one");
        tracker.untrack("task-id");

        expect(events).toEqual([{ targetId: "task-id", stats: null }]);
        tracker.dispose();
    });
});
