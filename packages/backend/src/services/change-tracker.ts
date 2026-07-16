import type { ChangeStats, WsEvent } from "@taskflow/shared";
import { MSG } from "@taskflow/shared";
import type { GitService } from "./git-service";
import { stat, readFile } from "fs/promises";
import { join } from "path";

const POLL_TICK = 3_000;
const POLL_INTERVAL_LARGE = 10_000;
const FETCH_INTERVAL = 600_000;
const LARGE_CHANGESET_THRESHOLD = 200;
const MAX_UNTRACKED_FILE_SIZE = 1_048_576; // 1MB
const FILE_CHANGE_DEBOUNCE = 300;
// Targets whose stats keep coming back unchanged are polled less and less often;
// any file change, git action, or fetched ref update snaps them back to the front
const BACKOFF_INTERVALS = [3_000, 10_000, 30_000, 60_000];

interface TrackedTarget {
    id: string;
    path: string;
    stats: ChangeStats | null;
    invalidated: boolean;
    polling: boolean;
    backoffIndex: number;
    nextPollDue: number;
}

function statsEqual(a: ChangeStats | null, b: ChangeStats | null): boolean {
    if (a === null && b === null) return true;
    if (a === null || b === null) return false;
    return (
        a.additions === b.additions &&
        a.deletions === b.deletions &&
        a.fileCount === b.fileCount &&
        a.ahead === b.ahead &&
        a.behind === b.behind &&
        a.hasChanges === b.hasChanges &&
        a.branch === b.branch &&
        a.diffDisabled === b.diffDisabled &&
        a.commitDisabled === b.commitDisabled
    );
}

export class ChangeTracker {
    private targets = new Map<string, TrackedTarget>();
    private pollTimer: ReturnType<typeof setTimeout> | null = null;
    private fetchTimer: ReturnType<typeof setTimeout> | null = null;
    private polling = false;
    private fetching = false;
    private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

    constructor(
        private git: GitService,
        private broadcast: (event: WsEvent) => void,
    ) {}

    track(id: string, path: string): void {
        if (this.targets.has(id)) return;
        this.targets.set(id, {
            id,
            path,
            stats: null,
            invalidated: true,
            polling: false,
            backoffIndex: 0,
            nextPollDue: 0,
        });
        if (!this.pollTimer) this.startPolling();
    }

    untrack(id: string): void {
        const target = this.targets.get(id);
        if (!target) return;
        this.targets.delete(id);
        const timer = this.debounceTimers.get(id);
        if (timer) {
            clearTimeout(timer);
            this.debounceTimers.delete(id);
        }
        this.broadcast({
            type: MSG.GIT_CHANGE_STATS,
            payload: { targetId: id, stats: null },
        });
        if (this.targets.size === 0) this.stopPolling();
    }

    invalidate(path: string): void {
        for (const target of this.getTargetsForPath(path)) {
            target.invalidated = true;
            void this.pollTarget(target);
        }
    }

    /** Called when a file changes in a watched directory */
    onFileChanged(filePath: string): void {
        for (const target of this.getTargetsForPath(filePath)) {
            const existing = this.debounceTimers.get(target.id);
            if (existing) clearTimeout(existing);
            this.debounceTimers.set(
                target.id,
                setTimeout(() => {
                    this.debounceTimers.delete(target.id);
                    void this.pollTarget(target);
                }, FILE_CHANGE_DEBOUNCE),
            );
        }
    }

    /** Send current cached stats for all targets to a newly connected client */
    sendCurrentStats(): void {
        for (const target of this.targets.values()) {
            this.broadcast({
                type: MSG.GIT_CHANGE_STATS,
                payload: { targetId: target.id, stats: target.stats },
            });
        }
    }

    private getTargetsForPath(path: string): TrackedTarget[] {
        const matches: TrackedTarget[] = [];
        for (const target of this.targets.values()) {
            if (target.path === path || path.startsWith(target.path + "/")) {
                matches.push(target);
            }
        }
        return matches;
    }

    private startPolling(): void {
        if (this.pollTimer) return;
        this.schedulePoll();
        // Run an immediate non-blocking fetch so remote changes are detected on startup
        void this.fetchAll().finally(() => {
            if (this.targets.size > 0) this.scheduleFetch();
        });
    }

    private stopPolling(): void {
        if (this.pollTimer) {
            clearTimeout(this.pollTimer);
            this.pollTimer = null;
        }
        if (this.fetchTimer) {
            clearTimeout(this.fetchTimer);
            this.fetchTimer = null;
        }
        for (const timer of this.debounceTimers.values()) {
            clearTimeout(timer);
        }
        this.debounceTimers.clear();
    }

    private schedulePoll(): void {
        this.pollTimer = setTimeout(() => {
            this.pollTimer = null;
            void this.pollDue().finally(() => {
                if (this.targets.size > 0) this.schedulePoll();
            });
        }, POLL_TICK);
    }

    /** Poll invalidated targets and those whose backoff interval has elapsed */
    private async pollDue(): Promise<void> {
        if (this.polling) return;
        this.polling = true;
        try {
            const now = Date.now();
            for (const target of this.targets.values()) {
                // Invalidated targets are polled regardless of backoff — this catches
                // invalidations that arrived while a poll on the target was in flight
                const invalidated = target.invalidated;
                if (!invalidated && now < target.nextPollDue) continue;
                await this.pollTarget(target, !invalidated);
            }
        } finally {
            this.polling = false;
        }
    }

    private scheduleFetch(): void {
        if (this.fetchTimer) return;
        this.fetchTimer = setTimeout(() => {
            this.fetchTimer = null;
            void this.fetchAll().finally(() => {
                if (this.targets.size > 0) this.scheduleFetch();
            });
        }, FETCH_INTERVAL);
    }

    private async fetchAll(): Promise<void> {
        if (this.fetching) return;
        this.fetching = true;
        try {
            let anyChanged = false;
            for (const target of this.targets.values()) {
                if (await this.git.fetch(target.path)) anyChanged = true;
            }
            // Linked worktrees share remote-tracking refs with their parent repo, so a
            // fetch in one target can move another target's behind count while that
            // target's own fetch reports nothing new. When any fetch updated refs,
            // re-poll everything — at most one extra pass per FETCH_INTERVAL.
            if (anyChanged) {
                for (const target of this.targets.values()) {
                    await this.pollTarget(target);
                }
            }
        } finally {
            this.fetching = false;
        }
    }

    private async pollTarget(target: TrackedTarget, fromScheduler = false): Promise<void> {
        if (target.polling) {
            // A poll is already in flight and may have read pre-change state; flag the
            // target so the next scheduler tick re-polls it instead of waiting out the
            // backoff window
            target.invalidated = true;
            return;
        }
        target.polling = true;
        try {
            // Clear the flag before reading state so an invalidation arriving while
            // computeStats runs stays set and forces a prompt re-poll
            target.invalidated = false;
            const stats = await this.computeStats(target.path);
            const changed = !statsEqual(target.stats, stats);
            if (changed) {
                target.stats = stats;
                this.broadcast({
                    type: MSG.GIT_CHANGE_STATS,
                    payload: { targetId: target.id, stats },
                });
            }
            // Back off only on scheduled polls that found nothing new; event-driven
            // polls (file change, git action, fetch) signal activity, so stay fast
            target.backoffIndex =
                changed || !fromScheduler
                    ? 0
                    : Math.min(target.backoffIndex + 1, BACKOFF_INTERVALS.length - 1);
            const largeChangeset = stats.fileCount >= LARGE_CHANGESET_THRESHOLD;
            target.nextPollDue =
                Date.now() +
                Math.max(
                    BACKOFF_INTERVALS[target.backoffIndex],
                    largeChangeset ? POLL_INTERVAL_LARGE : 0,
                );
        } catch {
            // Git command failed (repo not ready, not a repo, etc.) — back off so a
            // permanently failing target doesn't spawn failing git processes every tick
            target.backoffIndex = Math.min(target.backoffIndex + 1, BACKOFF_INTERVALS.length - 1);
            target.nextPollDue = Date.now() + BACKOFF_INTERVALS[target.backoffIndex];
        } finally {
            target.polling = false;
        }
    }

    private async computeStats(repoPath: string): Promise<ChangeStats> {
        // Run numstat for unstaged and staged in parallel (safe — they don't lock)
        const [unstaged, staged] = await Promise.all([
            this.git.numstat(repoPath, false),
            this.git.numstat(repoPath, true),
        ]);

        // Get status for branch, ahead count, and untracked file list
        const status = await this.git.status(repoPath);

        // Count lines in untracked files from disk
        let untrackedAdditions = 0;
        const untrackedFiles = status.unstagedFiles.filter((f) => f.status === "untracked");
        for (const file of untrackedFiles) {
            untrackedAdditions += await this.countFileLines(join(repoPath, file.path));
        }

        const additions =
            unstaged.reduce((sum, e) => sum + e.additions, 0) +
            staged.reduce((sum, e) => sum + e.additions, 0) +
            untrackedAdditions;
        const deletions =
            unstaged.reduce((sum, e) => sum + e.deletions, 0) +
            staged.reduce((sum, e) => sum + e.deletions, 0);

        const fileCount = status.stagedFiles.length + status.unstagedFiles.length;
        const hasChanges = fileCount > 0;

        return {
            additions,
            deletions,
            fileCount,
            branch: status.branch,
            ahead: status.ahead,
            behind: status.behind,
            hasChanges,
            diffDisabled: !hasChanges,
            commitDisabled: !hasChanges && status.ahead === 0,
        };
    }

    private async countFileLines(filePath: string): Promise<number> {
        try {
            const info = await stat(filePath);
            if (!info.isFile() || info.size > MAX_UNTRACKED_FILE_SIZE) return 0;
            const content = await readFile(filePath, "utf-8");
            // Count newlines; a file with content but no newline still has 1 line
            const newlines = content.split("\n").length;
            return content.endsWith("\n") ? newlines - 1 : newlines;
        } catch {
            return 0;
        }
    }

    dispose(): void {
        this.stopPolling();
        this.targets.clear();
    }
}
