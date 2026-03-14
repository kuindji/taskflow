import type { RuntimeInfo, AgentAvailability, AgentType } from "@taskflow/shared";

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

    for (const name of KNOWN_RUNTIMES) {
        const path = Bun.which(name);
        if (!path) continue;
        const version = await getRuntimeVersion(path);
        runtimes.push({ name, path, version });
    }

    return runtimes;
}

const KNOWN_AGENTS: AgentType[] = ["claude", "codex"];

export async function detectAgents(): Promise<AgentAvailability[]> {
    const agents: AgentAvailability[] = [];
    for (const type of KNOWN_AGENTS) {
        const path = Bun.which(type);
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
