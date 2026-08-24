import {
    AGENT_DISPLAY_NAMES,
    ALL_AGENT_TYPES,
    DEFAULT_TERMINAL_SHELL,
    type AgentListResponse,
    type AgentType,
    type AppSettings,
    type SessionCreatePayload,
    type ShellListResponse,
} from "@taskflow/shared";
import { ownerRequest, type SessionOwner } from "./owner";

type SessionPickerItem =
    | { kind: "agent"; type: AgentType; label: string; isDefault: boolean }
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

interface CreatePayloadInputs {
    owner: SessionOwner;
    item: SessionPickerItem;
    cols: number;
    rows: number;
    taskDescription?: string;
}

function buildSessionCreatePayload(inputs: CreatePayloadInputs): SessionCreatePayload {
    const owner = ownerRequest(inputs.owner);
    const prompt =
        inputs.owner.kind === "task" &&
        inputs.item.kind === "agent" &&
        inputs.taskDescription?.trim()
            ? inputs.taskDescription
            : undefined;
    return {
        ...owner,
        type: inputs.item.type,
        ...(inputs.item.kind === "shell" ? { shell: inputs.item.path } : {}),
        ...(prompt === undefined ? {} : { prompt }),
        cols: inputs.cols,
        rows: inputs.rows,
    };
}

export { buildSessionCreatePayload, buildSessionPickerItems };
export type { CreatePayloadInputs, SessionPickerItem };
