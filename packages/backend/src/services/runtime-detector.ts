import type {
    RuntimeInfo,
    AgentAvailability,
    AgentType,
    CodexModelInfo,
    CodexReasoningEffort,
    CursorModel,
    KimiModelInfo,
    OpenCodeModelInfo,
    PiModelInfo,
} from "@taskflow/shared";
import { CODEX_REASONING_EFFORTS } from "@taskflow/shared";
import { buildShellPath } from "./shell-path";

const KNOWN_RUNTIMES = ["bun", "node"] as const;

// `--version` probes run during startup and must stay fast: a hanging agent
// shim (e.g. a `cursor` CLI with no IDE installed) never closes its output
// streams and would otherwise block backend startup indefinitely.
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

const KNOWN_AGENTS: AgentType[] = ["claude", "codex", "opencode", "gemini", "cursor", "pi", "kimi"];

// Strip ANSI escape codes from terminal output
function stripAnsi(str: string): string {
    const ESC = String.fromCharCode(0x1b);
    return str.replace(new RegExp(ESC + "\\[[0-?]*[ -/]*[@-~]", "g"), "");
}

export async function fetchCursorModels(): Promise<CursorModel[]> {
    const PATH = buildShellPath();
    const cursorPath = Bun.which("cursor", { PATH });
    if (!cursorPath) return [];

    try {
        const result = await captureCliOutput([cursorPath, "agent", "--list-models"], {
            env: { ...process.env, PATH },
            timeoutMs: MODEL_LIST_TIMEOUT_MS,
        });
        if (!result) return [];

        const models: CursorModel[] = [];
        for (const raw of stripAnsi(result.stdout).split("\n")) {
            const line = raw.trim();
            const match = line.match(/^(\S+)\s+-\s+(.+)$/);
            if (match) {
                models.push({ id: match[1], label: match[2].trim() });
            }
        }
        return models;
    } catch {
        return [];
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function isCodexReasoningEffort(value: unknown): value is CodexReasoningEffort {
    return (
        typeof value === "string" && (CODEX_REASONING_EFFORTS as readonly string[]).includes(value)
    );
}

export function parseCodexAppServerOutput(output: string): CodexModelInfo[] {
    for (const line of output.split("\n")) {
        if (!line.trim()) continue;

        let message: unknown;
        try {
            message = JSON.parse(line);
        } catch {
            continue;
        }
        if (!isRecord(message) || message.id !== 2 || !isRecord(message.result)) continue;

        const data = message.result.data;
        if (!Array.isArray(data)) return [];

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
    return [];
}

export async function fetchCodexModels(): Promise<CodexModelInfo[]> {
    const PATH = buildShellPath();
    const codexPath = Bun.which("codex", { PATH });
    if (!codexPath) return [];

    try {
        const proc = Bun.spawn([codexPath, "app-server", "--listen", "stdio://"], {
            stdin: "pipe",
            stdout: "pipe",
            stderr: "pipe",
            env: { ...process.env, PATH },
        });
        const reader = proc.stdout.getReader();
        const decoder = new TextDecoder();
        let buffered = "";
        const readResponseLine = async (id: number): Promise<string | null> => {
            while (true) {
                const newlineIndex = buffered.indexOf("\n");
                if (newlineIndex >= 0) {
                    const line = buffered.slice(0, newlineIndex);
                    buffered = buffered.slice(newlineIndex + 1);
                    try {
                        const message: unknown = JSON.parse(line);
                        if (isRecord(message) && message.id === id) return line;
                    } catch {
                        // Ignore non-protocol output and keep reading.
                    }
                    continue;
                }

                const chunk = await reader.read();
                if (chunk.done) return null;
                buffered += decoder.decode(chunk.value, { stream: true });
            }
        };
        const exchange = async (): Promise<string> => {
            await proc.stdin.write(
                `${JSON.stringify({
                    method: "initialize",
                    id: 1,
                    params: {
                        clientInfo: {
                            name: "taskflow",
                            title: "Taskflow",
                            version: "1",
                        },
                    },
                })}\n`,
            );
            if (!(await readResponseLine(1))) return "";

            await proc.stdin.write(`${JSON.stringify({ method: "initialized", params: {} })}\n`);
            await proc.stdin.write(
                `${JSON.stringify({ method: "model/list", id: 2, params: {} })}\n`,
            );
            return (await readResponseLine(2)) ?? "";
        };
        const stderrRead = new Response(proc.stderr).text();
        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<null>((resolve) => {
            timeoutId = setTimeout(resolve, MODEL_LIST_TIMEOUT_MS, null);
        });
        let output: string | null;
        try {
            output = await Promise.race([exchange(), timeout]);
        } finally {
            if (timeoutId) clearTimeout(timeoutId);
        }
        if (output === null) {
            proc.kill();
            return [];
        }
        await proc.stdin.end();
        proc.kill();
        await proc.exited;
        await stderrRead;
        return parseCodexAppServerOutput(output).filter((model) => !model.hidden);
    } catch {
        return [];
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
