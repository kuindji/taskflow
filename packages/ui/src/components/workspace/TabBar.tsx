import { useMemo, useEffect, useState, useRef, useCallback, Fragment } from "react";
import { cva } from "class-variance-authority";
import type { Tab } from "@/stores/session-store";
import { useSessionStore } from "@/stores/session-store";
import { useSettingsStore } from "@/stores/settings-store";
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
import { StatusDot } from "@/components/ui/status-dot";
import { X, Play, Terminal, Globe, ChevronDown, SquareTerminal, Workflow, Zap } from "lucide-react";
import { ClaudeIcon } from "@/components/icons/ClaudeIcon";
import { CodexIcon } from "@/components/icons/CodexIcon";
import { OpenCodeIcon } from "@/components/icons/OpenCodeIcon";
import { GeminiIcon } from "@/components/icons/GeminiIcon";
import { CursorIcon } from "@/components/icons/CursorIcon";
import { cn } from "@/lib/utils";
import {
    getShellDisplayName,
    getShellNameFromPath,
    getTerminalShellSummary,
    resolveTerminalShellPath,
} from "@/lib/terminal-shells";
import { useCmdHeld } from "@/hooks/useCmdHeld";
import { useUIStore } from "@/stores/ui-store";
import { KeyBadge } from "@/components/ui/key-badge";

const AGENT_META: Record<
    AgentType,
    {
        icon: (props: { className?: string }) => React.ReactNode;
        colorClass: string;
    }
> = {
    claude: { icon: ClaudeIcon, colorClass: "text-warning" },
    codex: { icon: CodexIcon, colorClass: "text-success" },
    opencode: { icon: OpenCodeIcon, colorClass: "text-opencode" },
    gemini: { icon: GeminiIcon, colorClass: "text-primary" },
    cursor: { icon: CursorIcon, colorClass: "text-cursor-agent" },
};

const tabVariants = cva(
    "px-1.5 h-6 shrink-0 rounded-md cursor-pointer flex items-center gap-1 text-sm whitespace-nowrap transition-colors",
    {
        variants: {
            type: {
                claude: "text-warning",
                codex: "text-success",
                opencode: "text-opencode",
                gemini: "text-primary",
                cursor: "text-cursor-agent",
                shell: "text-info",
                editor: "text-muted-foreground",
                changes: "text-muted-foreground",
                browser: "text-muted-foreground",
                markdown: "text-muted-foreground",
            },
            active: { true: "bg-muted", false: "bg-transparent hover:bg-muted/50" },
        },
        defaultVariants: { type: "editor", active: false },
    },
);

interface TabItemProps {
    tab: Tab;
    isActive: boolean;
    index: number;
    cmdHeld: boolean;
    onTabClick: (tabId: string) => void;
    onTabClose: (tabId: string) => void;
    onTabRename: (tabId: string, newLabel: string) => void;
}

function TabItem({
    tab,
    isActive,
    index,
    cmdHeld,
    onTabClick,
    onTabClose,
    onTabRename,
}: TabItemProps) {
    const classes = useMemo(
        () => cn(tabVariants({ type: tab.type, active: isActive })),
        [tab.type, isActive],
    );
    const status = useSessionStore((s) =>
        tab.sessionId ? s.sessionStatus[tab.sessionId] : undefined,
    );

    const [isEditing, setIsEditing] = useState(false);
    const [editValue, setEditValue] = useState(tab.label);
    const inputRef = useRef<HTMLInputElement>(null);

    const commitRename = useCallback(() => {
        const trimmed = editValue.trim();
        setIsEditing(false);
        if (trimmed) {
            onTabRename(tab.id, trimmed);
        } else {
            setEditValue(tab.label);
        }
    }, [editValue, tab.label, tab.id, onTabRename]);

    return (
        <div
            role="button"
            tabIndex={0}
            onClick={() => onTabClick(tab.id)}
            onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onTabClick(tab.id);
                }
            }}
            className={classes}>
            {tab.sessionId && <StatusDot status={status} className="mr-1" />}
            {isEditing ? (
                <input
                    ref={inputRef}
                    className="m-0 w-20 border-none bg-transparent p-0 text-sm text-inherit outline-none"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onBlur={commitRename}
                    onFocus={(e) => e.target.select()}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") {
                            e.preventDefault();
                            commitRename();
                        } else if (e.key === "Escape") {
                            e.preventDefault();
                            setEditValue(tab.label);
                            setIsEditing(false);
                        }
                        e.stopPropagation();
                    }}
                    onClick={(e) => e.stopPropagation()}
                />
            ) : (
                <span
                    onDoubleClick={(e) => {
                        e.stopPropagation();
                        setEditValue(tab.label);
                        setIsEditing(true);
                        requestAnimationFrame(() => inputRef.current?.focus());
                    }}>
                    {tab.label}
                </span>
            )}
            <div className="ml-0.5 flex h-[18px] w-[18px] items-center justify-center">
                {cmdHeld && index < 9 ? (
                    <KeyBadge number={index + 1} />
                ) : (
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        className="h-4 w-4 p-0"
                        aria-label="Close tab"
                        onClick={(e) => {
                            e.stopPropagation();
                            onTabClose(tab.id);
                        }}>
                        <X className="size-3" />
                    </Button>
                )}
            </div>
        </div>
    );
}

interface TabBarProps {
    tabs: Tab[];
    activeTabId: string;
    onTabClick: (tabId: string) => void;
    onTabClose: (tabId: string) => void;
    onTabRename: (tabId: string, newLabel: string) => void;
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

export function TabBar({
    tabs,
    activeTabId,
    onTabClick,
    onTabClose,
    onTabRename,
    onNewTab,
    onRunTab,
    onRunScript,
    onRunAction,
    onRunAgentCommand,
    onStartFlow,
    onManageFlows,
    scripts,
    defaultRuntime,
    flows,
    standaloneActions,
    agentCommands,
    activeFlowRun,
    showRunButton,
    showAgentOptions,
    allowSessionTabs,
}: TabBarProps) {
    const [shells, setShells] = useState<ShellInfo[]>([]);
    const [systemShellPath, setSystemShellPath] = useState<string | null>(null);
    const [openAgentPopover, setOpenAgentPopover] = useState<AgentType | null>(null);
    const agents = useAgentAvailability();
    const { cmdHeld } = useCmdHeld();
    const focusedPanel = useUIStore((s) => s.focusedPanel);
    const showBadges = cmdHeld && focusedPanel === "workspace";
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

    return (
        <div className="bg-card border-border flex min-h-9 items-center gap-1 border-b px-1.5 py-1.5">
            <div className="flex shrink-0 items-center gap-1">
                {showRunButton && (
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
                                            Actions and Flows
                                        </DropdownMenuSubTrigger>
                                        <DropdownMenuSubContent>
                                            {flows.map((f) => (
                                                <DropdownMenuItem
                                                    key={f.id}
                                                    onClick={() => onStartFlow(f.id)}>
                                                    {f.name}
                                                </DropdownMenuItem>
                                            ))}
                                            <DropdownMenuSeparator />
                                            <DropdownMenuItem onClick={onManageFlows}>
                                                Manage Actions and Flows...
                                            </DropdownMenuItem>
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
                )}
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
                {((hasAvailableNonFavorites && allowSessionTabs) || shells.length > 1) && (
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
                                            if (defaultShellPath)
                                                onNewTab("shell", defaultShellPath);
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
                )}
            </div>
            <div
                className="flex min-w-0 items-center gap-1 overflow-x-auto"
                style={{ scrollbarWidth: "none" }}>
                {tabs.map((tab, index) => (
                    <TabItem
                        key={tab.id}
                        tab={tab}
                        isActive={tab.id === activeTabId}
                        index={index}
                        cmdHeld={showBadges}
                        onTabClick={onTabClick}
                        onTabClose={onTabClose}
                        onTabRename={onTabRename}
                    />
                ))}
            </div>
        </div>
    );
}
