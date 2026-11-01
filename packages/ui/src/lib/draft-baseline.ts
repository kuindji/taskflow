import type { RefObject } from "react";

/**
 * A save that failed hands its fields back to the dirty set: the baseline
 * returns to `previous` for each field still at the value that failed, so the
 * next edit or the switch-away flush sends it again instead of treating the
 * unsaved text as saved.
 */
export function restoreFailedBaseline<T extends Record<string, string>>(
    baseline: RefObject<T>,
    previous: T,
    attempted: T,
): void {
    const restored = { ...baseline.current };
    for (const key of Object.keys(attempted) as (keyof T)[]) {
        if (restored[key] === attempted[key]) restored[key] = previous[key];
    }
    baseline.current = restored;
}

/**
 * Records `sent` as the latest of the saves whose replies are pending, oldest
 * first. The list empties when the latest one settles.
 */
export function trackSave<T, R>(pending: RefObject<T[]>, sent: T, save: Promise<R>): Promise<R> {
    pending.current = [...pending.current, sent];
    return save.finally(() => {
        if (pending.current.at(-1) === sent) pending.current = [];
    });
}

/**
 * A record that matches an older pending save but not the latest one is that
 * older save's reply, landing while a newer save is in flight. Adopting it
 * would revert the newer edit on screen and in the next save.
 */
export function isStaleReply<T>(pending: readonly T[], matches: (sent: T) => boolean): boolean {
    const latest = pending.at(-1);
    return latest !== undefined && !matches(latest) && pending.slice(0, -1).some(matches);
}
