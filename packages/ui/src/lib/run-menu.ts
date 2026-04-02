import type {
    ActionDefinition,
    AgentAvailability,
    AgentCommand,
    AgentType,
    FlowDefinition,
    FlowRun,
} from "@taskflow/shared";
import { ALL_AGENT_TYPES, AGENT_DISPLAY_NAMES } from "@taskflow/shared";
import { isAgentAvailable } from "@/hooks/useAgentAvailability";
import type { NativeMenuItem, NativeMenuActionMap } from "@/lib/native-menu";

interface RunMenuData {
    scripts: Record<string, string>;
    defaultRuntime: string;
    agentCommands: AgentCommand[];
    flows: FlowDefinition[];
    standaloneActions: ActionDefinition[];
    activeFlowRun: FlowRun | null;
    agents: AgentAvailability[];
    showAgentOptions: boolean;
    online: boolean;
}

interface RunMenuCallbacks {
    onRunScript: (name: string) => void;
    onRunAgentCommand: (cmd: AgentCommand) => void;
    onStartFlow: (flowId: string) => void;
    onRunAction: (action: ActionDefinition) => void;
    onRunTab?: (type: AgentType) => void;
    onRunTabWithOptions?: (type: AgentType) => void;
}

function hasRunMenuItems(data: RunMenuData): boolean {
    const scriptNames = Object.keys(data.scripts);
    const hasClaudeAgent = isAgentAvailable(data.agents, "claude");
    return (
        scriptNames.length > 0 ||
        (data.agentCommands.length > 0 && hasClaudeAgent) ||
        (data.flows.length > 0 && !data.activeFlowRun) ||
        data.standaloneActions.length > 0 ||
        data.showAgentOptions
    );
}

function buildNativeRunMenuItems(
    data: RunMenuData,
    callbacks: RunMenuCallbacks,
): { items: NativeMenuItem[]; actions: NativeMenuActionMap } {
    const items: NativeMenuItem[] = [];
    const actions: NativeMenuActionMap = {};
    const scriptNames = Object.keys(data.scripts);

    if (scriptNames.length > 0) {
        items.push({
            type: "submenu",
            label: "package.json",
            submenu: scriptNames.map((name) => ({
                id: `script:${name}`,
                label: `${name} (${data.defaultRuntime})`,
            })),
        });
        for (const name of scriptNames) {
            actions[`script:${name}`] = () => callbacks.onRunScript(name);
        }
    }

    if (data.agentCommands.length > 0 && isAgentAvailable(data.agents, "claude")) {
        items.push({
            type: "submenu",
            label: ".claude",
            enabled: data.online,
            submenu: data.agentCommands.map((cmd) => ({
                id: `agent-command:${cmd.source}:${cmd.name}`,
                label: `${cmd.name} (${cmd.source})`,
                enabled: data.online,
            })),
        });
        if (data.online) {
            for (const cmd of data.agentCommands) {
                actions[`agent-command:${cmd.source}:${cmd.name}`] = () =>
                    callbacks.onRunAgentCommand(cmd);
            }
        }
    }

    if (data.flows.length > 0 && !data.activeFlowRun) {
        if (items.length > 0) items.push({ type: "separator" });
        items.push({
            type: "submenu",
            label: "Flows",
            enabled: data.online,
            submenu: data.flows.map((flow) => ({
                id: `flow:${flow.id}`,
                label: flow.name,
                enabled: data.online,
            })),
        });
        if (data.online) {
            for (const flow of data.flows) {
                actions[`flow:${flow.id}`] = () => callbacks.onStartFlow(flow.id);
            }
        }
    }

    if (data.standaloneActions.length > 0) {
        if ((scriptNames.length > 0 || data.agentCommands.length > 0) && data.flows.length === 0) {
            items.push({ type: "separator" });
        }
        items.push({
            type: "submenu",
            label: "Actions",
            enabled: data.online,
            submenu: data.standaloneActions.map((action) => ({
                id: `action:${action.id}`,
                label: `${action.name} (${action.sessionType})`,
                enabled: data.online,
            })),
        });
        if (data.online) {
            for (const action of data.standaloneActions) {
                actions[`action:${action.id}`] = () => callbacks.onRunAction(action);
            }
        }
    }

    if (data.showAgentOptions) {
        if (
            scriptNames.length > 0 ||
            data.flows.length > 0 ||
            data.standaloneActions.length > 0 ||
            data.agentCommands.length > 0
        ) {
            items.push({ type: "separator" });
        }

        items.push({
            type: "label",
            label: "Run agent with task description",
        });

        for (const agentType of ALL_AGENT_TYPES) {
            const available = isAgentAvailable(data.agents, agentType);
            const label = AGENT_DISPLAY_NAMES[agentType];
            const enabled = available && data.online;

            if (!available) {
                items.push({
                    label: `${label} (not installed)`,
                    enabled: false,
                });
                continue;
            }

            const submenu: NativeMenuItem[] = [{ id: `run:${agentType}`, label: "Run", enabled }];
            if (callbacks.onRunTabWithOptions) {
                submenu.push({
                    id: `run-options:${agentType}`,
                    label: "Run with options...",
                    enabled,
                });
            }

            items.push({
                type: "submenu",
                label: enabled ? label : `${label} (offline)`,
                submenu,
                enabled,
            });

            if (enabled) {
                if (callbacks.onRunTab) {
                    const onRunTab = callbacks.onRunTab;
                    actions[`run:${agentType}`] = () => onRunTab(agentType);
                }
                if (callbacks.onRunTabWithOptions) {
                    const onRunTabWithOptions = callbacks.onRunTabWithOptions;
                    actions[`run-options:${agentType}`] = () => onRunTabWithOptions(agentType);
                }
            }
        }
    }

    return { items, actions };
}

export { buildNativeRunMenuItems, hasRunMenuItems };
export type { RunMenuData, RunMenuCallbacks };
