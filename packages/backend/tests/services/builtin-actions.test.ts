import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { BUILTIN_ACTION_DEFAULTS } from "@taskflow/shared";
import { FlowStore } from "../../src/services/flow-store";
import { createBuiltinActions } from "../../src/services/builtin-actions";

let tempDir: string;
let flowStore: FlowStore;

beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "taskflow-builtin-test-"));
    flowStore = new FlowStore(join(tempDir, "flows"), join(tempDir, "runs"));
    await flowStore.init();
});

afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
});

const titleOverride = {
    id: "builtin:task-title",
    prompt: "Title for: {{description}}",
    sessionType: "codex",
    agentOptions: { type: "codex", model: "gpt-5.6-luna" },
    updatedAt: "2000-01-01T00:00:00.000Z",
};

describe("builtin actions", () => {
    it("lists all four defaults, unmodified, in catalogue order", async () => {
        const list = await createBuiltinActions({ flowStore }).list();
        expect(list.map((a) => a.id)).toEqual([
            "builtin:task-title",
            "builtin:schedule-name",
            "builtin:commit-message",
            "builtin:commit",
        ]);
        expect(list.every((a) => !a.isModified)).toBe(true);
        expect(list[0].prompt).toBe(BUILTIN_ACTION_DEFAULTS["builtin:task-title"].prompt);
    });

    it("saves an override, stamps updatedAt, and merges it", async () => {
        const actions = createBuiltinActions({ flowStore });
        const saved = await actions.save(titleOverride);
        expect(saved.isModified).toBe(true);
        expect(saved.sessionType).toBe("codex");
        expect(saved.agentOptions).toEqual({ type: "codex", model: "gpt-5.6-luna" });
        expect(saved.prompt).toBe("Title for: {{description}}");
        expect(saved.updatedAt).not.toBe("2000-01-01T00:00:00.000Z");
        expect(saved.name).toBe("Generate task title");
        expect((await actions.get("builtin:task-title")).isModified).toBe(true);
    });

    it("reset removes the override", async () => {
        const actions = createBuiltinActions({ flowStore });
        await actions.save(titleOverride);
        const reset = await actions.reset("builtin:task-title");
        expect(reset.isModified).toBe(false);
        expect(reset.sessionType).toBe("claude");
        expect(reset.agentOptions).toEqual({ type: "claude", model: "haiku" });
        expect(reset.updatedAt).toBeUndefined();
    });

    it("rejects invalid overrides", async () => {
        const actions = createBuiltinActions({ flowStore });
        await expect(actions.save({ ...titleOverride, id: "builtin:nope" })).rejects.toThrow(
            /Unknown built-in action/,
        );
        await expect(actions.save({ ...titleOverride, prompt: "no placeholder" })).rejects.toThrow(
            /\{\{description\}\}/,
        );
        await expect(actions.save({ ...titleOverride, prompt: "   " })).rejects.toThrow(/empty/);
        await expect(
            actions.save({ ...titleOverride, sessionType: "shell", agentOptions: undefined }),
        ).rejects.toThrow(/agent/);
        await expect(
            actions.save({ ...titleOverride, agentOptions: { type: "claude" } }),
        ).rejects.toThrow(/options/);
        await expect(
            actions.save({ ...titleOverride, sessionType: undefined, agentOptions: undefined }),
        ).rejects.toThrow(/agent/);
    });

    it("lets the commit built-in follow the default agent", async () => {
        const saved = await createBuiltinActions({ flowStore }).save({
            id: "builtin:commit",
            prompt: "Carefully: {{instructions}}",
            updatedAt: "x",
        });
        expect(saved.sessionType).toBeUndefined();
        expect(saved.isModified).toBe(true);
    });

    it("ignores corrupt files and unusable entries", async () => {
        const file = join(tempDir, "flows", "builtin-actions.json");
        await writeFile(file, "{not json");
        expect((await createBuiltinActions({ flowStore }).list()).every((a) => !a.isModified)).toBe(
            true,
        );

        await writeFile(
            file,
            JSON.stringify([
                { ...titleOverride, sessionType: "gemini", agentOptions: undefined },
                { id: "builtin:gone", prompt: "x" },
                {
                    id: "builtin:schedule-name",
                    prompt: "missing placeholder",
                    sessionType: "claude",
                },
            ]),
        );
        const list = await createBuiltinActions({ flowStore }).list();
        expect(list.every((a) => !a.isModified)).toBe(true);
    });

    it("keeps unrelated entries when saving", async () => {
        const file = join(tempDir, "flows", "builtin-actions.json");
        await writeFile(file, JSON.stringify([{ id: "builtin:gone", prompt: "x" }]));
        await createBuiltinActions({ flowStore }).save(titleOverride);
        const stored = JSON.parse(await readFile(file, "utf-8")) as { id: string }[];
        expect(stored.map((e) => e.id)).toEqual(["builtin:gone", "builtin:task-title"]);
    });
});
