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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AgentOptionsPanel } from "./AgentOptionsPanel";
import { AgentOptionsDialog } from "./AgentOptionsDialog";
import { Play, Terminal, Globe, ChevronDown, SquareTerminal, Workflow, Zap } from "lucide-react";
import { ClaudeIcon } from "@/components/icons/ClaudeIcon";
import { useSettingsStore } from "@/stores/settings-store";
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
import { AGENT_META } from "./tab-constants";

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
    const [openAgentPopover, setOpenAgentPopover] = useState<AgentType | null>(null);
    const [runOptionsAgent, setRunOptionsAgent] = useState<AgentType | null>(null);
    const agents = useAgentAvailability();
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

    const openNativeRunMenu = async (target: HTMLElement) => {
        const items: NativeMenuItem[] = [];
        const actions: NativeMenuActionMap = {};

        if (scriptNames.length > 0) {
            items.push({
                type: "submenu",
                label: "package.json",
                submenu: scriptNames.map((name) => ({
                    id: `script:${name}`,
                    label: `${name} (${defaultRuntime})`,
                })),
            });
            for (const name of scriptNames) {
                actions[`script:${name}`] = () => onRunScript(name);
            }
        }

        if (agentCommands.length > 0 && isAgentAvailable(agents, "claude")) {
            items.push({
                type: "submenu",
                label: ".claude",
                submenu: agentCommands.map((cmd) => ({
                    id: `agent-command:${cmd.source}:${cmd.name}`,
                    label: `${cmd.name} (${cmd.source})`,
                })),
            });
            for (const cmd of agentCommands) {
                actions[`agent-command:${cmd.source}:${cmd.name}`] = () => onRunAgentCommand(cmd);
            }
        }

        if (flows.length > 0 && !activeFlowRun) {
            if (items.length > 0) items.push({ type: "separator" });
            items.push({
                type: "submenu",
                label: "Flows",
                submenu: [
                    ...flows.map((flow) => ({
                        id: `flow:${flow.id}`,
                        label: flow.name,
                    })),
                    //{ type: "separator" },
                    //{ id: "manage-flows", label: "Manage Actions and Flows..." },
                ],
            });

            for (const flow of flows) {
                actions[`flow:${flow.id}`] = () => onStartFlow(flow.id);
            }
            // actions["manage-flows"] = onManageFlows;
        }

        if (standaloneActions.length > 0) {
            if ((scriptNames.length > 0 || agentCommands.length > 0) && flows.length === 0) {
                items.push({ type: "separator" });
            }
            items.push({
                type: "submenu",
                label: "Actions",
                submenu: standaloneActions.map((action) => ({
                    id: `action:${action.id}`,
                    label: `${action.name} (${action.sessionType})`,
                })),
            });

            for (const action of standaloneActions) {
                actions[`action:${action.id}`] = () => onRunAction(action);
            }
        }

        if (showAgentOptions) {
            if (
                scriptNames.length > 0 ||
                flows.length > 0 ||
                standaloneActions.length > 0 ||
                agentCommands.length > 0
            ) {
                items.push({ type: "separator" });
            }

            items.push({
                type: "label",
                label: "Run agent with task description",
            });

            for (const agentType of ALL_AGENT_TYPES) {
                const available = isAgentAvailable(agents, agentType);
                const label = AGENT_DISPLAY_NAMES[agentType];

                if (!available) {
                    items.push({
                        label: `${label} (not installed)`,
                        enabled: false,
                    });
                    continue;
                }

                items.push({
                    type: "submenu",
                    label,
                    submenu: [
                        { id: `run:${agentType}`, label: "Run" },
                        { id: `run-options:${agentType}`, label: "Run with options..." },
                    ],
                });

                actions[`run:${agentType}`] = () => onRunTab(agentType);
                actions[`run-options:${agentType}`] = () => setRunOptionsAgent(agentType);
            }
        }

        await showNativeMenuAndRun(items, actions, getElementMenuPosition(target, "start"));
    };

    const openNativeMoreMenu = async (target: HTMLElement) => {
        const items: NativeMenuItem[] = [];
        const actions: NativeMenuActionMap = {};

        if (allowSessionTabs) {
            for (const agentType of nonFavoriteAgents) {
                const available = isAgentAvailable(agents, agentType);
                items.push({
                    id: `new-agent:${agentType}`,
                    label: available
                        ? AGENT_DISPLAY_NAMES[agentType]
                        : `${AGENT_DISPLAY_NAMES[agentType]} (not installed)`,
                    enabled: available,
                });
                if (available) {
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
                            {scriptNames.length > 0 && (
                                <DropdownMenuSub>
                                    <DropdownMenuSubTrigger>
                                        <SquareTerminal className="mr-2 h-4 w-4" />
                                        package.json
                                    </DropdownMenuSubTrigger>
                                    <DropdownMenuSubContent>
                                        {scriptNames.map((name) => (
                                            <DropdownMenuItem
                                                key={name}
                                                onClick={() => onRunScript(name)}>
                                                <SquareTerminal className="mr-2 h-4 w-4" />
                                                {name}
                                                <span className="text-muted-foreground ml-auto text-xs">
                                                    {defaultRuntime}
                                                </span>
                                            </DropdownMenuItem>
                                        ))}
                                    </DropdownMenuSubContent>
                                </DropdownMenuSub>
                            )}
                            {agentCommands.length > 0 && isAgentAvailable(agents, "claude") && (
                                <DropdownMenuSub>
                                    <DropdownMenuSubTrigger>
                                        <ClaudeIcon className="mr-2 h-4 w-4" />
                                        .claude
                                    </DropdownMenuSubTrigger>
                                    <DropdownMenuSubContent>
                                        {agentCommands.map((cmd) => (
                                            <DropdownMenuItem
                                                key={`${cmd.source}:${cmd.name}`}
                                                onClick={() => onRunAgentCommand(cmd)}>
                                                <ClaudeIcon className="mr-2 h-4 w-4" />
                                                {cmd.name}
                                                <span className="text-muted-foreground ml-auto text-xs">
                                                    {cmd.source}
                                                </span>
                                            </DropdownMenuItem>
                                        ))}
                                    </DropdownMenuSubContent>
                                </DropdownMenuSub>
                            )}
                            {flows.length > 0 && !activeFlowRun && (
                                <>
                                    {(scriptNames.length > 0 || agentCommands.length > 0) && (
                                        <DropdownMenuSeparator />
                                    )}
                                    <DropdownMenuSub>
                                        <DropdownMenuSubTrigger>
                                            <Workflow className="mr-2 h-4 w-4" />
                                            Flows
                                        </DropdownMenuSubTrigger>
                                        <DropdownMenuSubContent>
                                            {flows.map((f) => (
                                                <DropdownMenuItem
                                                    key={f.id}
                                                    onClick={() => onStartFlow(f.id)}>
                                                    {f.name}
                                                </DropdownMenuItem>
                                            ))}
                                            {/* <DropdownMenuSeparator /> */}
                                            {/* <DropdownMenuItem onClick={onManageFlows}>
                                                Manage Actions and Flows...
                                            </DropdownMenuItem> */}
                                        </DropdownMenuSubContent>
                                    </DropdownMenuSub>
                                </>
                            )}
                            {standaloneActions.length > 0 && (
                                <>
                                    {(scriptNames.length > 0 || agentCommands.length > 0) &&
                                        flows.length === 0 && <DropdownMenuSeparator />}
                                    <DropdownMenuSub>
                                        <DropdownMenuSubTrigger>
                                            <Zap className="mr-2 h-4 w-4" />
                                            Actions
                                        </DropdownMenuSubTrigger>
                                        <DropdownMenuSubContent>
                                            {standaloneActions.map((a) => (
                                                <DropdownMenuItem
                                                    key={a.id}
                                                    onClick={() => onRunAction(a)}>
                                                    {a.name}
                                                    <span className="text-muted-foreground ml-auto text-xs">
                                                        {a.sessionType}
                                                    </span>
                                                </DropdownMenuItem>
                                            ))}
                                        </DropdownMenuSubContent>
                                    </DropdownMenuSub>
                                </>
                            )}
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
                                        const Icon = meta.icon;
                                        const label = AGENT_DISPLAY_NAMES[agentType];
                                        return (
                                            <Fragment key={agentType}>
                                                <DropdownMenuItem
                                                    disabled={!available}
                                                    onClick={() =>
                                                        available && onRunTab(agentType)
                                                    }>
                                                    <Icon className="mr-2 h-4 w-4" />
                                                    {label}
                                                    {!available ? " (not installed)" : ""}
                                                </DropdownMenuItem>
                                                <DropdownMenuSub>
                                                    <DropdownMenuSubTrigger disabled={!available}>
                                                        <Icon className="mr-2 h-4 w-4" />
                                                        {label} with options
                                                    </DropdownMenuSubTrigger>
                                                    {available && (
                                                        <DropdownMenuSubContent className="p-0">
                                                            <AgentOptionsPanel
                                                                agentType={agentType}
                                                                onRun={(options) =>
                                                                    onRunTab(agentType, options)
                                                                }
                                                            />
                                                        </DropdownMenuSubContent>
                                                    )}
                                                </DropdownMenuSub>
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
                        const Icon = meta.icon;
                        const label = AGENT_DISPLAY_NAMES[agentType];
                        return (
                            <Popover
                                key={agentType}
                                open={openAgentPopover === agentType}
                                onOpenChange={(open) =>
                                    setOpenAgentPopover(open ? agentType : null)
                                }>
                                <PopoverTrigger asChild>
                                    <Button
                                        variant="ghost"
                                        size="icon-xs"
                                        className={meta.colorClass}
                                        disabled={!available}
                                        onClick={(e) => {
                                            e.preventDefault();
                                            if (!available) return;
                                            if (e.shiftKey) {
                                                setOpenAgentPopover(agentType);
                                            } else {
                                                onNewTab(agentType);
                                            }
                                        }}
                                        aria-label={`New ${label} session`}
                                        tooltip={
                                            available
                                                ? `New ${label} session (Shift+click for options)`
                                                : `${label} CLI not installed`
                                        }
                                        tooltipSide="bottom">
                                        <Icon className="h-3.5 w-3.5" />
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-56 p-0">
                                    <AgentOptionsPanel
                                        agentType={agentType}
                                        onRun={(options) => {
                                            setOpenAgentPopover(null);
                                            onNewTab(agentType, undefined, options);
                                        }}
                                    />
                                </PopoverContent>
                            </Popover>
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
                                    const Icon = meta.icon;
                                    return (
                                        <DropdownMenuItem
                                            key={agentType}
                                            disabled={!available}
                                            onClick={() => {
                                                if (available) onNewTab(agentType);
                                            }}>
                                            <Icon className="mr-2 h-4 w-4" />
                                            {AGENT_DISPLAY_NAMES[agentType]}
                                            {!available && (
                                                <span className="text-muted-foreground ml-auto text-xs">
                                                    not installed
                                                </span>
                                            )}
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
                    if (!open) setRunOptionsAgent(null);
                }}
                onRun={(agentType, options) => onRunTab(agentType, options)}
            />
        </>
    );
}

export { AgentDropdownMenu };
