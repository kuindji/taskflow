import { afterEach, beforeEach, expect, it } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import type { ActionDefinition, Schedule } from "@taskflow/shared";
import { SettingsStore } from "../../src/services/settings-store";
import { resolveScheduleLaunch } from "../../src/services/schedule-launch";
import { expectRejects } from "../expect-rejects";

let dir: string;
let settingsStore: SettingsStore;

beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "schedule-launch-"));
    settingsStore = new SettingsStore(join(dir, "settings.json"));
});

afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
});

function schedule(overrides: Partial<Schedule> = {}): Schedule {
    return {
        id: "s1",
        projectId: "p1",
        name: "Nightly",
        prompt: "do it",
        expression: "1h",
        expressionType: "rate",
        timeout: 0,
        enabled: true,
        lastRunAt: null,
        lastError: null,
        nextRunAt: null,
        runningSessionId: null,
        createdAt: "",
        updatedAt: "",
        ...overrides,
    };
}

function resolve(s: Schedule, actions: ActionDefinition[] = []) {
    return resolveScheduleLaunch(s, {
        getActions: async () => actions,
        getSettings: () => settingsStore.get(),
    });
}

it("runs a schedule without an agent on the Settings default agent", async () => {
    await settingsStore.update({ general: { defaultAgent: "codex" } });
    expect(await resolve(schedule())).toEqual({
        prompt: "do it",
        sessionType: "codex",
        agentOptions: undefined,
    });
});

it("keeps a schedule's own agent and options", async () => {
    await settingsStore.update({ general: { defaultAgent: "codex" } });
    const launch = await resolve(
        schedule({ agentType: "pi", agentOptions: { type: "pi", model: "m" } }),
    );
    expect(launch.sessionType).toBe("pi");
    expect(launch.agentOptions).toEqual({ type: "pi", model: "m" });
});

it("takes the prompt, agent and options from the schedule's action", async () => {
    const action: ActionDefinition = {
        id: "a1",
        name: "Review",
        prompt: "review",
        sessionType: "shell",
        createdAt: "",
        updatedAt: "",
    };
    expect(await resolve(schedule({ actionId: "a1" }), [action])).toEqual({
        prompt: "review",
        sessionType: "shell",
        agentOptions: undefined,
    });
    await expectRejects(resolve(schedule({ actionId: "gone" }), [action]), "Action not found");
});
