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

/** Missing or unparsable state reads back as empty rather than throwing: a
 *  torn or corrupt file must not block the TUI from starting. */
async function readTuiState(dir: string): Promise<TuiState> {
    try {
        const raw = await readFile(join(dir, STATE_FILE_NAME), "utf-8");
        return JSON.parse(raw) as TuiState;
    } catch {
        return emptyState();
    }
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
