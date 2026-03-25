import { create } from "zustand";
import type { ChangeStatsEvent } from "@taskflow/shared";
import { MSG } from "@taskflow/shared";
import { onEvent } from "../hooks/useWebSocket";

export interface DiffStats {
    additions: number;
    deletions: number;
}

interface DiffStore {
    statsByProject: Record<string, DiffStats | null>;
    diffDisabledByProject: Record<string, boolean>;
    commitDisabledByProject: Record<string, boolean>;
    hasChangesByProject: Record<string, boolean>;
    branchByProject: Record<string, string | null>;
    aheadByProject: Record<string, number>;
    behindByProject: Record<string, number>;
}

export const useDiffStore = create<DiffStore>(() => ({
    statsByProject: {},
    diffDisabledByProject: {},
    commitDisabledByProject: {},
    hasChangesByProject: {},
    branchByProject: {},
    aheadByProject: {},
    behindByProject: {},
}));

// Module-level listener — runs once when the module is imported
const _unsubChangeStats = onEvent(MSG.GIT_CHANGE_STATS, (payload) => {
    const { targetId, stats } = payload as ChangeStatsEvent;

    if (stats === null) {
        // Target was untracked — clear entry
        useDiffStore.setState((state) => {
            const { [targetId]: _s, ...restStats } = state.statsByProject;
            const { [targetId]: _d, ...restDiff } = state.diffDisabledByProject;
            const { [targetId]: _c, ...restCommit } = state.commitDisabledByProject;
            const { [targetId]: _h, ...restChanges } = state.hasChangesByProject;
            const { [targetId]: _b, ...restBranch } = state.branchByProject;
            const { [targetId]: _a, ...restAhead } = state.aheadByProject;
            const { [targetId]: _bh, ...restBehind } = state.behindByProject;
            return {
                statsByProject: restStats,
                diffDisabledByProject: restDiff,
                commitDisabledByProject: restCommit,
                hasChangesByProject: restChanges,
                branchByProject: restBranch,
                aheadByProject: restAhead,
                behindByProject: restBehind,
            };
        });
        return;
    }

    const diffStats: DiffStats | null =
        stats.additions === 0 && stats.deletions === 0
            ? null
            : {
                  additions: stats.additions,
                  deletions: stats.deletions,
              };

    useDiffStore.setState((state) => ({
        statsByProject: { ...state.statsByProject, [targetId]: diffStats },
        diffDisabledByProject: { ...state.diffDisabledByProject, [targetId]: stats.diffDisabled },
        commitDisabledByProject: {
            ...state.commitDisabledByProject,
            [targetId]: stats.commitDisabled,
        },
        hasChangesByProject: { ...state.hasChangesByProject, [targetId]: stats.hasChanges },
        branchByProject: { ...state.branchByProject, [targetId]: stats.branch },
        aheadByProject: { ...state.aheadByProject, [targetId]: stats.ahead },
        behindByProject: { ...state.behindByProject, [targetId]: stats.behind },
    }));
});

// Keep the export to prevent tree-shaking of the side-effect
export { _unsubChangeStats };
