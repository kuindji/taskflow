import { afterEach, beforeEach, expect, it } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { MSG } from "@taskflow/shared";
import type { AppSettings, WsEvent } from "@taskflow/shared";
import { TestRouter } from "../test-router";
import { SettingsStore } from "../../src/services/settings-store";
import { TaskStore } from "../../src/services/task-store";
import { registerSettingsHandlers } from "../../src/handlers/settings";

let tempDir: string;
let router: TestRouter;
let settingsStore: SettingsStore;
let events: WsEvent[];

beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "taskflow-settings-handlers-"));
    events = [];
    settingsStore = new SettingsStore(join(tempDir, "settings.json"));
    router = new TestRouter();
    registerSettingsHandlers({
        router,
        settingsStore,
        taskStore: new TaskStore({
            projectsFile: join(tempDir, "projects.json"),
            tasksDir: join(tempDir, "tasks"),
            archiveDir: join(tempDir, "archive"),
            sessionLogsDir: join(tempDir, "session-logs"),
            taskLogsDir: join(tempDir, "task-logs"),
        }),
        broadcast: (event) => {
            events.push(event);
        },
    });
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
