import { afterEach, beforeEach, expect, it } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { BUILTIN_ACTION_DEFAULTS } from "@taskflow/shared";
import type { BuiltinActionDefinition, BuiltinActionId, Project } from "@taskflow/shared";
import { SettingsStore } from "../../src/services/settings-store";
import { createBuiltinActionRunner } from "../../src/services/builtin-action-runner";
import { expectRejects } from "../expect-rejects";

function closedStream(text = ""): ReadableStream<Uint8Array> {
    const bytes = new TextEncoder().encode(text);
    return new ReadableStream({
        start(controller) {
            if (bytes.length > 0) controller.enqueue(bytes);
            controller.close();
        },
    });
}

interface Call {
    cmd: string[];
    options: { cwd?: string; env?: Record<string, string | undefined> };
    stdin: string;
}

let tempDir: string;
let settingsStore: SettingsStore;
let originalSpawn: typeof Bun.spawn;
let calls: Call[];

beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "taskflow-runner-test-"));
    settingsStore = new SettingsStore(join(tempDir, "settings.json"));
    originalSpawn = Bun.spawn;
    calls = [];
    Bun.spawn = ((cmd: string[], options: Call["options"]) => {
        const call: Call = { cmd, options, stdin: "" };
        calls.push(call);
        const o = cmd.indexOf("-o");
        if (o >= 0) writeFileSync(cmd[o + 1], "Codex answer");
        return {
            stdin: {
                write(chunk: string) {
                    call.stdin += chunk;
                },
                end() {},
            },
            stdout: closedStream("Claude answer\n"),
            stderr: closedStream(),
            exited: Promise.resolve(0),
            kill() {},
        };
    }) as unknown as typeof Bun.spawn;
});

afterEach(async () => {
    Bun.spawn = originalSpawn;
    await rm(tempDir, { recursive: true, force: true });
});

function actionsReturning(def: BuiltinActionDefinition) {
    return { get: async (_id: BuiltinActionId) => def };
}

const project = { id: "p", agentAccounts: { claude: "c-work" } } as unknown as Project;

it("runs the default title built-in exactly as before: claude -p --model haiku", async () => {
    await settingsStore.update({
        claude: { accounts: [{ id: "c-work", name: "work", homeDir: "/homes/claude-work" }] },
    });
    const runner = createBuiltinActionRunner({
        builtinActions: actionsReturning({
            ...BUILTIN_ACTION_DEFAULTS["builtin:task-title"],
            isModified: false,
        }),
        settingsStore,
    });

    const out = await runner.runHeadless(
        "builtin:task-title",
        { description: "Fix login" },
        { project },
    );

    expect(out).toBe("Claude answer");
    expect(calls[0].cmd).toEqual(["claude", "-p", "--model", "haiku"]);
    expect(calls[0].stdin).toBe(
        "Generate a concise task title (3-7 words) for this task description. Output ONLY the title, nothing else. No quotes, no punctuation at the end.\n\nDescription: Fix login",
    );
    expect(calls[0].options.env?.CLAUDE_CONFIG_DIR).toBe("/homes/claude-work");
});

it("runs an overridden built-in on Codex with its prompt, model and cwd", async () => {
    const runner = createBuiltinActionRunner({
        builtinActions: actionsReturning({
            ...BUILTIN_ACTION_DEFAULTS["builtin:commit-message"],
            prompt: "Msg for {{diff}}",
            sessionType: "codex",
            agentOptions: { type: "codex", model: "gpt-5.6-luna" },
            isModified: true,
        }),
        settingsStore,
    });

    const out = await runner.runHeadless(
        "builtin:commit-message",
        { diff: "D" },
        { cwd: "/repo", project: null },
    );

    expect(out).toBe("Codex answer");
    expect(calls[0].cmd[0]).toBe("codex");
    expect(calls[0].cmd).toContain("gpt-5.6-luna");
    expect(calls[0].stdin).toBe("Msg for D");
    expect(calls[0].options.cwd).toBe("/repo");
});

it("refuses a headless run for a built-in without an agent", async () => {
    const runner = createBuiltinActionRunner({
        builtinActions: actionsReturning({
            ...BUILTIN_ACTION_DEFAULTS["builtin:task-title"],
            sessionType: undefined,
            isModified: true,
        }),
        settingsStore,
    });
    await expectRejects(
        runner.runHeadless("builtin:task-title", { description: "d" }, { project: null }),
        /no agent/,
    );
    expect(calls).toHaveLength(0);
});
