import { readdir } from "fs/promises";
import { join } from "path";
import { MSG } from "@taskflow/shared";
import type { AgentCommand, AgentCommandsListPayload } from "@taskflow/shared";
import type { Router } from "../ws/router";
import { resolveAgentAccount } from "../services/agent-accounts";
import type { SettingsStore } from "../services/settings-store";
import type { TaskStore } from "../services/task-store";
import { findProjectForPath } from "../utils/path-validation";

interface AgentCommandsHandlerDeps {
    router: Router;
    taskStore: TaskStore;
    settingsStore: SettingsStore;
}

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

async function claudeUserCommandsDir(
    taskStore: TaskStore,
    settingsStore: SettingsStore,
    path: string,
): Promise<string | null> {
    try {
        const project = await findProjectForPath(taskStore, path);
        const account = resolveAgentAccount(
            "claude",
            undefined,
            project,
            await settingsStore.get(),
        );
        return join(account.effectiveHomeDir, "commands");
    } catch {
        // Unknown account: launches already report this loudly; the command
        // list just omits user commands and still lists project commands.
        return null;
    }
}

export function registerAgentCommandsHandlers({
    router,
    taskStore,
    settingsStore,
}: AgentCommandsHandlerDeps): void {
    router.register(MSG.AGENT_COMMANDS_LIST, async (payload) => {
        const { path } = payload as AgentCommandsListPayload;
        const projectDir = join(path, ".claude", "commands");
        const userDir = await claudeUserCommandsDir(taskStore, settingsStore, path);

        // When projectDir and userDir are the same (e.g. master workspace where
        // path is $HOME), skip the project scan to avoid duplicate entries.
        if (projectDir === userDir) {
            return { commands: await scanCommands(userDir, "user") };
        }

        const [projectCommands, userCommands] = await Promise.all([
            scanCommands(projectDir, "project"),
            userDir ? scanCommands(userDir, "user") : Promise.resolve([]),
        ]);

        return { commands: [...projectCommands, ...userCommands] };
    });
}
