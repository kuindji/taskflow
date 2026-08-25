import { MSG } from "@taskflow/shared";
import type {
    ChangeStatsEvent,
    GitCommitResult,
    GitStatusResponse,
    GitStatusResult,
} from "@taskflow/shared";
import type { NetLike } from "../net/client";
import type { GitChange } from "./model";

interface GitDiffState {
    key: string;
    path: string;
    staged: boolean;
    text: string | null;
}

class GitStore {
    private repoPath: string | null = null;
    private targetId: string | null = null;
    private statusSnapshot: GitStatusResult | null = null;
    private diffSnapshot: GitDiffState | null = null;
    private statusToken = 0;
    private diffToken = 0;
    private disposed = false;
    private readonly listeners = new Set<() => void>();
    private readonly disposers: (() => void)[] = [];

    constructor(private readonly net: NetLike) {
        this.disposers.push(
            net.on(MSG.GIT_CHANGE_STATS, (payload) => {
                const event = payload as Partial<ChangeStatsEvent>;
                if (!event.targetId || event.targetId !== this.targetId || !this.repoPath) return;
                void this.loadStatus(this.repoPath, this.targetId).catch(() => undefined);
            }),
        );
    }

    get path(): string | null {
        return this.repoPath;
    }

    get status(): GitStatusResult | null {
        return this.statusSnapshot;
    }

    get diff(): GitDiffState | null {
        return this.diffSnapshot;
    }

    onChange(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private notify(): void {
        if (this.disposed) return;
        for (const listener of [...this.listeners]) listener();
    }

    async loadStatus(path: string, targetId: string): Promise<void> {
        const token = ++this.statusToken;
        if (path !== this.repoPath || targetId !== this.targetId) {
            this.repoPath = path;
            this.targetId = targetId;
            this.statusSnapshot = null;
            this.diffSnapshot = null;
            this.diffToken++;
            this.notify();
        }
        const response = await this.net.request<GitStatusResponse>(MSG.GIT_STATUS, { path });
        if (
            this.disposed ||
            token !== this.statusToken ||
            path !== this.repoPath ||
            targetId !== this.targetId
        ) {
            return;
        }
        this.statusSnapshot = response.status;
        if (
            this.diffSnapshot &&
            ![...response.status.stagedFiles, ...response.status.unstagedFiles].some(
                (file) => file.path === this.diffSnapshot?.path,
            )
        ) {
            this.diffSnapshot = null;
            this.diffToken++;
        }
        this.notify();
    }

    async loadDiff(change: GitChange): Promise<void> {
        const path = this.repoPath;
        if (!path) return;
        const token = ++this.diffToken;
        const key = change.key;
        const response = await this.net.request<{ staged?: string; unstaged?: string }>(
            MSG.GIT_DIFF_FILE,
            { repoPath: path, filePath: change.path },
        );
        if (this.disposed || token !== this.diffToken || path !== this.repoPath) return;
        this.diffSnapshot = {
            key,
            path: change.path,
            staged: change.staged,
            text: (change.staged ? response.staged : response.unstaged) ?? null,
        };
        this.notify();
    }

    async stage(change?: GitChange): Promise<void> {
        const path = this.requirePath();
        await this.net.request(MSG.GIT_STAGE, {
            repoPath: path,
            filePath: change?.path,
        });
        await this.loadStatus(path, this.requireTarget());
    }

    async unstage(change?: GitChange): Promise<void> {
        const path = this.requirePath();
        await this.net.request(MSG.GIT_UNSTAGE, {
            repoPath: path,
            filePath: change?.path,
        });
        await this.loadStatus(path, this.requireTarget());
    }

    async commit(message: string): Promise<GitCommitResult> {
        const path = this.requirePath();
        const trimmed = message.trim();
        if (!trimmed) throw new Error("Commit message is required");
        if (!this.statusSnapshot?.stagedFiles.length) throw new Error("Stage a file before committing");
        const result = await this.net.request<GitCommitResult>(MSG.GIT_COMMIT, {
            path,
            message: trimmed,
            push: false,
            includeUnstaged: false,
        });
        await this.loadStatus(path, this.requireTarget());
        return result;
    }

    async generateMessage(): Promise<string> {
        const path = this.requirePath();
        if (!this.statusSnapshot?.stagedFiles.length) throw new Error("Stage a file before generating");
        const response = await this.net.request<{ message: string }>(MSG.GIT_GENERATE_COMMIT_MSG, {
            path,
            includeUnstaged: false,
        });
        return response.message;
    }

    clear(): void {
        this.repoPath = null;
        this.targetId = null;
        this.statusSnapshot = null;
        this.diffSnapshot = null;
        this.statusToken++;
        this.diffToken++;
        this.notify();
    }

    private requirePath(): string {
        if (!this.repoPath) throw new Error("No repository selected");
        return this.repoPath;
    }

    private requireTarget(): string {
        if (!this.targetId) throw new Error("No repository owner selected");
        return this.targetId;
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.statusToken++;
        this.diffToken++;
        for (const dispose of this.disposers) dispose();
        this.disposers.length = 0;
        this.listeners.clear();
    }
}

export { GitStore };
export type { GitDiffState };
