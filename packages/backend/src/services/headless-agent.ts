import { randomUUID } from "crypto";
import { readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { CLAUDE_EFFORT_LEVELS, CODEX_REASONING_EFFORTS } from "@taskflow/shared";
import type { AgentLaunchOptions, AgentType } from "@taskflow/shared";
import { escapeTomlBasicString } from "./internal-agent-skill";

const DEFAULT_HEADLESS_TIMEOUT_MS = 120_000;

interface HeadlessCommand {
    command: string;
    args: string[];
    /** Prompt to write to stdin; undefined when the prompt travels in args. */
    stdin?: string;
}

interface HeadlessRunRequest {
    type: AgentType;
    options?: AgentLaunchOptions;
    prompt: string;
    cwd?: string;
    env: Record<string, string | undefined>;
    timeoutMs?: number;
}

/**
 * The one-shot command line for each agent. A headless run is read-only text
 * generation, so only model/reasoning options apply; permission, sandbox,
 * approval, auto-approve and tool options are ignored. Kimi rejects an empty
 * `-p`, and Pi's stdin handling is unverified, so both take the prompt as an argument.
 */
function buildHeadlessCommand(
    type: AgentType,
    options: AgentLaunchOptions | undefined,
    prompt: string,
    outputFile?: string,
): HeadlessCommand {
    switch (type) {
        case "claude": {
            const args = ["-p"];
            if (options?.type === "claude") {
                if (options.model) args.push("--model", options.model);
                if (
                    options.effort &&
                    (CLAUDE_EFFORT_LEVELS as readonly string[]).includes(options.effort)
                )
                    args.push("--effort", options.effort);
            }
            return { command: "claude", args, stdin: prompt };
        }
        case "codex": {
            if (!outputFile) throw new Error("A headless Codex run needs an output file");
            const args = ["exec", "--ephemeral", "--skip-git-repo-check", "-s", "read-only"];
            if (options?.type === "codex") {
                if (options.model && options.model !== "default") args.push("-m", options.model);
                if (
                    options.reasoningEffort &&
                    (CODEX_REASONING_EFFORTS as readonly string[]).includes(options.reasoningEffort)
                )
                    args.push(
                        "-c",
                        `model_reasoning_effort="${escapeTomlBasicString(options.reasoningEffort)}"`,
                    );
            }
            args.push("-o", outputFile, "-");
            return { command: "codex", args, stdin: prompt };
        }
        case "opencode": {
            const args = ["run"];
            if (options?.type === "opencode" && options.model) args.push("-m", options.model);
            return { command: "opencode", args, stdin: prompt };
        }
        case "pi": {
            const args = ["-p", "--no-session"];
            if (options?.type === "pi") {
                if (options.model) args.push("--model", options.model);
                if (options.thinking && options.thinking !== "off")
                    args.push("--thinking", options.thinking);
            }
            args.push(prompt);
            return { command: "pi", args };
        }
        case "kimi": {
            const args = ["-p", prompt];
            if (options?.type === "kimi" && options.model) args.push("-m", options.model);
            return { command: "kimi", args };
        }
        default:
            // Compile-time unreachable; persisted data can still smuggle removed agent types.
            throw new Error(`Unsupported agent type: ${String(type)}`);
    }
}

/** Run an agent one-shot and return its trimmed answer. Throws on failure, timeout or empty output. */
async function runHeadlessAgent(request: HeadlessRunRequest): Promise<string> {
    const outputFile =
        request.type === "codex"
            ? join(tmpdir(), `taskflow-headless-${randomUUID()}.txt`)
            : undefined;
    try {
        const { command, args, stdin } = buildHeadlessCommand(
            request.type,
            request.options,
            request.prompt,
            outputFile,
        );
        const proc = Bun.spawn([command, ...args], {
            cwd: request.cwd,
            env: request.env,
            stdin: "pipe",
            stdout: "pipe",
            stderr: "pipe",
        });
        if (stdin !== undefined) void proc.stdin.write(stdin);
        void proc.stdin.end();

        // Race the run against the timer, as captureCliOutput in runtime-detector.ts
        // does. Killing the CLI is not enough to end the wait: a child process that
        // inherited its pipes keeps them open, so the reads would never settle.
        const run = Promise.all([
            new Response(proc.stdout).text(),
            new Response(proc.stderr).text(),
            proc.exited,
        ]);
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<null>((resolve) => {
            timer = setTimeout(resolve, request.timeoutMs ?? DEFAULT_HEADLESS_TIMEOUT_MS, null);
        });
        let result: [string, string, number] | null;
        try {
            result = await Promise.race([run, timeout]);
        } finally {
            clearTimeout(timer);
        }
        if (!result) {
            proc.kill();
            // Abandoned, not awaited; keep a late stream error from going unhandled.
            run.catch(() => {});
            throw new Error(`${command} timed out`);
        }

        const [stdout, stderr, exitCode] = result;
        if (exitCode !== 0) {
            const detail = stderr.trim().slice(0, 500);
            throw new Error(
                `${command} exited with code ${exitCode}${detail ? `: ${detail}` : ""}`,
            );
        }
        const output = (outputFile ? await readFile(outputFile, "utf-8") : stdout).trim();
        if (!output) throw new Error(`${command} returned no output`);
        return output;
    } finally {
        if (outputFile) await rm(outputFile, { force: true });
    }
}

export { buildHeadlessCommand, runHeadlessAgent };
