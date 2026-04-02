import { useMemo, useEffect, useState, Fragment } from "react";
import type {
    ActionDefinition,
    AgentCommand,
    AgentLaunchOptions,
    FlowDefinition,
    FlowRun,
    ShellInfo,
} from "@taskflow/shared";
import {
    DEFAULT_TERMINAL_SHELL,
    MSG,
    ALL_AGENT_TYPES,
    AGENT_DISPLAY_NAMES,
    type AgentType,
    type ShellListResponse,
} from "@taskflow/shared";
import { sendRequest } from "@/hooks/useWebSocket";
import { useAgentAvailability, isAgentAvailable } from "@/hooks/useAgentAvailability";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
    DropdownMenuSub,
    DropdownMenuSubTrigger,
    DropdownMenuSubContent,
    DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { AgentOptionsDialog } from "./AgentOptionsDialog";
import { RunMenuItems } from "@/components/shared/RunMenuItems";
import type { MenuComponents } from "@/components/shared/RunMenuItems";
import { Play, Terminal, Globe, ChevronDown } from "lucide-react";
import { useSettingsStore } from "@/stores/settings-store";
import { useConnectivity } from "@/hooks/useConnectivity";
import {
    getShellDisplayName,
    getShellNameFromPath,
    getTerminalShellSummary,
    resolveTerminalShellPath,
} from "@/lib/terminal-shells";
import {
    getElementMenuPosition,
    showNativeMenuAndRun,
    supportsNativeMenus,
    type NativeMenuActionMap,
    type NativeMenuItem,
} from "@/lib/native-menu";
import { buildNativeRunMenuItems } from "@/lib/run-menu";
import { AGENT_META } from "./tab-constants";

const dropdownMenuComponents: MenuComponents = {
    Sub: DropdownMenuSub,
    SubTrigger: DropdownMenuSubTrigger,
    SubContent: DropdownMenuSubContent,
    Item: DropdownMenuItem,
    Separator: DropdownMenuSeparator,
    Label: DropdownMenuLabel,
};

interface AgentDropdownMenuProps {
    onNewTab: (
        type: AgentType | "browser" | "shell",
        shellPath?: string,
        agentOptions?: AgentLaunchOptions,
    ) => void;
    onRunTab: (type: AgentType, agentOptions?: AgentLaunchOptions) => void;
    onRunScript: (scriptName: string) => void;
    onRunAction: (action: ActionDefinition) => void;
    onRunAgentCommand: (command: AgentCommand) => void;
    onStartFlow: (flowId: string) => void;
    onManageFlows: () => void;
    scripts: Record<string, string>;
    defaultRuntime: string;
    flows: FlowDefinition[];
    standaloneActions: ActionDefinition[];
    agentCommands: AgentCommand[];
    activeFlowRun: FlowRun | null;
    showRunButton: boolean;
    showAgentOptions: boolean;
    allowSessionTabs: boolean;
}

function AgentDropdownMenu({
    onNewTab,
    onRunTab,
    onRunScript,
    onRunAction,
    onRunAgentCommand,
    onStartFlow,
    //onManageFlows,
    scripts,
    defaultRuntime,
    flows,
    standaloneActions,
    agentCommands,
    activeFlowRun,
    showRunButton,
    showAgentOptions,
    allowSessionTabs,
}: AgentDropdownMenuProps) {
    const [shells, setShells] = useState<ShellInfo[]>([]);
    const [systemShellPath, setSystemShellPath] = useState<string | null>(null);
    const [runOptionsAgent, setRunOptionsAgent] = useState<AgentType | null>(null);
    const [runOptionsContext, setRunOptionsContext] = useState<"newTab" | "runTab" | null>(null);
    const agents = useAgentAvailability();
    const online = useConnectivity();
    const configuredShell = useSettingsStore(
        (s) => s.settings?.terminal.defaultShell ?? DEFAULT_TERMINAL_SHELL,
    );
    const favoriteAgents = useSettingsStore(
        (s) => s.settings?.general.favoriteAgents ?? ALL_AGENT_TYPES,
    );
    const nonFavoriteAgents = useMemo(
        () => ALL_AGENT_TYPES.filter((agent) => !favoriteAgents.includes(agent)),
        [favoriteAgents],
    );
    const hasAvailableNonFavorites = useMemo(
        () => nonFavoriteAgents.some((agent) => isAgentAvailable(agents, agent)),
        [nonFavoriteAgents, agents],
    );

    useEffect(() => {
        if (!allowSessionTabs) {
            setShells([]);
            setSystemShellPath(null);
            return;
        }
        sendRequest<ShellListResponse>(MSG.SHELLS_LIST, {}).then(
            (res) => {
                setShells(res.shells);
                setSystemShellPath(res.systemShellPath);
            },
            () => {
                setShells([]);
                setSystemShellPath(null);
            },
        );
    }, [allowSessionTabs]);

    const defaultShellPath = resolveTerminalShellPath(shells, systemShellPath, configuredShell);
    const defaultShellSummary = getTerminalShellSummary(shells, systemShellPath, configuredShell);
    const scriptNames = useMemo(() => Object.keys(scripts), [scripts]);
    const nativeMenus = supportsNativeMenus();

    const runMenuData = useMemo(
        () => ({
            scripts,
            defaultRuntime,
            agentCommands,
            flows,
            standaloneActions,
            activeFlowRun,
            agents,
            showAgentOptions,
            online,
        }),
        [
            scripts,
            defaultRuntime,
            agentCommands,
            flows,
            standaloneActions,
            activeFlowRun,
            agents,
            showAgentOptions,
            online,
        ],
    );

    const openNativeRunMenu = async (target: HTMLElement) => {
        const { items, actions } = buildNativeRunMenuItems(runMenuData, {
            onRunScript,
            onRunAgentCommand,
            onStartFlow,
            onRunAction,
            onRunTab: (type) => onRunTab(type),
            onRunTabWithOptions: (type) => {
                setRunOptionsAgent(type);
                setRunOptionsContext("runTab");
            },
        });

        await showNativeMenuAndRun(items, actions, getElementMenuPosition(target, "start"));
    };

    const openNativeMoreMenu = async (target: HTMLElement) => {
        const items: NativeMenuItem[] = [];
        const actions: NativeMenuActionMap = {};

        if (allowSessionTabs) {
            for (const agentType of nonFavoriteAgents) {
                const available = isAgentAvailable(agents, agentType);
                const agentEnabled = available && online;
                items.push({
                    id: `new-agent:${agentType}`,
                    label: !available
                        ? `${AGENT_DISPLAY_NAMES[agentType]} (not installed)`
                        : !online
                          ? `${AGENT_DISPLAY_NAMES[agentType]} (offline)`
                          : AGENT_DISPLAY_NAMES[agentType],
                    enabled: agentEnabled,
                });
                if (agentEnabled) {
                    actions[`new-agent:${agentType}`] = () => onNewTab(agentType);
                }
            }
        }

        if (nonFavoriteAgents.length > 0 && allowSessionTabs && shells.length > 1) {
            items.push({ type: "separator" });
        }

        if (shells.length > 1) {
            items.push({
                id: "default-shell",
                label: `Default Terminal (${configuredShell === DEFAULT_TERMINAL_SHELL ? getShellNameFromPath(defaultShellPath ?? systemShellPath ?? "") : defaultShellSummary})`,
                enabled: !!defaultShellPath,
            });
            if (defaultShellPath) {
                actions["default-shell"] = () => onNewTab("shell", defaultShellPath);
            }

            items.push({ type: "separator" });

            for (const shell of shells) {
                items.push({
                    id: `shell:${shell.path}`,
                    label: getShellDisplayName(shell),
                });
                actions[`shell:${shell.path}`] = () => onNewTab("shell", shell.path);
            }
        }

        await showNativeMenuAndRun(items, actions, getElementMenuPosition(target, "start"));
    };

    return (
        <>
            {showRunButton &&
                (nativeMenus ? (
                    <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label="Run"
                        tooltip="Run"
                        tooltipSide="bottom"
                        onClick={(e) => void openNativeRunMenu(e.currentTarget)}>
                        <Play className="h-3.5 w-3.5" />
                    </Button>
                ) : (
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon-xs"
                                aria-label="Run"
                                tooltip="Run"
                                tooltipSide="bottom">
                                <Play className="h-3.5 w-3.5" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start">
                            <RunMenuItems
                                data={{ ...runMenuData, showAgentOptions: false }}
                                callbacks={{
                                    onRunScript,
                                    onRunAgentCommand,
                                    onStartFlow,
                                    onRunAction,
                                }}
                                components={dropdownMenuComponents}
                            />
                            {showAgentOptions && (
                                <>
                                    {(scriptNames.length > 0 ||
                                        flows.length > 0 ||
                                        standaloneActions.length > 0 ||
                                        agentCommands.length > 0) && <DropdownMenuSeparator />}
                                    <DropdownMenuLabel>
                                        Run agent with task description
                                    </DropdownMenuLabel>
                                    {ALL_AGENT_TYPES.map((agentType) => {
                                        const meta = AGENT_META[agentType];
                                        const available = isAgentAvailable(agents, agentType);
                                        const agentEnabled = available && online;
                                        const Icon = meta.icon;
                                        const label = AGENT_DISPLAY_NAMES[agentType];
                                        return (
                                            <Fragment key={agentType}>
                                                <DropdownMenuItem
                                                    disabled={!agentEnabled}
                                                    onClick={() =>
                                                        agentEnabled && onRunTab(agentType)
                                                    }>
                                                    <Icon className="mr-2 h-4 w-4" />
                                                    {label}
                                                    {!available
                                                        ? " (not installed)"
                                                        : !online
                                                          ? " (offline)"
                                                          : ""}
                                                </DropdownMenuItem>
                                                {agentEnabled && (
                                                    <DropdownMenuItem
                                                        onClick={() => {
                                                            setRunOptionsAgent(agentType);
                                                            setRunOptionsContext("runTab");
                                                        }}>
                                                        <Icon className="mr-2 h-4 w-4" />
                                                        {label} with options...
                                                    </DropdownMenuItem>
                                                )}
                                            </Fragment>
                                        );
                                    })}
                                </>
                            )}
                        </DropdownMenuContent>
                    </DropdownMenu>
                ))}
            {allowSessionTabs && (
                <>
                    {favoriteAgents.map((agentType) => {
                        const meta = AGENT_META[agentType];
                        const available = isAgentAvailable(agents, agentType);
                        const enabled = available && online;
                        const Icon = meta.icon;
                        const label = AGENT_DISPLAY_NAMES[agentType];
                        return (
                            <Button
                                key={agentType}
                                variant="ghost"
                                size="icon-xs"
                                className={meta.colorClass}
                                disabled={!enabled}
                                onClick={(e) => {
                                    if (!enabled) return;
                                    if (e.shiftKey) {
                                        setRunOptionsAgent(agentType);
                                        setRunOptionsContext("newTab");
                                    } else {
                                        onNewTab(agentType);
                                    }
                                }}
                                aria-label={`New ${label} session`}
                                tooltip={
                                    !available
                                        ? `${label} CLI not installed`
                                        : !online
                                          ? "No internet connection"
                                          : `New ${label} session (Shift+click for options)`
                                }
                                tooltipSide="bottom">
                                <Icon className="h-3.5 w-3.5" />
                            </Button>
                        );
                    })}
                </>
            )}
            {shells.length > 0 && (
                <>
                    <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label="New terminal"
                        tooltip="New terminal (Cmd+T)"
                        tooltipSide="bottom"
                        disabled={!defaultShellPath}
                        onClick={() => {
                            if (defaultShellPath) onNewTab("shell", defaultShellPath);
                        }}>
                        <Terminal className="h-3.5 w-3.5" />
                    </Button>
                </>
            )}
            <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => onNewTab("browser")}
                aria-label="New browser tab"
                tooltip="New browser tab"
                tooltipSide="bottom">
                <Globe className="h-3.5 w-3.5" />
            </Button>
            {((hasAvailableNonFavorites && allowSessionTabs) || shells.length > 1) &&
                (nativeMenus ? (
                    <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label="More options"
                        tooltip="More options"
                        tooltipSide="bottom"
                        onClick={(e) => void openNativeMoreMenu(e.currentTarget)}>
                        <ChevronDown className="h-3.5 w-3.5" />
                    </Button>
                ) : (
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon-xs"
                                aria-label="More options"
                                tooltip="More options"
                                tooltipSide="bottom">
                                <ChevronDown className="h-3.5 w-3.5" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start">
                            {allowSessionTabs &&
                                nonFavoriteAgents.map((agentType) => {
                                    const meta = AGENT_META[agentType];
                                    const available = isAgentAvailable(agents, agentType);
                                    const agentEnabled = available && online;
                                    const Icon = meta.icon;
                                    return (
                                        <DropdownMenuItem
                                            key={agentType}
                                            disabled={!agentEnabled}
                                            onClick={() => {
                                                if (agentEnabled) onNewTab(agentType);
                                            }}>
                                            <Icon className="mr-2 h-4 w-4" />
                                            {AGENT_DISPLAY_NAMES[agentType]}
                                            {!available ? (
                                                <span className="text-muted-foreground ml-auto text-xs">
                                                    not installed
                                                </span>
                                            ) : !online ? (
                                                <span className="text-muted-foreground ml-auto text-xs">
                                                    offline
                                                </span>
                                            ) : null}
                                        </DropdownMenuItem>
                                    );
                                })}
                            {nonFavoriteAgents.length > 0 &&
                                allowSessionTabs &&
                                shells.length > 1 && <DropdownMenuSeparator />}
                            {shells.length > 1 && (
                                <>
                                    <DropdownMenuItem
                                        disabled={!defaultShellPath}
                                        onClick={() => {
                                            if (defaultShellPath) {
                                                onNewTab("shell", defaultShellPath);
                                            }
                                        }}>
                                        <Terminal className="mr-2 h-4 w-4" />
                                        Default Terminal
                                        <span className="text-muted-foreground ml-auto text-xs">
                                            {configuredShell === DEFAULT_TERMINAL_SHELL
                                                ? getShellNameFromPath(
                                                      defaultShellPath ?? systemShellPath ?? "",
                                                  )
                                                : defaultShellSummary}
                                        </span>
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    {shells.map((shell) => (
                                        <DropdownMenuItem
                                            key={shell.path}
                                            onClick={() => onNewTab("shell", shell.path)}>
                                            <Terminal className="mr-2 h-4 w-4" />
                                            {getShellDisplayName(shell)}
                                        </DropdownMenuItem>
                                    ))}
                                </>
                            )}
                        </DropdownMenuContent>
                    </DropdownMenu>
                ))}
            <AgentOptionsDialog
                open={runOptionsAgent !== null}
                title={
                    runOptionsAgent
                        ? `Run ${AGENT_DISPLAY_NAMES[runOptionsAgent]} with options`
                        : "Run agent with options"
                }
                agentType={runOptionsAgent}
                onOpenChange={(open) => {
                    if (!open) {
                        setRunOptionsAgent(null);
                        setRunOptionsContext(null);
                    }
                }}
                onRun={(agentType, options) => {
                    if (runOptionsContext === "newTab") {
                        onNewTab(agentType, undefined, options);
                    } else {
                        onRunTab(agentType, options);
                    }
                }}
            />
        </>
    );
}

export { AgentDropdownMenu };
