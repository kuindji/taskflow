import { readdir } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { MSG } from "@taskflow/shared";
import type { AgentCommand, AgentCommandsListPayload } from "@taskflow/shared";
import type { Router } from "../ws/router";

async function scanCommands(dir: string, source: AgentCommand["source"]): Promise<AgentCommand[]> {
    const commands: AgentCommand[] = [];

    async function walk(current: string, prefix: string): Promise<void> {
        let entries;
        try {
            entries = await readdir(current, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            if (entry.isDirectory()) {
                await walk(
                    join(current, entry.name),
                    prefix ? `${prefix}:${entry.name}` : entry.name,
                );
            } else if (entry.isFile() && entry.name.endsWith(".md")) {
                const baseName = entry.name.slice(0, -3);
                const name = prefix ? `${prefix}:${baseName}` : baseName;
                commands.push({ name, source });
            }
        }
    }

    await walk(dir, "");
    return commands;
}

export function registerAgentCommandsHandlers(router: Router): void {
    router.register(MSG.AGENT_COMMANDS_LIST, async (payload) => {
        const { path } = payload as AgentCommandsListPayload;
        const projectDir = join(path, ".claude", "commands");
        const userDir = join(homedir(), ".claude", "commands");

        // When projectDir and userDir are the same (e.g. master workspace where
        // path is $HOME), skip the project scan to avoid duplicate entries.
        if (projectDir === userDir) {
            const userCommands = await scanCommands(userDir, "user");
            return { commands: userCommands };
        }

        const [projectCommands, userCommands] = await Promise.all([
            scanCommands(projectDir, "project"),
            scanCommands(userDir, "user"),
        ]);

        return { commands: [...projectCommands, ...userCommands] };
    });
}
