import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { access, chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { MSG } from "@taskflow/shared";
import type { AppSettings, DataDirInfo, WsEvent } from "@taskflow/shared";
import { TestRouter } from "../test-router";
import { SettingsStore } from "../../src/services/settings-store";
import { DataDirGate, isUngatedMessage } from "../../src/services/data-dir-gate";
import { registerSettingsHandlers } from "../../src/handlers/settings";
import { expectRejects } from "../expect-rejects";

let tempDir: string;
let baseDir: string;
let oldDir: string;
let newDir: string;
let router: TestRouter;
let settingsStore: SettingsStore;
let events: WsEvent[];
let gate: DataDirGate;
let restartable: boolean;
let busyReason: () => Promise<string | null>;
let restarts: number;

function register(): void {
    router = new TestRouter();
    registerSettingsHandlers({
        router,
        settingsStore,
        broadcast: (event) => {
            events.push(event);
        },
        dataDir: {
            baseDir,
            current: oldDir,
            gate,
            restartable,
            findBusyReason: () => busyReason(),
            requestRestart: () => {
                restarts += 1;
            },
            drainTimeoutMs: 1_000,
        },
    });
}

beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "taskflow-settings-handlers-"));
    baseDir = join(tempDir, "base");
    oldDir = join(tempDir, "old");
    newDir = join(tempDir, "new");
    await mkdir(baseDir);
    await mkdir(join(oldDir, "flows"), { recursive: true });
    await mkdir(join(oldDir, "tasks"), { recursive: true });
    await writeFile(join(oldDir, "projects.json"), "ours");
    await writeFile(join(oldDir, "flows", "actions.json"), "[]");
    events = [];
    gate = new DataDirGate();
    restartable = true;
    busyReason = async () => null;
    restarts = 0;
    settingsStore = new SettingsStore(join(tempDir, "settings.json"));
    register();
});

afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
});

it("broadcasts the saved settings to every client after an update", async () => {
    const saved = (await router.handle(MSG.SETTINGS_UPDATE, {
        claude: { defaultModel: "haiku" },
    })) as AppSettings;

    expect(events).toEqual([{ type: MSG.SETTINGS_UPDATED, payload: { settings: saved } }]);
    expect(saved.claude.defaultModel).toBe("haiku");
});

it("broadcasts updates made outside the WS handler too", async () => {
    await settingsStore.update({ general: { confirmBeforeExit: false } });

    expect(events.map((event) => event.type)).toEqual([MSG.SETTINGS_UPDATED]);
});

describe("changing the data folder", () => {
    const change = (path: string, mode?: "overwrite" | "adopt") =>
        router.handle(MSG.SETTINGS_UPDATE_DATA_DIR, { path, mode }) as Promise<DataDirInfo>;

    async function pointer(): Promise<string | null> {
        try {
            const raw = await readFile(join(baseDir, "data-location.json"), "utf-8");
            return (JSON.parse(raw) as { path: string }).path;
        } catch {
            return null;
        }
    }

    async function expectOldFolderKept(): Promise<void> {
        expect(await readFile(join(oldDir, "projects.json"), "utf-8")).toBe("ours");
        expect(await readFile(join(oldDir, "flows", "actions.json"), "utf-8")).toBe("[]");
        expect(await pointer()).toBeNull();
        expect(gate.isClosed).toBe(false);
        expect(restarts).toBe(0);
    }

    it("moves the data, commits the pointer, keeps the gate closed and restarts", async () => {
        const result = await change(newDir);

        expect(result).toEqual({
            dataDir: newDir,
            baseDir,
            isDefault: false,
            restarting: true,
        });
        expect(await readFile(join(newDir, "flows", "actions.json"), "utf-8")).toBe("[]");
        expect(await readdir(oldDir)).toEqual([]);
        expect(await pointer()).toBe(newDir);
        expect(gate.isClosed).toBe(true);
        expect(restarts).toBe(1);
    });

    it("refuses while a session is running", async () => {
        busyReason = async () => "a session is running";

        await expectRejects(change(newDir), "while a session is running");

        await expectOldFolderKept();
    });

    it("lets a write admitted before the gate finish before the move starts", async () => {
        const write = gate.run(async () => {
            await Bun.sleep(30);
            await writeFile(join(oldDir, "tasks", "late.json"), "{}");
        });

        await change(newDir);
        await write;

        expect(await readFile(join(newDir, "tasks", "late.json"), "utf-8")).toBe("{}");
        await expectRejects(access(join(oldDir, "tasks", "late.json")));
    });

    it("refuses once a launch admitted before the gate has started its session", async () => {
        let sessions = 0;
        busyReason = async () => (sessions > 0 ? "a session is running" : null);
        const launch = gate.run(async () => {
            await Bun.sleep(30);
            sessions += 1;
        });

        await expectRejects(change(newDir), "while a session is running");
        await launch;

        await expectOldFolderKept();
    });

    it("refuses new launches and writes while the move runs", async () => {
        const refused: boolean[] = [];
        busyReason = async () => {
            if (gate.isClosed) {
                refused.push(gate.tryRun(async () => {}) === null);
                const write = gate.run(() => writeFile(join(oldDir, "tasks", "x.json"), "{}"));
                refused.push(await write.then(() => false).catch(() => true));
            }
            return null;
        };

        await change(newDir);

        expect(refused).toEqual([true, true]);
        await expectRejects(access(join(newDir, "tasks", "x.json")));
    });

    it("gates every request but settings while the folder changes", async () => {
        router.register(MSG.TASK_UPDATE, async () => "updated");
        router.setGuard((type, run) => (isUngatedMessage(type) ? run() : gate.run(run)));
        expect(await gate.close(1_000)).toBe(true);

        await expectRejects(router.handle(MSG.TASK_UPDATE, {}), "changing its data folder");
        expect(await router.handle(MSG.SETTINGS_GET, {})).toBeDefined();
    });

    it.skipIf(process.platform === "win32")(
        "stays committed and restarts when a source cannot be deleted after another was",
        async () => {
            await mkdir(join(oldDir, "flows", "locked"));
            await writeFile(join(oldDir, "flows", "locked", "a.json"), "{}");
            await chmod(join(oldDir, "flows", "locked"), 0o555);
            let result: DataDirInfo;
            try {
                result = await change(newDir);
            } finally {
                await chmod(join(oldDir, "flows", "locked"), 0o755);
                await chmod(join(newDir, "flows", "locked"), 0o755).catch(() => undefined);
            }

            expect(result.restarting).toBe(true);
            await expectRejects(access(join(oldDir, "projects.json")));
            expect(await readFile(join(newDir, "projects.json"), "utf-8")).toBe("ours");
            expect(await readFile(join(newDir, "flows", "locked", "a.json"), "utf-8")).toBe("{}");
            expect(await pointer()).toBe(newDir);
            expect(gate.isClosed).toBe(true);
            expect(restarts).toBe(1);
        },
    );

    it.skipIf(process.platform === "win32")(
        "keeps the old folder selected when the pointer cannot be written",
        async () => {
            await chmod(baseDir, 0o555);
            try {
                await expectRejects(change(newDir));
            } finally {
                await chmod(baseDir, 0o755);
            }

            await expectOldFolderKept();
            expect(await readdir(newDir)).toEqual([]);
        },
    );

    it("keeps the old folder selected when resetting cannot remove the pointer", async () => {
        // A pointer `rm` cannot remove without recursion.
        await mkdir(join(baseDir, "data-location.json", "stuck"), { recursive: true });

        await expectRejects(change(baseDir));

        expect(await readFile(join(oldDir, "projects.json"), "utf-8")).toBe("ours");
        expect(await readdir(baseDir)).toEqual(["data-location.json"]);
        expect(gate.isClosed).toBe(false);
        expect(restarts).toBe(0);
    });

    it("refuses without a restarter and leaves the data where it is", async () => {
        restartable = false;
        register();

        await expectRejects(change(newDir), "cannot restart");

        await expectOldFolderKept();
        await expectRejects(access(newDir));
    });

    it("asks before replacing data at the target, without closing the gate", async () => {
        await mkdir(newDir);
        await writeFile(join(newDir, "projects.json"), "theirs");

        const result = await change(newDir);

        expect(result.conflict).toBe(true);
        await expectOldFolderKept();
    });

    it("adopts data at the target behind the same gate, moves nothing and restarts", async () => {
        await mkdir(newDir);
        await writeFile(join(newDir, "projects.json"), "theirs");
        busyReason = async () => "a flow is running";

        await expectRejects(change(newDir, "adopt"), "while a flow is running");
        await expectOldFolderKept();

        busyReason = async () => null;
        const result = await change(newDir, "adopt");

        expect(result.restarting).toBe(true);
        expect(await readFile(join(newDir, "projects.json"), "utf-8")).toBe("theirs");
        expect(await readFile(join(oldDir, "projects.json"), "utf-8")).toBe("ours");
        expect(await pointer()).toBe(newDir);
        expect(gate.isClosed).toBe(true);
        expect(restarts).toBe(1);
    });
});
