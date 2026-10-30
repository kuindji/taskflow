import { INHERIT_AGENT_ACCOUNT, MSG, type CodexModelsPayload } from "@taskflow/shared";
import type { Router } from "../ws/router";
import type { TaskStore } from "../services/task-store";
import type { SettingsStore } from "../services/settings-store";
import type { fetchCodexModels } from "../services/runtime-detector";
import { headlessAgentEnv } from "../services/agent-accounts";

function parsePayload(payload: unknown): CodexModelsPayload {
    if (payload === undefined) return {};
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
        throw new Error("Invalid Codex discovery request");
    }
    const fields = payload as Record<string, unknown>;
    if (
        ("account" in fields && typeof fields.account !== "string") ||
        ("projectId" in fields && typeof fields.projectId !== "string")
    ) {
        throw new Error("Invalid Codex discovery request");
    }
    return {
        account:
            fields.account === INHERIT_AGENT_ACCOUNT
                ? undefined
                : (fields.account as string | undefined),
        projectId: fields.projectId as string | undefined,
    };
}

export function registerAgentDiscoveryHandlers(deps: {
    router: Router;
    taskStore: Pick<TaskStore, "getProject">;
    settingsStore: Pick<SettingsStore, "get">;
    fetchCodexModels: typeof fetchCodexModels;
}): void {
    deps.router.register(MSG.CODEX_MODELS, async (payload) => {
        const { account, projectId } = parsePayload(payload);
        const project = projectId === undefined ? null : await deps.taskStore.getProject(projectId);
        if (projectId !== undefined && !project) throw new Error(`Project not found: ${projectId}`);
        const settings = await deps.settingsStore.get();
        const env = headlessAgentEnv("codex", { type: "codex", account }, settings, project);
        return deps.fetchCodexModels(env);
    });
}
