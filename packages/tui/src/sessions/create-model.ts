import {
    AGENT_DISPLAY_NAMES,
    ALL_AGENT_TYPES,
    DEFAULT_TERMINAL_SHELL,
    type AgentListResponse,
    type AgentLaunchOptions,
    type AgentType,
    type AppSettings,
    type SessionCreatePayload,
    type ShellListResponse,
} from "@taskflow/shared";
import { ownerRequest, type SessionOwner } from "./owner";

type SessionPickerItem =
    | {
          kind: "agent";
          type: AgentType;
          label: string;
          isDefault: boolean;
          agentOptions: AgentLaunchOptions;
      }
    | { kind: "shell"; type: "shell"; label: string; path: string; isDefault: boolean };

function configuredShellPath(shells: ShellListResponse, configured: string): string | null {
    if (configured !== DEFAULT_TERMINAL_SHELL) {
        const exact = shells.shells.find((shell) => shell.path === configured);
        if (exact) return exact.path;
    }
    if (shells.systemShellPath) {
        const system = shells.shells.find((shell) => shell.path === shells.systemShellPath);
        if (system) return system.path;
    }
    return shells.shells[0]?.path ?? null;
}

function buildSessionPickerItems(
    agents: AgentListResponse,
    shells: ShellListResponse,
    settings: AppSettings,
): SessionPickerItem[] {
    const available = new Map(
        agents.agents.filter((agent) => agent.available).map((agent) => [agent.type, agent]),
    );
    const agentOrder = ALL_AGENT_TYPES.filter((type) => available.has(type));
    const defaultAgent = settings.general.defaultAgent;
    const orderedAgents = agentOrder.includes(defaultAgent)
        ? [defaultAgent, ...agentOrder.filter((type) => type !== defaultAgent)]
        : agentOrder;
    const defaultShell = configuredShellPath(shells, settings.terminal.defaultShell);

    return [
        ...orderedAgents.map(
            (type): SessionPickerItem => ({
                kind: "agent",
                type,
                label: AGENT_DISPLAY_NAMES[type],
                isDefault: type === defaultAgent,
                agentOptions: defaultAgentOptions(type, settings),
            }),
        ),
        ...shells.shells.map(
            (shell): SessionPickerItem => ({
                kind: "shell",
                type: "shell",
                label: shell.name,
                path: shell.path,
                isDefault: shell.path === defaultShell,
            }),
        ),
    ];
}

function defaultAgentOptions(type: AgentType, settings: AppSettings): AgentLaunchOptions {
    switch (type) {
        case "claude":
            return {
                type,
                ...(settings.claude.defaultModel !== "default"
                    ? { model: settings.claude.defaultModel }
                    : {}),
                ...(settings.claude.defaultEffort !== "default"
                    ? { effort: settings.claude.defaultEffort }
                    : {}),
                ...(settings.claude.permissionMode !== "default"
                    ? { permissionMode: settings.claude.permissionMode }
                    : {}),
            };
        case "codex":
            return {
                type,
                ...(settings.codex.defaultModel ? { model: settings.codex.defaultModel } : {}),
                ...(settings.codex.defaultReasoningEffort !== "default"
                    ? { reasoningEffort: settings.codex.defaultReasoningEffort }
                    : {}),
                sandbox: settings.codex.sandbox,
                approvalPolicy: settings.codex.approvalPolicy,
                dangerouslyBypassApprovalsAndSandbox:
                    settings.codex.dangerouslyBypassApprovalsAndSandbox,
            };
        case "opencode":
            return {
                type,
                ...(settings.opencode.defaultModel
                    ? { model: settings.opencode.defaultModel }
                    : {}),
                autoApprove: settings.opencode.autoApprove,
            };
        case "pi":
            return {
                type,
                ...(settings.pi.defaultModel ? { model: settings.pi.defaultModel } : {}),
                thinking: settings.pi.thinking,
                ...(settings.pi.tools ? { tools: settings.pi.tools } : {}),
            };
        case "kimi":
            return {
                type,
                ...(settings.kimi.defaultModel ? { model: settings.kimi.defaultModel } : {}),
                permissionMode: settings.kimi.permissionMode,
            };
    }
}

interface CreatePayloadInputs {
    owner: SessionOwner;
    item: SessionPickerItem;
    cols: number;
    rows: number;
}

function buildSessionCreatePayload(inputs: CreatePayloadInputs): SessionCreatePayload {
    const owner = ownerRequest(inputs.owner);
    return {
        ...owner,
        type: inputs.item.type,
        ...(inputs.item.kind === "shell" ? { shell: inputs.item.path } : {}),
        ...(inputs.item.kind === "agent" ? { agentOptions: inputs.item.agentOptions } : {}),
        cols: inputs.cols,
        rows: inputs.rows,
    };
}

export { buildSessionCreatePayload, buildSessionPickerItems, defaultAgentOptions };
export type { CreatePayloadInputs, SessionPickerItem };
