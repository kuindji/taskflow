import { create } from "zustand";
import type { GitDiffResult, GitStatusResult, FileChangedEvent } from "@taskflow/shared";
import { MSG } from "@taskflow/shared";
import { onEvent, sendRequest } from "../hooks/useWebSocket";

interface DiffStats {
    additions: number;
    deletions: number;
}

interface DiffTarget {
    id: string;
    path: string;
}

interface DiffStore {
    statsByProject: Record<string, DiffStats | null>;
    commitDisabledByProject: Record<string, boolean>;
    fetchDiff(projectId: string, path: string): Promise<void>;
    fetchAllDiffs(projects: DiffTarget[]): void;
    clearStaleProjects(projectIds: string[]): void;
    startPolling(projects: DiffTarget[]): () => void;
}

function isWithinProjectPath(filePath: string, projectPath: string): boolean {
    return filePath === projectPath || filePath.startsWith(`${projectPath}/`);
}

let pollCleanup: (() => void) | null = null;
const requestVersions = new Map<string, number>();

function nextVersion(projectId: string): number {
    const v = (requestVersions.get(projectId) ?? 0) + 1;
    requestVersions.set(projectId, v);
    return v;
}

export const useDiffStore = create<DiffStore>((set, get) => ({
    statsByProject: {},
    commitDisabledByProject: {},

    async fetchDiff(projectId, path) {
        const version = nextVersion(projectId);

        const [diffRes, statusRes] = await Promise.allSettled([
            sendRequest<{ diff: GitDiffResult }>(MSG.GIT_DIFF, { path }),
            sendRequest<{ status: GitStatusResult }>(MSG.GIT_STATUS, { path }),
        ]);

        if (requestVersions.get(projectId) !== version) return;

        let stats: DiffStats | null = null;
        if (diffRes.status === "fulfilled") {
            const totals = diffRes.value.diff.files.reduce(
                (acc, f) => ({
                    additions: acc.additions + f.additions,
                    deletions: acc.deletions + f.deletions,
                }),
                { additions: 0, deletions: 0 },
            );
            stats = totals.additions === 0 && totals.deletions === 0 ? null : totals;
        }

        let commitDisabled = true;
        if (statusRes.status === "fulfilled") {
            const { status } = statusRes.value;
            commitDisabled = status.files.length === 0 && status.ahead === 0;
        } else {
            commitDisabled = false;
        }

        set((state) => ({
            statsByProject: { ...state.statsByProject, [projectId]: stats },
            commitDisabledByProject: {
                ...state.commitDisabledByProject,
                [projectId]: commitDisabled,
            },
        }));
    },

    fetchAllDiffs(projects) {
        for (const p of projects) {
            void get().fetchDiff(p.id, p.path);
        }
    },

    clearStaleProjects(projectIds) {
        set((state) => {
            const idSet = new Set(projectIds);
            const stats = Object.fromEntries(
                Object.entries(state.statsByProject).filter(([id]) => idSet.has(id)),
            );
            const commit = Object.fromEntries(
                Object.entries(state.commitDisabledByProject).filter(([id]) => idSet.has(id)),
            );
            return { statsByProject: stats, commitDisabledByProject: commit };
        });
    },

    startPolling(projects) {
        if (pollCleanup) {
            pollCleanup();
            pollCleanup = null;
        }

        if (projects.length === 0) return () => {};

        const store = get();
        store.clearStaleProjects(projects.map((p) => p.id));
        store.fetchAllDiffs(projects);

        const refreshAll = () => get().fetchAllDiffs(projects);

        const interval = setInterval(refreshAll, 15_000);

        const refreshTimers = new Map<string, ReturnType<typeof setTimeout>>();
        const unsubscribeFileChanged = onEvent(MSG.FILE_CHANGED, (payload) => {
            const event = payload as FileChangedEvent;
            const project = projects.find((p) => isWithinProjectPath(event.path, p.path));
            if (!project) return;

            const timer = refreshTimers.get(project.id);
            if (timer) clearTimeout(timer);

            refreshTimers.set(
                project.id,
                setTimeout(() => {
                    refreshTimers.delete(project.id);
                    void get().fetchDiff(project.id, project.path);
                }, 150),
            );
        });

        const onVisibilityChange = () => {
            if (document.visibilityState === "visible") refreshAll();
        };
        document.addEventListener("visibilitychange", onVisibilityChange);

        const cleanup = () => {
            clearInterval(interval);
            unsubscribeFileChanged();
            refreshTimers.forEach((timer) => clearTimeout(timer));
            refreshTimers.clear();
            document.removeEventListener("visibilitychange", onVisibilityChange);
        };

        pollCleanup = cleanup;
        return cleanup;
    },
}));
