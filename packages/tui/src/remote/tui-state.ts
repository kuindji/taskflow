import { mkdir, readFile, rename, writeFile } from "fs/promises";
import { join } from "path";

interface TuiState {
    lastMachineId: string | null;
    selections: Record<string, { projectId: string | null; taskId: string | null }>;
}

const STATE_FILE_NAME = "state.json";

function emptyState(): TuiState {
    return { lastMachineId: null, selections: {} };
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
    return error instanceof Error && "code" in error;
}

function isStringOrNull(value: unknown): value is string | null {
    return value === null || typeof value === "string";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSelectionEntry(
    value: unknown,
): value is { projectId: string | null; taskId: string | null } {
    return isPlainObject(value) && isStringOrNull(value.projectId) && isStringOrNull(value.taskId);
}

/** Validates a JSON value as a `TuiState` without an unchecked cast. An
 *  invalid top level (not an object, or `lastMachineId`/`selections` of the
 *  wrong shape) falls back to empty; individual invalid selection entries
 *  are dropped rather than invalidating the whole state. */
function parseTuiState(value: unknown): TuiState {
    if (!isPlainObject(value)) return emptyState();
    if (!isStringOrNull(value.lastMachineId)) return emptyState();
    if (!isPlainObject(value.selections)) return emptyState();

    const selections: TuiState["selections"] = {};
    for (const [id, entry] of Object.entries(value.selections)) {
        if (isSelectionEntry(entry)) selections[id] = entry;
    }
    return { lastMachineId: value.lastMachineId, selections };
}

/** A missing file, or one that isn't valid JSON, reads back as empty state
 *  rather than throwing: a torn or corrupt file must not block the TUI from
 *  starting. Any other read failure (permissions, the path being a
 *  directory, ...) propagates, since those aren't "no state yet". */
async function readTuiState(dir: string): Promise<TuiState> {
    let raw: string;
    try {
        raw = await readFile(join(dir, STATE_FILE_NAME), "utf-8");
    } catch (error) {
        if (isErrnoException(error) && error.code === "ENOENT") return emptyState();
        throw error;
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (error) {
        if (error instanceof SyntaxError) return emptyState();
        throw error;
    }

    return parseTuiState(parsed);
}

/** Temp file then rename, so a crash mid-write never leaves a torn state file. */
async function writeTuiState(dir: string, state: TuiState): Promise<void> {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const file = join(dir, STATE_FILE_NAME);
    const temp = `${file}.tmp`;
    await writeFile(temp, JSON.stringify(state, null, 2));
    await rename(temp, file);
}

export { readTuiState, writeTuiState };
export type { TuiState };
