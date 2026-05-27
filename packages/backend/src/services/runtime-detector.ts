import type {
    RuntimeInfo,
    AgentAvailability,
    AgentType,
    CursorModel,
    OpenCodeModelInfo,
    PiModelInfo,
} from "@taskflow/shared";
import { buildShellPath } from "./shell-path";

const KNOWN_RUNTIMES = ["bun", "node"] as const;

// Cap how long we wait for a CLI to report its version / model list. Some
// agent shims (e.g. a `cursor` CLI with no IDE installed) never close their
// output streams, which would otherwise hang backend startup indefinitely.
const CLI_OUTPUT_TIMEOUT_MS = 5_000;

/**
 * Spawn a CLI command and capture stdout/stderr, killing the process and
 * returning null if it does not finish within {@link CLI_OUTPUT_TIMEOUT_MS}.
 */
async function captureCliOutput(
    cmd: string[],
    env: Record<string, string | undefined> = process.env,
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
        setTimeout(resolve, CLI_OUTPUT_TIMEOUT_MS, null);
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

const KNOWN_AGENTS: AgentType[] = ["claude", "codex", "opencode", "gemini", "cursor", "pi"];

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
            ...process.env,
            PATH,
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
        const result = await captureCliOutput([resolved, ...args], { ...process.env, PATH });
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
