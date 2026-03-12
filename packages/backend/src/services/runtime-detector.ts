import type { RuntimeInfo } from "@taskflow/shared";

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
