import type {
    RuntimeInfo,
    AgentAvailability,
    AgentType,
    CodexModelInfo,
    CodexAccountStatus,
    CodexModelsResponse,
    CodexReasoningEffort,
    KimiModelInfo,
    OpenCodeModelInfo,
    PiModelInfo,
} from "@taskflow/shared";
import { CODEX_REASONING_EFFORTS } from "@taskflow/shared";
import { buildShellPath } from "./shell-path";

const KNOWN_RUNTIMES = ["bun", "node"] as const;

// `--version` probes run during startup and must stay fast: a hanging agent
// shim (e.g. a launcher whose backing app is not installed) never closes its
// output streams and would otherwise block backend startup indefinitely.
const VERSION_TIMEOUT_MS = 5_000;
// Model-list queries are user-triggered and may hit the network, so they get a
// far more generous cap that still guards against an indefinite hang.
const MODEL_LIST_TIMEOUT_MS = 60_000;

interface CaptureCliOptions {
    env?: Record<string, string | undefined>;
    /** Kill the process and return null if it runs longer than this. */
    timeoutMs?: number;
}

/**
 * Spawn a CLI command and capture stdout/stderr, killing the process and
 * returning null if it does not finish within `timeoutMs`. Callers pick a
 * timeout that matches how long the command is expected to run.
 */
async function captureCliOutput(
    cmd: string[],
    { env = process.env, timeoutMs = VERSION_TIMEOUT_MS }: CaptureCliOptions = {},
): Promise<{ stdout: string; stderr: string } | null> {
    const proc = Bun.spawn(cmd, {
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        env,
    });
    const read = Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
    ]).then(([stdout, stderr]) => ({ stdout, stderr }));
    const timeout = new Promise<null>((resolve) => {
        setTimeout(resolve, timeoutMs, null);
    });
    const result = await Promise.race([read, timeout]);
    if (!result) {
        proc.kill();
        return null;
    }
    await proc.exited;
    return result;
}

async function getRuntimeVersion(path: string): Promise<string> {
    try {
        const result = await captureCliOutput([path, "--version"]);
        if (!result) return "unknown";
        // Some CLIs (e.g. pi) print --version on stderr. Merge both streams.
        const version = (result.stdout.trim() || result.stderr.trim()).replace(/^v/, "");
        return version || "unknown";
    } catch {
        return "unknown";
    }
}

export async function detectRuntimes(): Promise<RuntimeInfo[]> {
    const runtimes: RuntimeInfo[] = [];

    const PATH = buildShellPath();
    for (const name of KNOWN_RUNTIMES) {
        const path = Bun.which(name, { PATH });
        if (!path) continue;
        const version = await getRuntimeVersion(path);
        runtimes.push({ name, path, version });
    }

    return runtimes;
}

const KNOWN_AGENTS: AgentType[] = ["claude", "codex", "opencode", "pi", "kimi"];

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCodexReasoningEffort(value: unknown): value is CodexReasoningEffort {
    return (
        typeof value === "string" && (CODEX_REASONING_EFFORTS as readonly string[]).includes(value)
    );
}

function normalizeCodexModels(data: unknown[]): CodexModelInfo[] {
    return data.flatMap((entry): CodexModelInfo[] => {
        if (!isRecord(entry)) return [];
        const id = typeof entry.id === "string" ? entry.id : "";
        if (!id) return [];

        const supportedReasoningEfforts = Array.isArray(entry.supportedReasoningEfforts)
            ? entry.supportedReasoningEfforts.flatMap((effort) => {
                  if (!isRecord(effort) || !isCodexReasoningEffort(effort.reasoningEffort)) {
                      return [];
                  }
                  return [
                      {
                          reasoningEffort: effort.reasoningEffort,
                          description:
                              typeof effort.description === "string" ? effort.description : "",
                      },
                  ];
              })
            : [];
        const defaultReasoningEffort = isCodexReasoningEffort(entry.defaultReasoningEffort)
            ? entry.defaultReasoningEffort
            : (supportedReasoningEfforts[0]?.reasoningEffort ?? "medium");

        return [
            {
                id,
                model: typeof entry.model === "string" ? entry.model : id,
                displayName: typeof entry.displayName === "string" ? entry.displayName : id,
                description: typeof entry.description === "string" ? entry.description : "",
                hidden: entry.hidden === true,
                supportedReasoningEfforts,
                defaultReasoningEffort,
                inputModalities: Array.isArray(entry.inputModalities)
                    ? entry.inputModalities.filter(
                          (modality): modality is string => typeof modality === "string",
                      )
                    : [],
                isDefault: entry.isDefault === true,
            },
        ];
    });
}

export function parseCodexAppServerOutput(output: string): CodexModelInfo[] {
    for (const line of output.split("\n")) {
        let message: unknown;
        try {
            message = JSON.parse(line);
        } catch {
            continue;
        }
        if (!isRecord(message) || message.id !== 2 || !isRecord(message.result)) continue;
        return Array.isArray(message.result.data) ? normalizeCodexModels(message.result.data) : [];
    }
    return [];
}

interface ProbeProcess {
    stdout: ReadableStream<Uint8Array>;
    stderr: ReadableStream<Uint8Array>;
    write(line: string): Promise<void>;
    end(): Promise<void>;
    exited: Promise<number>;
    kill(): void;
}

interface ProbeDeps {
    now?: () => number;
    resolveCli?: (name: string, path: string) => string | null;
    spawn?: (
        argv: string[],
        options: {
            env: Record<string, string | undefined>;
            cwd?: string;
        },
    ) => ProbeProcess;
    schedule?: (callback: () => void, delayMs: number) => () => void;
}

function spawnProbe(
    argv: string[],
    options: { env: Record<string, string | undefined>; cwd?: string },
): ProbeProcess {
    const child = Bun.spawn(argv, { ...options, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    return {
        stdout: child.stdout,
        stderr: child.stderr,
        async write(line) {
            await child.stdin.write(line);
            await child.stdin.flush();
        },
        async end() {
            await child.stdin.end();
        },
        exited: child.exited,
        kill() {
            child.kill();
        },
    };
}

function scheduleProbeDeadline(callback: () => void, delayMs: number): () => void {
    const timer = setTimeout(callback, delayMs);
    return () => clearTimeout(timer);
}

/** One byte transport and deadline for the entire short-lived CLI exchange. */
async function withProbeProcess<T>(
    argv: string[],
    options: { env: Record<string, string | undefined>; cwd?: string },
    deps: ProbeDeps,
    exchange: (transport: {
        send(message: unknown): Promise<void>;
        receive(
            matches: (message: Record<string, unknown>) => boolean,
        ): Promise<Record<string, unknown>>;
    }) => Promise<T>,
): Promise<T> {
    const child = (deps.spawn ?? spawnProbe)(argv, options);
    const reader = child.stdout.getReader();
    const stderr = child.stderr.getReader();
    const decoder = new TextDecoder();
    let buffered = "";
    let stopped = false;
    let cancelDeadline: (() => void) | undefined;
    // Consume diagnostics without retaining or exposing credentials printed by the CLI.
    void (async () => {
        while (!(await stderr.read()).done) {
            /* drain */
        }
    })().catch(() => {});
    const transport = {
        async send(message: unknown) {
            if (stopped) throw new Error("Probe closed");
            await child.write(`${JSON.stringify(message)}\n`);
        },
        async receive(matches: (message: Record<string, unknown>) => boolean) {
            while (!stopped) {
                const newline = buffered.indexOf("\n");
                if (newline >= 0) {
                    const line = buffered.slice(0, newline);
                    buffered = buffered.slice(newline + 1);
                    let message: unknown;
                    try {
                        message = JSON.parse(line);
                    } catch {
                        continue;
                    }
                    if (isRecord(message) && matches(message)) return message;
                    continue;
                }
                const chunk = await reader.read();
                if (chunk.done) throw new Error("Probe output closed");
                buffered += decoder.decode(chunk.value, { stream: true });
            }
            throw new Error("Probe closed");
        },
    };
    try {
        const deadline = new Promise<never>((_, reject) => {
            cancelDeadline = (deps.schedule ?? scheduleProbeDeadline)(
                () => reject(new Error("Probe timed out")),
                MODEL_LIST_TIMEOUT_MS,
            );
        });
        return await Promise.race([exchange(transport), deadline]);
    } finally {
        stopped = true;
        cancelDeadline?.();
        // None of these operations may delay returning after the deadline. In
        // particular a broken launcher may never resolve stdin.end or exited.
        try {
            void child.end().catch(() => {});
        } catch {
            /* already closed */
        }
        try {
            child.kill();
        } catch {
            /* already exited */
        }
        void reader
            .cancel()
            .catch(() => {})
            .finally(() => reader.releaseLock());
        void stderr
            .cancel()
            .catch(() => {})
            .finally(() => stderr.releaseLock());
        void child.exited.catch(() => {});
    }
}

function codexAccountStatus(result: unknown): CodexAccountStatus {
    if (!isRecord(result)) return { state: "unknown" };
    if (result.account === null) return { state: "signed-out" };
    if (!isRecord(result.account)) return { state: "unknown" };
    switch (result.account.type) {
        case "chatgpt":
            return {
                state: "signed-in",
                label:
                    typeof result.account.email === "string" && result.account.email.trim()
                        ? result.account.email.trim()
                        : "ChatGPT",
            };
        case "apiKey":
            return { state: "signed-in", label: "API key" };
        case "amazonBedrock":
            return { state: "signed-in", label: "Amazon Bedrock" };
        default:
            return { state: "unknown" };
    }
}

export async function fetchCodexModels(
    env?: Record<string, string | undefined>,
    deps: ProbeDeps = {},
): Promise<CodexModelsResponse> {
    let account: CodexAccountStatus = { state: "unknown" };
    try {
        const probeEnv = env ?? { ...process.env, PATH: buildShellPath() };
        const codexPath = (deps.resolveCli ?? ((name, PATH) => Bun.which(name, { PATH })))(
            "codex",
            probeEnv.PATH ?? "",
        );
        if (!codexPath) return { models: [], account };
        const models = await withProbeProcess(
            [codexPath, "app-server", "--listen", "stdio://"],
            { env: probeEnv },
            deps,
            async ({ send, receive }) => {
                let nextId = 1;
                const request = async (method: string, params: Record<string, unknown>) => {
                    const id = nextId++;
                    await send({ method, id, params });
                    const response = await receive((message) => message.id === id);
                    if ("error" in response || !("result" in response))
                        throw new Error("Codex request failed");
                    return response.result;
                };
                await request("initialize", {
                    clientInfo: { name: "taskflow", title: "Taskflow", version: "1" },
                });
                await send({ method: "initialized", params: {} });
                try {
                    account = codexAccountStatus(await request("account/read", {}));
                } catch {
                    /* An unavailable diagnostic does not prevent model discovery. */
                }
                const models = new Map<string, CodexModelInfo>();
                const cursors = new Set<string>();
                let cursor: string | undefined;
                do {
                    const page = await request("model/list", cursor ? { cursor } : {});
                    if (!isRecord(page) || !Array.isArray(page.data))
                        throw new Error("Invalid Codex model page");
                    for (const model of normalizeCodexModels(page.data)) {
                        if (!models.has(model.id)) models.set(model.id, model);
                    }
                    if (page.nextCursor == null || page.nextCursor === "") break;
                    if (typeof page.nextCursor !== "string" || cursors.has(page.nextCursor)) {
                        throw new Error("Invalid Codex model cursor");
                    }
                    cursor = page.nextCursor;
                    cursors.add(cursor);
                } while (cursor);
                return [...models.values()].filter((model) => !model.hidden);
            },
        );
        return { models, account };
    } catch {
        return { models: [], account };
    }
}

export async function detectAgents(): Promise<AgentAvailability[]> {
    const PATH = buildShellPath();
    // Probe agents concurrently so total detection time is bounded by the
    // slowest single agent (capped by captureCliOutput) rather than their sum.
    return Promise.all(
        KNOWN_AGENTS.map(async (type): Promise<AgentAvailability> => {
            const path = Bun.which(type, { PATH });
            if (!path) {
                return { type, available: false, path: "", version: "" };
            }
            const version = await getRuntimeVersion(path);
            return {
                type,
                available: true,
                path,
                version: version === "unknown" ? "" : version,
            };
        }),
    );
}

async function runCliCommand(command: string, args: string[]): Promise<string> {
    const PATH = buildShellPath();
    const resolved = Bun.which(command, { PATH });
    if (!resolved) return "";
    try {
        const result = await captureCliOutput([resolved, ...args], {
            env: { ...process.env, PATH },
            timeoutMs: MODEL_LIST_TIMEOUT_MS,
        });
        if (!result) return "";
        // Some CLIs (e.g. pi) print informational output like --list-models on
        // stderr. Prefer stdout when present, fall back to stderr.
        return result.stdout.trim() || result.stderr.trim();
    } catch {
        return "";
    }
}

export async function fetchOpenCodeModels(): Promise<OpenCodeModelInfo[]> {
    const output = await runCliCommand("opencode", ["models"]);
    if (!output) return [];
    return output
        .split("\n")
        .filter((line) => line.includes("/"))
        .map((line) => {
            const id = line.trim();
            const provider = id.split("/")[0];
            return { id, provider };
        });
}

export function parsePiModelsOutput(output: string): PiModelInfo[] {
    const lines = output
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
    if (lines.length < 2) return [];
    // Skip the header row: "provider  model  context  max-out  thinking  images".
    return lines
        .slice(1)
        .map((line) => {
            const cols = line.split(/\s{2,}/);
            const [provider, id, contextWindow, maxOutput, thinking, images] = cols;
            return {
                provider: provider ?? "",
                id: id ?? "",
                contextWindow: contextWindow ?? "",
                maxOutput: maxOutput ?? "",
                supportsThinking: thinking === "yes",
                supportsImages: images === "yes",
            };
        })
        .filter((m) => m.provider && m.id);
}

export async function fetchPiModels(): Promise<PiModelInfo[]> {
    const output = await runCliCommand("pi", ["--list-models"]);
    return parsePiModelsOutput(output);
}

export function parseKimiModelsOutput(output: string): KimiModelInfo[] {
    let parsed: unknown;
    try {
        parsed = JSON.parse(output);
    } catch {
        return [];
    }
    if (typeof parsed !== "object" || parsed === null) return [];
    const models = (parsed as { models?: unknown }).models;
    if (typeof models !== "object" || models === null || Array.isArray(models)) return [];
    return Object.entries(models as Record<string, unknown>).map(([id, value]) => {
        const entry =
            typeof value === "object" && value !== null
                ? (value as { displayName?: unknown; model?: unknown; maxContextSize?: unknown })
                : {};
        const displayName =
            typeof entry.displayName === "string" && entry.displayName
                ? entry.displayName
                : typeof entry.model === "string" && entry.model
                  ? entry.model
                  : id;
        const contextWindow =
            typeof entry.maxContextSize === "number" && entry.maxContextSize > 0
                ? `${Math.round(entry.maxContextSize / 1024)}K`
                : "";
        return { id, displayName, contextWindow };
    });
}

export async function fetchKimiModels(): Promise<KimiModelInfo[]> {
    const output = await runCliCommand("kimi", ["provider", "list", "--json"]);
    if (!output) return [];
    return parseKimiModelsOutput(output);
}
