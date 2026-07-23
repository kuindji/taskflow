import { describe, it, expect, afterEach, setSystemTime } from "bun:test";
import { ChangeTracker } from "../../src/services/change-tracker";
import { MSG } from "@taskflow/shared";
import type { ChangeStats, GitStatusResult, WsEvent } from "@taskflow/shared";
import type { GitService } from "../../src/services/git-service";

class FakeGitService {
    statusCalls: string[] = [];
    fetchCalls: string[] = [];
    fetchResults: Record<string, boolean> = {};
    statusGate: Promise<void> | null = null;

    async numstat(): Promise<Array<{ path: string; additions: number; deletions: number }>> {
        return [];
    }

    async status(repoPath: string): Promise<GitStatusResult> {
        this.statusCalls.push(repoPath);
        if (this.statusGate) await this.statusGate;
        return {
            branch: "main",
            stagedFiles: [],
            unstagedFiles: [],
            ahead: 0,
            behind: 0,
        };
    }

    async fetch(repoPath: string): Promise<boolean> {
        this.fetchCalls.push(repoPath);
        return this.fetchResults[repoPath] ?? false;
    }
}

function stubStartPolling(tracker: ChangeTracker): void {
    (tracker as unknown as { startPolling: () => void }).startPolling = () => {};
}

function pollDue(tracker: ChangeTracker): Promise<void> {
    return (tracker as unknown as { pollDue: () => Promise<void> }).pollDue();
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
    afterEach(() => {
        setSystemTime();
    });

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

    it("backs off scheduled polls when stats stay unchanged", async () => {
        setSystemTime(new Date("2026-01-01T00:00:00Z"));
        const git = new FakeGitService();
        const tracker = new ChangeTracker(git as unknown as GitService, () => {});
        stubStartPolling(tracker);
        tracker.track("project-id", "/repo");

        // First poll picks up initial stats (null -> stats counts as a change)
        await pollDue(tracker);
        expect(git.statusCalls).toHaveLength(1);

        // Not due yet — no time has passed
        await pollDue(tracker);
        expect(git.statusCalls).toHaveLength(1);

        // Due after the base 3s interval; unchanged stats escalate backoff to 10s
        setSystemTime(new Date("2026-01-01T00:00:03Z"));
        await pollDue(tracker);
        expect(git.statusCalls).toHaveLength(2);

        // 5s later — still inside the 10s backoff window
        setSystemTime(new Date("2026-01-01T00:00:08Z"));
        await pollDue(tracker);
        expect(git.statusCalls).toHaveLength(2);

        // Past the 10s window — polled again, escalating to 30s
        setSystemTime(new Date("2026-01-01T00:00:14Z"));
        await pollDue(tracker);
        expect(git.statusCalls).toHaveLength(3);

        setSystemTime(new Date("2026-01-01T00:00:30Z"));
        await pollDue(tracker);
        expect(git.statusCalls).toHaveLength(3);

        tracker.dispose();
    });

    it("resets backoff when a target is invalidated", async () => {
        setSystemTime(new Date("2026-01-01T00:00:00Z"));
        const git = new FakeGitService();
        const tracker = new ChangeTracker(git as unknown as GitService, () => {});
        stubStartPolling(tracker);
        tracker.track("project-id", "/repo");

        // Escalate backoff to 10s with two unchanged scheduled polls
        await pollDue(tracker);
        setSystemTime(new Date("2026-01-01T00:00:03Z"));
        await pollDue(tracker);
        expect(git.statusCalls).toHaveLength(2);

        // Invalidation polls immediately, ignoring the backoff window
        tracker.invalidate("/repo");
        await waitFor(() => git.statusCalls.length === 3);

        // ...and resets the interval back to the base 3s
        setSystemTime(new Date("2026-01-01T00:00:06.5Z"));
        await pollDue(tracker);
        expect(git.statusCalls).toHaveLength(4);

        tracker.dispose();
    });

    it("re-polls all targets when any fetch updated refs, none otherwise", async () => {
        const git = new FakeGitService();
        const tracker = new ChangeTracker(git as unknown as GitService, () => {});
        stubStartPolling(tracker);
        tracker.track("a-id", "/repo-a");
        tracker.track("b-id", "/repo-b");
        const fetchAll = () => (tracker as unknown as { fetchAll: () => Promise<void> }).fetchAll();

        // No refs moved anywhere — no polls at all
        await fetchAll();
        expect(git.fetchCalls).toEqual(["/repo-a", "/repo-b"]);
        expect(git.statusCalls).toEqual([]);

        // One repo's refs moved — every target is re-polled, because linked worktrees
        // share remote-tracking refs and a sibling's behind count may have changed
        git.fetchResults = { "/repo-a": true };
        await fetchAll();
        expect(git.statusCalls).toEqual(["/repo-a", "/repo-b"]);
        tracker.dispose();
    });

    it("re-polls promptly when invalidated while a poll is in flight", async () => {
        setSystemTime(new Date("2026-01-01T00:00:00Z"));
        const git = new FakeGitService();
        const tracker = new ChangeTracker(git as unknown as GitService, () => {});
        stubStartPolling(tracker);
        tracker.track("project-id", "/repo");

        // Escalate backoff to 10s with two unchanged scheduled polls
        await pollDue(tracker);
        setSystemTime(new Date("2026-01-01T00:00:03Z"));
        await pollDue(tracker);
        expect(git.statusCalls).toHaveLength(2);

        // Start a scheduled poll that blocks inside git status
        let releaseGate = () => {};
        git.statusGate = new Promise<void>((resolve) => {
            releaseGate = resolve;
        });
        setSystemTime(new Date("2026-01-01T00:00:13Z"));
        const inFlight = pollDue(tracker);
        await waitFor(() => git.statusCalls.length === 3);

        // Invalidate mid-poll: the direct poll is dropped (target busy), but the
        // target must be flagged for the next scheduler pass
        tracker.invalidate("/repo");
        git.statusGate = null;
        releaseGate();
        await inFlight;
        expect(git.statusCalls).toHaveLength(3);

        // Next tick re-polls immediately despite the backoff window
        await pollDue(tracker);
        expect(git.statusCalls).toHaveLength(4);

        tracker.dispose();
    });
});
