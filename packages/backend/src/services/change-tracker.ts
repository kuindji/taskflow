import type { ChangeStats, WsEvent } from "@taskflow/shared";
import { MSG } from "@taskflow/shared";
import type { GitService } from "./git-service";
import { stat, readFile } from "fs/promises";
import { join } from "path";

const POLL_INTERVAL_NORMAL = 3_000;
const POLL_INTERVAL_LARGE = 10_000;
const FETCH_INTERVAL = 60_000;
const LARGE_CHANGESET_THRESHOLD = 200;
const MAX_UNTRACKED_FILE_SIZE = 1_048_576; // 1MB
const FILE_CHANGE_DEBOUNCE = 300;

interface TrackedTarget {
    id: string;
    path: string;
    stats: ChangeStats | null;
    invalidated: boolean;
    polling: boolean;
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
        this.targets.set(id, { id, path, stats: null, invalidated: true, polling: false });
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
        for (const target of this.targets.values()) {
            if (target.path === path || path.startsWith(target.path + "/")) {
                target.invalidated = true;
                void this.pollTarget(target);
                return;
            }
        }
    }

    /** Called when a file changes in a watched directory */
    onFileChanged(filePath: string): void {
        for (const target of this.targets.values()) {
            if (filePath === target.path || filePath.startsWith(target.path + "/")) {
                const existing = this.debounceTimers.get(target.id);
                if (existing) clearTimeout(existing);
                this.debounceTimers.set(
                    target.id,
                    setTimeout(() => {
                        this.debounceTimers.delete(target.id);
                        void this.pollTarget(target);
                    }, FILE_CHANGE_DEBOUNCE),
                );
                return;
            }
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

    private startPolling(): void {
        if (this.pollTimer) return;
        this.schedulePoll();
        this.scheduleFetch();
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
        const interval = this.getCurrentInterval();
        this.pollTimer = setTimeout(() => {
            this.pollTimer = null;
            void this.pollAll().finally(() => {
                if (this.targets.size > 0) this.schedulePoll();
            });
        }, interval);
    }

    private getCurrentInterval(): number {
        let totalFiles = 0;
        for (const target of this.targets.values()) {
            if (target.stats) totalFiles += target.stats.fileCount;
        }
        return totalFiles >= LARGE_CHANGESET_THRESHOLD ? POLL_INTERVAL_LARGE : POLL_INTERVAL_NORMAL;
    }

    private async pollAll(): Promise<void> {
        if (this.polling) return;
        this.polling = true;
        try {
            for (const target of this.targets.values()) {
                await this.pollTarget(target);
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
            for (const target of this.targets.values()) {
                await this.git.fetch(target.path);
                target.invalidated = true;
            }
            // Re-poll all targets after fetch to pick up behind count changes
            await this.pollAll();
        } finally {
            this.fetching = false;
        }
    }

    private async pollTarget(target: TrackedTarget): Promise<void> {
        if (target.polling) return; // prevent concurrent polls on same target
        target.polling = true;
        try {
            const stats = await this.computeStats(target.path);
            target.invalidated = false;
            if (!statsEqual(target.stats, stats)) {
                target.stats = stats;
                this.broadcast({
                    type: MSG.GIT_CHANGE_STATS,
                    payload: { targetId: target.id, stats },
                });
            }
        } catch {
            // Git command failed (repo not ready, etc.) — skip this cycle
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
