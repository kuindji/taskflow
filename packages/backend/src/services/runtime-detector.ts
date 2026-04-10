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

async function getRuntimeVersion(path: string): Promise<string> {
    try {
        const proc = Bun.spawn([path, "--version"], {
            stdout: "pipe",
            stderr: "pipe",
        });
        const output = await new Response(proc.stdout).text();
        await proc.exited;
        const version = output.trim().replace(/^v/, "");
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
        const proc = Bun.spawn([cursorPath, "agent", "--list-models"], {
            stdout: "pipe",
            stderr: "pipe",
            env: { ...process.env, PATH },
        });
        const output = await new Response(proc.stdout).text();
        await proc.exited;

        const models: CursorModel[] = [];
        for (const raw of stripAnsi(output).split("\n")) {
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
    const agents: AgentAvailability[] = [];
    const PATH = buildShellPath();
    for (const type of KNOWN_AGENTS) {
        const path = Bun.which(type, { PATH });
        if (!path) {
            agents.push({ type, available: false, path: "", version: "" });
            continue;
        }
        const version = await getRuntimeVersion(path);
        agents.push({
            type,
            available: true,
            path,
            version: version === "unknown" ? "" : version,
        });
    }
    return agents;
}

async function runCliCommand(command: string, args: string[]): Promise<string> {
    const PATH = buildShellPath();
    const resolved = Bun.which(command, { PATH });
    if (!resolved) return "";
    try {
        const proc = Bun.spawn([resolved, ...args], {
            stdout: "pipe",
            stderr: "pipe",
            env: { ...process.env, PATH },
        });
        const output = await new Response(proc.stdout).text();
        await proc.exited;
        return output.trim();
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
