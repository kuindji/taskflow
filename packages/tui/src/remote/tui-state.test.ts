import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { readTuiState, writeTuiState, type TuiState } from "./tui-state";

let dir: string;

beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "taskflow-tui-state-"));
});

afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
});

describe("tui state round trip", () => {
    it("reads back what was written", async () => {
        const state: TuiState = {
            lastMachineId: "local",
            selections: { local: { projectId: "p1", taskId: "t1" } },
        };
        await writeTuiState(dir, state);
        expect(await readTuiState(dir)).toEqual(state);
    });

    it("returns empty state when the file is missing", async () => {
        expect(await readTuiState(dir)).toEqual({ lastMachineId: null, selections: {} });
    });

    it("returns empty state when the file is unparsable", async () => {
        await writeFile(join(dir, "state.json"), "{");
        expect(await readTuiState(dir)).toEqual({ lastMachineId: null, selections: {} });
    });

    it("leaves no temp file behind after a write", async () => {
        await writeTuiState(dir, { lastMachineId: null, selections: {} });
        const files = await readdir(dir);
        expect(files.some((name) => name.endsWith(".tmp"))).toBe(false);
    });

    it("returns empty state when the file contains a JSON null", async () => {
        await writeFile(join(dir, "state.json"), "null");
        expect(await readTuiState(dir)).toEqual({ lastMachineId: null, selections: {} });
    });

    it("returns empty state when the file contains a JSON array", async () => {
        await writeFile(join(dir, "state.json"), "[]");
        expect(await readTuiState(dir)).toEqual({ lastMachineId: null, selections: {} });
    });

    it("returns empty state when lastMachineId has the wrong type", async () => {
        await writeFile(
            join(dir, "state.json"),
            JSON.stringify({ lastMachineId: 42, selections: {} }),
        );
        expect(await readTuiState(dir)).toEqual({ lastMachineId: null, selections: {} });
    });

    it("drops invalid selection entries but keeps valid ones", async () => {
        await writeFile(
            join(dir, "state.json"),
            JSON.stringify({
                lastMachineId: "local",
                selections: {
                    good: { projectId: "p1", taskId: null },
                    bad: { projectId: 1, taskId: "t1" },
                    alsoBad: "not an object",
                },
            }),
        );
        expect(await readTuiState(dir)).toEqual({
            lastMachineId: "local",
            selections: { good: { projectId: "p1", taskId: null } },
        });
    });

    it("rejects when the state path is unreadable (a directory, not a file)", async () => {
        await mkdir(join(dir, "state.json"));
        let threw: unknown;
        try {
            await readTuiState(dir);
        } catch (error) {
            threw = error;
        }
        expect(threw).toBeInstanceOf(Error);
    });
});
