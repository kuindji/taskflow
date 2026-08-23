import type { Task } from "../types/task";

function getCreatedAtTimestamp(value: string): number {
    const timestamp = Date.parse(value);
    return Number.isNaN(timestamp) ? 0 : timestamp;
}

/**
 * The order the backend serves tasks in: pinned first, then newest first, then
 * by id so equal timestamps stay stable. Clients that fold incremental
 * broadcasts into a snapshot have to reapply it, or their lists drift from the
 * order the next snapshot will bring back.
 */
export function sortTasksByCreatedAtDesc(tasks: Task[]): Task[] {
    return [...tasks].sort((a, b) => {
        const aPinned = a.pinned ? 1 : 0;
        const bPinned = b.pinned ? 1 : 0;
        if (aPinned !== bPinned) {
            return bPinned - aPinned;
        }

        const createdAtDiff = getCreatedAtTimestamp(b.createdAt) - getCreatedAtTimestamp(a.createdAt);
        if (createdAtDiff !== 0) {
            return createdAtDiff;
        }

        return a.id.localeCompare(b.id);
    });
}
