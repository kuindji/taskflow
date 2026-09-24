import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, writeFileSync } from "fs";
import { buildHeadlessCommand, runHeadlessAgent } from "../../src/services/headless-agent";
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

interface SpawnCall {
    cmd: string[];
    options: { cwd?: string; env?: Record<string, string | undefined> };
    stdin: string;
}

let originalSpawn: typeof Bun.spawn;
let calls: SpawnCall[];

function stubSpawn(respond: (call: SpawnCall) => { stdout?: string; exitCode?: number }): void {
    Bun.spawn = ((cmd: string[], options: SpawnCall["options"]) => {
        const call: SpawnCall = { cmd, options, stdin: "" };
        calls.push(call);
        const result = respond(call);
        return {
            stdin: {
                write(chunk: string) {
                    call.stdin += chunk;
                },
                end() {},
            },
            stdout: closedStream(result.stdout ?? ""),
            stderr: closedStream(),
            exited: Promise.resolve(result.exitCode ?? 0),
            kill() {},
        };
    }) as unknown as typeof Bun.spawn;
}

beforeEach(() => {
    originalSpawn = Bun.spawn;
    calls = [];
});

afterEach(() => {
    Bun.spawn = originalSpawn;
});

describe("buildHeadlessCommand", () => {
    it("claude: -p with model and effort, prompt on stdin, session-only options ignored", () => {
        expect(
            buildHeadlessCommand(
                "claude",
                {
                    type: "claude",
                    model: "haiku",
                    effort: "low",
                    permissionMode: "bypassPermissions",
                },
                "P",
            ),
        ).toEqual({
            command: "claude",
            args: ["-p", "--model", "haiku", "--effort", "low"],
            stdin: "P",
        });
    });

    it("claude: no options means plain -p", () => {
        expect(buildHeadlessCommand("claude", undefined, "P")).toEqual({
            command: "claude",
            args: ["-p"],
            stdin: "P",
        });
    });

    it("codex: exec, read-only, ephemeral, output file, stdin prompt", () => {
        expect(
            buildHeadlessCommand(
                "codex",
                {
                    type: "codex",
                    model: "gpt-5.6-luna",
                    reasoningEffort: "low",
                    sandbox: "danger-full-access",
                    dangerouslyBypassApprovalsAndSandbox: true,
                },
                "P",
                "/tmp/out.txt",
            ),
        ).toEqual({
            command: "codex",
            args: [
                "exec",
                "--ephemeral",
                "--skip-git-repo-check",
                "-s",
                "read-only",
                "-m",
                "gpt-5.6-luna",
                "-c",
                'model_reasoning_effort="low"',
                "-o",
                "/tmp/out.txt",
                "-",
            ],
            stdin: "P",
        });
    });

    it("codex: skips the literal default model and requires an output file", () => {
        expect(
            buildHeadlessCommand("codex", { type: "codex", model: "default" }, "P", "/o").args,
        ).not.toContain("-m");
        expect(() => buildHeadlessCommand("codex", undefined, "P")).toThrow(/output file/);
    });

    it("opencode: run with model, prompt on stdin, auto-approve ignored", () => {
        expect(
            buildHeadlessCommand(
                "opencode",
                { type: "opencode", model: "openrouter/x", autoApprove: true },
                "P",
            ),
        ).toEqual({ command: "opencode", args: ["run", "-m", "openrouter/x"], stdin: "P" });
    });

    it("pi: -p --no-session, model and thinking, prompt on stdin, tools ignored", () => {
        expect(
            buildHeadlessCommand(
                "pi",
                { type: "pi", model: "openai/gpt", thinking: "high", tools: "bash" },
                "P",
            ),
        ).toEqual({
            command: "pi",
            args: ["-p", "--no-session", "--model", "openai/gpt", "--thinking", "high"],
            stdin: "P",
        });
        expect(buildHeadlessCommand("pi", { type: "pi", thinking: "off" }, "P").args).not.toContain(
            "--thinking",
        );
    });

    // Pi parses every argument: a prompt starting with "-" is an unknown option,
    // and one starting with "@" names a file to attach.
    it("pi: never passes the prompt as an argument", () => {
        for (const prompt of ["- Title for: x", "@/etc/hosts"]) {
            const command = buildHeadlessCommand("pi", undefined, prompt);
            expect(command.args).not.toContain(prompt);
            expect(command.stdin).toBe(prompt);
        }
    });

    it("kimi: -p prompt as argument with model, permission mode ignored", () => {
        expect(
            buildHeadlessCommand(
                "kimi",
                { type: "kimi", model: "kimi-code/k3", permissionMode: "yolo" },
                "P",
            ),
        ).toEqual({ command: "kimi", args: ["-p", "P", "-m", "kimi-code/k3"] });
    });

    it("ignores options that belong to another agent", () => {
        expect(buildHeadlessCommand("claude", { type: "codex", model: "x" }, "P").args).toEqual([
            "-p",
        ]);
    });
});

describe("runHeadlessAgent", () => {
    it("writes the prompt to stdin and returns trimmed stdout", async () => {
        stubSpawn(() => ({ stdout: "  Title here \n" }));
        const out = await runHeadlessAgent({
            type: "claude",
            prompt: "P",
            cwd: "/repo",
            env: { A: "1" },
        });
        expect(out).toBe("Title here");
        expect(calls[0].cmd).toEqual(["claude", "-p"]);
        expect(calls[0].stdin).toBe("P");
        expect(calls[0].options.cwd).toBe("/repo");
        expect(calls[0].options.env).toEqual({ A: "1" });
    });

    it("does not write argument-delivered prompts to stdin", async () => {
        stubSpawn(() => ({ stdout: "ok" }));
        await runHeadlessAgent({ type: "kimi", prompt: "P", env: {} });
        expect(calls[0].stdin).toBe("");
    });

    it("throws on a non-zero exit and on empty output", async () => {
        stubSpawn(() => ({ stdout: "x", exitCode: 1 }));
        await expectRejects(
            runHeadlessAgent({ type: "claude", prompt: "P", env: {} }),
            /exited with code 1/,
        );
        stubSpawn(() => ({ stdout: "   \n" }));
        await expectRejects(
            runHeadlessAgent({ type: "claude", prompt: "P", env: {} }),
            /no output/,
        );
    });

    it("codex: reads the output file, not stdout, and removes it", async () => {
        let outputFile = "";
        stubSpawn((call) => {
            outputFile = call.cmd[call.cmd.indexOf("-o") + 1];
            writeFileSync(outputFile, "Luna title\n");
            return { stdout: "progress noise" };
        });
        const out = await runHeadlessAgent({ type: "codex", prompt: "P", env: {} });
        expect(out).toBe("Luna title");
        expect(existsSync(outputFile)).toBe(false);
    });

    it("codex: removes the output file when the run fails", async () => {
        let outputFile = "";
        stubSpawn((call) => {
            outputFile = call.cmd[call.cmd.indexOf("-o") + 1];
            writeFileSync(outputFile, "partial");
            return { exitCode: 2 };
        });
        await expectRejects(runHeadlessAgent({ type: "codex", prompt: "P", env: {} }));
        expect(existsSync(outputFile)).toBe(false);
    });

    // A hung CLI whose child process inherited the pipes: kill() stops the CLI,
    // but stdout, stderr and the exit promise never settle. The runner must
    // still give up on time.
    function stubHungSpawn(onSpawn?: (cmd: string[]) => void): { killed: boolean } {
        const state = { killed: false };
        Bun.spawn = ((cmd: string[]) => {
            onSpawn?.(cmd);
            return {
                stdin: { write() {}, end() {} },
                stdout: new ReadableStream(),
                stderr: new ReadableStream(),
                exited: new Promise<number>(() => {}),
                kill() {
                    state.killed = true;
                },
            };
        }) as unknown as typeof Bun.spawn;
        return state;
    }

    it("gives up on a run that exceeds the timeout, even when its pipes stay open", async () => {
        const state = stubHungSpawn();
        await expectRejects(
            runHeadlessAgent({ type: "claude", prompt: "P", env: {}, timeoutMs: 20 }),
            /timed out/,
        );
        expect(state.killed).toBe(true);
    });

    it("codex: removes the output file when the run times out", async () => {
        let outputFile = "";
        stubHungSpawn((cmd) => {
            outputFile = cmd[cmd.indexOf("-o") + 1];
            writeFileSync(outputFile, "partial");
        });
        await expectRejects(
            runHeadlessAgent({ type: "codex", prompt: "P", env: {}, timeoutMs: 20 }),
            /timed out/,
        );
        expect(existsSync(outputFile)).toBe(false);
    });
});
