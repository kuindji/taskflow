import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, rm, realpath, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { MSG } from "@taskflow/shared";
import type { AgentCommandsListResponse } from "@taskflow/shared";
import { registerAgentCommandsHandlers } from "../../src/handlers/agent-commands";
import { SettingsStore } from "../../src/services/settings-store";
import { TaskStore } from "../../src/services/task-store";
import { TestRouter } from "../test-router";

describe("agent commands handler", () => {
    let tempDir: string;
    let router: TestRouter;
    let store: TaskStore;
    let settingsStore: SettingsStore;

    beforeEach(async () => {
        tempDir = await realpath(await mkdtemp(join(tmpdir(), "taskflow-agent-commands-")));
        store = new TaskStore({
            projectsFile: join(tempDir, "projects.json"),
            tasksDir: join(tempDir, "tasks"),
            archiveDir: join(tempDir, "archive"),
            sessionLogsDir: join(tempDir, "session-logs"),
            taskLogsDir: join(tempDir, "task-logs"),
        });
        await store.init();
        settingsStore = new SettingsStore(join(tempDir, "settings.json"));
        router = new TestRouter();
        registerAgentCommandsHandlers({ router, taskStore: store, settingsStore });
    });

    afterEach(async () => {
        await rm(tempDir, { recursive: true, force: true });
    });

    it("lists user commands from the project's Claude account home", async () => {
        const accountHome = join(tempDir, "claude-work");
        await mkdir(join(accountHome, "commands"), { recursive: true });
        await writeFile(join(accountHome, "commands", "ship.md"), "ship it");
        const projectDir = join(tempDir, "project");
        await mkdir(projectDir, { recursive: true });
        const project = await store.addProject({ name: "p", path: projectDir });
        await settingsStore.update({
            claude: { accounts: [{ id: "c-work", name: "work", homeDir: accountHome }] },
        });
        await store.updateProject(project.id, { agentAccounts: { claude: "c-work" } });

        const result = (await router.handle(MSG.AGENT_COMMANDS_LIST, {
            path: projectDir,
        })) as AgentCommandsListResponse;

        expect(result.commands).toContainEqual({ name: "ship", source: "user" });
    });

    it("still lists project commands when the account is unknown", async () => {
        const projectDir = join(tempDir, "project");
        await mkdir(join(projectDir, ".claude", "commands"), { recursive: true });
        await writeFile(join(projectDir, ".claude", "commands", "local.md"), "x");
        const project = await store.addProject({ name: "p", path: projectDir });
        await store.updateProject(project.id, { agentAccounts: { claude: "missing" } });

        const result = (await router.handle(MSG.AGENT_COMMANDS_LIST, {
            path: projectDir,
        })) as AgentCommandsListResponse;

        expect(result.commands).toEqual([{ name: "local", source: "project" }]);
    });
});
