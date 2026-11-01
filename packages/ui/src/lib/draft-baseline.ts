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
