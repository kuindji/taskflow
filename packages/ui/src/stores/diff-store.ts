import { create } from "zustand";
import type { ChangeStatsEvent } from "@taskflow/shared";
import { MSG } from "@taskflow/shared";
import { onEvent } from "@/lib/connection-registry";
import { registerBackendReset } from "./store-reset";

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

/**
 * The machine that reported each target. The maps stay flat — target ids are
 * project and task UUIDs, which cannot collide across machines — but a detach
 * must know which keys were that machine's.
 */
const ownerByTarget = new Map<string, string>();

function without<V>(map: Record<string, V>, keys: Set<string>): Record<string, V> {
    return Object.fromEntries(Object.entries(map).filter(([key]) => !keys.has(key)));
}

/** Every map rebuilt without `targetIds`. */
function omitKeys(state: DiffStore, targetIds: string[]): DiffStore {
    const keys = new Set(targetIds);
    return {
        statsByProject: without(state.statsByProject, keys),
        diffDisabledByProject: without(state.diffDisabledByProject, keys),
        commitDisabledByProject: without(state.commitDisabledByProject, keys),
        hasChangesByProject: without(state.hasChangesByProject, keys),
        branchByProject: without(state.branchByProject, keys),
        aheadByProject: without(state.aheadByProject, keys),
        behindByProject: without(state.behindByProject, keys),
    };
}

// Module-level listener — runs once when the module is imported
const _unsubChangeStats = onEvent(MSG.GIT_CHANGE_STATS, (payload, backendId) => {
    const { targetId, stats } = payload as ChangeStatsEvent;

    if (stats === null) {
        // Target was untracked — clear entry
        ownerByTarget.delete(targetId);
        useDiffStore.setState((state) => omitKeys(state, [targetId]));
        return;
    }

    ownerByTarget.set(targetId, backendId);
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

registerBackendReset("diff-store", (backendId) => {
    const dropped = [...ownerByTarget.entries()]
        .filter(([, owner]) => owner === backendId)
        .map(([targetId]) => targetId);
    if (dropped.length === 0) return;
    for (const targetId of dropped) ownerByTarget.delete(targetId);
    useDiffStore.setState((state) => omitKeys(state, dropped));
});

if (import.meta.hot) {
    import.meta.hot.dispose(() => {
        _unsubChangeStats();
    });
}
