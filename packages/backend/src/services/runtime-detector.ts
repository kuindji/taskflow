import type { RuntimeInfo, AgentAvailability, AgentType, CursorModel } from "@taskflow/shared";
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

const KNOWN_AGENTS: AgentType[] = ["claude", "codex", "opencode", "gemini", "cursor"];

// Strip ANSI escape codes from terminal output
function stripAnsi(str: string): string {
    return str.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
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
