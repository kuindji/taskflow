import { randomUUID } from "crypto";
import { readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import {
    ANTIGRAVITY_EFFORT_LEVELS,
    CLAUDE_EFFORT_LEVELS,
    CODEX_REASONING_EFFORTS,
} from "@taskflow/shared";
import type { AgentLaunchOptions, AgentType } from "@taskflow/shared";
import { normalizePiLaunchOptions } from "./pi-options";
import type { fetchPiModels } from "./runtime-detector";
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
 * `-p`, so it takes the prompt as that option's value. Every other agent reads
 * it from stdin; Pi must, because it parses positional arguments as options
 * ("-…") and file attachments ("@…").
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
            return { command: "pi", args, stdin: prompt };
        }
        case "kimi": {
            const args = ["-p", prompt];
            if (options?.type === "kimi" && options.model) args.push("-m", options.model);
            return { command: "kimi", args };
        }
        case "antigravity": {
            const args = [
                "--input-format",
                "stream-json",
                "--output-format",
                "stream-json",
                "--disable-slash-commands",
            ];
            if (options?.type === "antigravity") {
                if (options.model) args.push("--model", options.model);
                if (
                    options.effort &&
                    (ANTIGRAVITY_EFFORT_LEVELS as readonly string[]).includes(options.effort)
                )
                    args.push("--effort", options.effort);
            }
            return {
                command: "agy",
                args,
                stdin: `${JSON.stringify({ event: "user", message: { content: prompt } })}\n`,
            };
        }
        default:
            // Compile-time unreachable; persisted data can still smuggle removed agent types.
            throw new Error(`Unsupported agent type: ${String(type)}`);
    }
}

function parseAntigravityStreamOutput(stdout: string): {
    response: string;
    error?: string;
} {
    let resultResponse: string | undefined;
    let resultError: string | undefined;
    let deltaText = "";
    for (const rawLine of stdout.split("\n")) {
        const line = rawLine.trim();
        if (!line) continue;
        let parsed: unknown;
        try {
            parsed = JSON.parse(line);
        } catch {
            continue;
        }
        if (typeof parsed !== "object" || parsed === null) continue;
        const record = parsed as Record<string, unknown>;
        if (
            record.event === "result" &&
            typeof record.result === "object" &&
            record.result !== null
        ) {
            const result = record.result as Record<string, unknown>;
            if (result.status === "ERROR") {
                resultError =
                    typeof result.error === "string" && result.error.trim()
                        ? result.error.trim()
                        : "Antigravity returned an error";
            }
            if (typeof result.response === "string") {
                resultResponse = result.response;
            }
        } else if (
            record.event === "step_update" &&
            typeof record.step_update === "object" &&
            record.step_update !== null
        ) {
            const update = record.step_update as Record<string, unknown>;
            if (update.step_type === "agent_response" && typeof update.text_delta === "string") {
                deltaText += update.text_delta;
            }
        }
    }
    return {
        response: (resultResponse ?? deltaText).trim(),
        ...(resultError ? { error: resultError } : {}),
    };
}

/** Run an agent one-shot and return its trimmed answer. Throws on failure, timeout or empty output. */
async function runHeadlessAgent(
    request: HeadlessRunRequest,
    deps: {
        discoverPiModels?: typeof fetchPiModels;
        spawn?: typeof Bun.spawn;
    } = {},
): Promise<string> {
    const outputFile =
        request.type === "codex"
            ? join(tmpdir(), `taskflow-headless-${randomUUID()}.txt`)
            : undefined;
    try {
        const options =
            request.type === "pi" && request.options?.type === "pi"
                ? await normalizePiLaunchOptions(
                      request.options,
                      { env: request.env, cwd: request.cwd },
                      deps.discoverPiModels,
                  )
                : request.options;
        const { command, args, stdin } = buildHeadlessCommand(
            request.type,
            options,
            request.prompt,
            outputFile,
        );
        const proc = (deps.spawn ?? Bun.spawn)([command, ...args], {
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
        const antigravityStream =
            request.type === "antigravity" ? parseAntigravityStreamOutput(stdout) : null;
        if (exitCode !== 0) {
            const detail = (stderr.trim() || antigravityStream?.error || "").slice(0, 500);
            throw new Error(
                `${command} exited with code ${exitCode}${detail ? `: ${detail}` : ""}`,
            );
        }
        if (antigravityStream?.error) {
            throw new Error(`${command}: ${antigravityStream.error.slice(0, 500)}`);
        }
        const output = (
            outputFile
                ? await readFile(outputFile, "utf-8")
                : antigravityStream
                  ? antigravityStream.response
                  : stdout
        ).trim();
        if (!output) throw new Error(`${command} returned no output`);
        return output;
    } finally {
        if (outputFile) await rm(outputFile, { force: true });
    }
}

export { buildHeadlessCommand, runHeadlessAgent };
