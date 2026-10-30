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
    PiModelsResponse,
} from "@taskflow/shared";
import { CODEX_REASONING_EFFORTS, supportsPiXhigh } from "@taskflow/shared";
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
        output(): Promise<{ stdout: string; stderr: string }>;
        receive(
            matches: (message: Record<string, unknown>) => boolean,
        ): Promise<Record<string, unknown>>;
    }) => Promise<T>,
    {
        timeoutMs = MODEL_LIST_TIMEOUT_MS,
        signal,
        captureOutput = false,
    }: {
        timeoutMs?: number;
        signal?: AbortSignal;
        captureOutput?: boolean;
    } = {},
): Promise<T> {
    signal?.throwIfAborted();
    const child = (deps.spawn ?? spawnProbe)(argv, options);
    const reader = child.stdout.getReader();
    const stderr = child.stderr.getReader();
    const decoder = new TextDecoder();
    let buffered = "";
    let stopped = false;
    let cancelDeadline: (() => void) | undefined;
    let stderrOutput = "";
    // Retain stderr only for the legacy table fallback, never for RPC diagnostics.
    const drainStderr = (async () => {
        const decoder = new TextDecoder();
        while (true) {
            const chunk = await stderr.read();
            if (chunk.done) break;
            if (captureOutput) stderrOutput += decoder.decode(chunk.value, { stream: true });
        }
        if (captureOutput) stderrOutput += decoder.decode();
    })();
    void drainStderr.catch(() => {});
    const transport = {
        async output() {
            let stdout = "";
            while (!stopped) {
                const chunk = await reader.read();
                if (chunk.done) break;
                stdout += decoder.decode(chunk.value, { stream: true });
            }
            stdout += decoder.decode();
            await drainStderr;
            if ((await child.exited) !== 0) throw new Error("Probe failed");
            return { stdout, stderr: stderrOutput };
        },
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
    let onAbort: (() => void) | undefined;
    try {
        const deadline = new Promise<never>((_, reject) => {
            onAbort = () => reject(new Error("Probe cancelled"));
            signal?.addEventListener("abort", onAbort, { once: true });
            cancelDeadline = (deps.schedule ?? scheduleProbeDeadline)(
                () => reject(new Error("Probe timed out")),
                timeoutMs,
            );
            if (signal?.aborted) onAbort();
        });
        return await Promise.race([exchange(transport), deadline]);
    } finally {
        stopped = true;
        if (onAbort) signal?.removeEventListener("abort", onAbort);
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

function piModelKey(model: unknown): string | undefined {
    return isRecord(model) &&
        typeof model.provider === "string" &&
        model.provider &&
        typeof model.id === "string" &&
        model.id
        ? `${model.provider}/${model.id}`
        : undefined;
}

function piTokenCount(value: unknown): string {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return "";
    if (value >= 1_000_000) return `${value / 1_000_000}M`;
    if (value >= 1_000) return `${value / 1_000}K`;
    return String(value);
}

export async function fetchPiModels(
    options: { env?: Record<string, string | undefined>; cwd?: string; signal?: AbortSignal } = {},
    deps: ProbeDeps = {},
): Promise<PiModelsResponse> {
    const now = deps.now ?? Date.now;
    const deadline = now() + MODEL_LIST_TIMEOUT_MS;
    const env = options.env ?? {
        ...process.env,
        CLAUDECODE: undefined,
        CLAUDE_CODE_ENTRYPOINT: undefined,
        PATH: buildShellPath(),
    };
    const context = { env, cwd: options.cwd };
    let timedOut = false;
    const probeDeps = {
        ...deps,
        schedule: (callback: () => void, ms: number) =>
            (deps.schedule ?? scheduleProbeDeadline)(() => {
                timedOut = true;
                callback();
            }, ms),
    };
    try {
        const path = (deps.resolveCli ?? ((name, PATH) => Bun.which(name, { PATH })))(
            "pi",
            env.PATH ?? "",
        );
        if (!path || options.signal?.aborted) return { models: [] };
        try {
            return await withProbeProcess(
                [path, "--mode", "rpc", "--no-session"],
                context,
                probeDeps,
                async ({ send, receive }) => {
                    await send({ id: "taskflow-state", type: "get_state" });
                    await send({ id: "taskflow-models", type: "get_available_models" });
                    let state: Record<string, unknown> | undefined;
                    let models: Record<string, unknown> | undefined;
                    while (!state || !models) {
                        const response = await receive(
                            (message) =>
                                message.type === "response" &&
                                ((message.id === "taskflow-state" &&
                                    message.command === "get_state") ||
                                    (message.id === "taskflow-models" &&
                                        message.command === "get_available_models")),
                        );
                        if (response.id === "taskflow-state") state = response;
                        else {
                            models = response;
                            if (models.success !== true) throw new Error("Pi RPC unavailable");
                        }
                    }
                    if (!isRecord(models.data) || !Array.isArray(models.data.models))
                        throw new Error("Invalid Pi models");
                    const inventory = new Map<string, PiModelInfo>();
                    for (const raw of models.data.models) {
                        const key = piModelKey(raw);
                        if (!key || !isRecord(raw) || inventory.has(key)) continue;
                        inventory.set(key, {
                            provider: raw.provider as string,
                            id: raw.id as string,
                            contextWindow: piTokenCount(raw.contextWindow),
                            maxOutput: piTokenCount(raw.maxTokens),
                            supportsThinking: raw.reasoning === true,
                            supportsImages: Array.isArray(raw.input) && raw.input.includes("image"),
                            supportsXhigh: supportsPiXhigh(raw),
                        });
                    }
                    const defaultModel =
                        state.success === true && isRecord(state.data)
                            ? piModelKey(state.data.model)
                            : undefined;
                    return {
                        models: [...inventory.values()],
                        ...(defaultModel ? { defaultModel } : {}),
                    };
                },
                { timeoutMs: Math.max(0, deadline - now()), signal: options.signal },
            );
        } catch {
            const remaining = deadline - now();
            if (timedOut || remaining <= 0 || options.signal?.aborted) return { models: [] };
            const output = await withProbeProcess(
                [path, "--list-models"],
                context,
                probeDeps,
                ({ output }) => output(),
                { timeoutMs: remaining, signal: options.signal, captureOutput: true },
            );
            return { models: parsePiModelsOutput(output.stdout.trim() || output.stderr.trim()) };
        }
    } catch {
        return { models: [] };
    }
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
