import type { Task } from "@taskflow/shared";

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
    return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function isJsonParseError(error: unknown): error is SyntaxError {
    return error instanceof SyntaxError;
}

function getCreatedAtTimestamp(value: string): number {
    const timestamp = Date.parse(value);
    return Number.isNaN(timestamp) ? 0 : timestamp;
}

function compareTasksByCreatedAtDesc(a: Task, b: Task): number {
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
}

export { isMissingFileError, isJsonParseError, getCreatedAtTimestamp, compareTasksByCreatedAtDesc };
