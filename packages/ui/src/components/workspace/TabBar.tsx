import { useMemo, useEffect, useState, useRef, useCallback } from "react";
import { cva } from "class-variance-authority";
import type { Tab } from "@/stores/session-store";
import { useSessionStore } from "@/stores/session-store";
import { useSettingsStore } from "@/stores/settings-store";
import type {
    ActionDefinition,
    AgentLaunchOptions,
    FlowDefinition,
    FlowRun,
    ShellInfo,
} from "@taskflow/shared";
import { DEFAULT_TERMINAL_SHELL, MSG, type ShellListResponse } from "@taskflow/shared";
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
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AgentOptionsPanel } from "./AgentOptionsPanel";
import { StatusDot } from "@/components/ui/status-dot";
import { X, Play, Terminal, Globe, ChevronDown, SquareTerminal, Workflow, Zap } from "lucide-react";
import { ClaudeIcon } from "@/components/icons/ClaudeIcon";
import { CodexIcon } from "@/components/icons/CodexIcon";
import { cn } from "@/lib/utils";
import {
    getShellDisplayName,
    getShellNameFromPath,
    getTerminalShellSummary,
    resolveTerminalShellPath,
} from "@/lib/terminal-shells";

const tabVariants = cva(
    "px-1.5 h-6 rounded-md cursor-pointer flex items-center gap-1 text-sm transition-colors",
    {
        variants: {
            type: {
                claude: "text-warning",
                codex: "text-success",
                shell: "text-info",
                editor: "text-muted-foreground",
                changes: "text-muted-foreground",
                browser: "text-muted-foreground",
            },
            active: { true: "bg-muted", false: "bg-transparent hover:bg-muted/50" },
        },
        defaultVariants: { type: "editor", active: false },
    },
);

interface TabItemProps {
    tab: Tab;
    isActive: boolean;
    onTabClick: (tabId: string) => void;
    onTabClose: (tabId: string) => void;
    onTabRename: (tabId: string, newLabel: string) => void;
}

function TabItem({ tab, isActive, onTabClick, onTabClose, onTabRename }: TabItemProps) {
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
        if (trimmed && trimmed !== tab.label) {
            onTabRename(tab.id, trimmed);
        } else {
            setEditValue(tab.label);
        }
    }, [editValue, tab.label, tab.id, onTabRename]);

    return (
        <div onClick={() => onTabClick(tab.id)} className={classes}>
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
                    }}
                >
                    {tab.label}
                </span>
            )}
            <Button
                variant="ghost"
                size="icon-sm"
                className="ml-0.5 h-4 w-4 p-0"
                aria-label="Close tab"
                onClick={(e) => {
                    e.stopPropagation();
                    onTabClose(tab.id);
                }}
            >
                <X className="size-3" />
            </Button>
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
        type: "claude" | "codex" | "browser" | "shell",
        shellPath?: string,
        agentOptions?: AgentLaunchOptions,
    ) => void;
    onRunTab: (type: "claude" | "codex", agentOptions?: AgentLaunchOptions) => void;
    onRunScript: (scriptName: string) => void;
    onRunAction: (action: ActionDefinition) => void;
    onStartFlow: (flowId: string) => void;
    onManageFlows: () => void;
    scripts: Record<string, string>;
    defaultRuntime: string;
    flows: FlowDefinition[];
    standaloneActions: ActionDefinition[];
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
    onStartFlow,
    onManageFlows,
    scripts,
    defaultRuntime,
    flows,
    standaloneActions,
    activeFlowRun,
    showRunButton,
    showAgentOptions,
    allowSessionTabs,
}: TabBarProps) {
    const [shells, setShells] = useState<ShellInfo[]>([]);
    const [systemShellPath, setSystemShellPath] = useState<string | null>(null);
    const [claudePopoverOpen, setClaudePopoverOpen] = useState(false);
    const [codexPopoverOpen, setCodexPopoverOpen] = useState(false);
    const agents = useAgentAvailability();
    const claudeAvailable = isAgentAvailable(agents, "claude");
    const codexAvailable = isAgentAvailable(agents, "codex");
    const configuredShell = useSettingsStore(
        (s) => s.settings?.terminal.defaultShell ?? DEFAULT_TERMINAL_SHELL,
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
            {showRunButton && (
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-label="Run"
                            tooltip="Run"
                            tooltipSide="bottom"
                        >
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
                                            onClick={() => onRunScript(name)}
                                        >
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
                        {flows.length > 0 && !activeFlowRun && (
                            <>
                                {scriptNames.length > 0 && <DropdownMenuSeparator />}
                                <DropdownMenuSub>
                                    <DropdownMenuSubTrigger>
                                        <Workflow className="mr-2 h-4 w-4" />
                                        Flows
                                    </DropdownMenuSubTrigger>
                                    <DropdownMenuSubContent>
                                        {flows.map((f) => (
                                            <DropdownMenuItem
                                                key={f.id}
                                                onClick={() => onStartFlow(f.id)}
                                            >
                                                {f.name}
                                            </DropdownMenuItem>
                                        ))}
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem onClick={onManageFlows}>
                                            Manage Flows...
                                        </DropdownMenuItem>
                                    </DropdownMenuSubContent>
                                </DropdownMenuSub>
                            </>
                        )}
                        {standaloneActions.length > 0 && (
                            <>
                                {scriptNames.length > 0 && flows.length === 0 && (
                                    <DropdownMenuSeparator />
                                )}
                                <DropdownMenuSub>
                                    <DropdownMenuSubTrigger>
                                        <Zap className="mr-2 h-4 w-4" />
                                        Actions
                                    </DropdownMenuSubTrigger>
                                    <DropdownMenuSubContent>
                                        {standaloneActions.map((a) => (
                                            <DropdownMenuItem
                                                key={a.id}
                                                onClick={() => onRunAction(a)}
                                            >
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
                                    standaloneActions.length > 0) && <DropdownMenuSeparator />}
                                <DropdownMenuItem
                                    disabled={!claudeAvailable}
                                    onClick={() => claudeAvailable && onRunTab("claude")}
                                >
                                    <ClaudeIcon className="mr-2 h-4 w-4" />
                                    Claude Code{!claudeAvailable ? " (not installed)" : ""}
                                </DropdownMenuItem>
                                <DropdownMenuSub>
                                    <DropdownMenuSubTrigger disabled={!claudeAvailable}>
                                        <ClaudeIcon className="mr-2 h-4 w-4" />
                                        Claude Code with options
                                    </DropdownMenuSubTrigger>
                                    {claudeAvailable && (
                                        <DropdownMenuSubContent className="p-0">
                                            <AgentOptionsPanel
                                                agentType="claude"
                                                onRun={(options) => onRunTab("claude", options)}
                                            />
                                        </DropdownMenuSubContent>
                                    )}
                                </DropdownMenuSub>
                                <DropdownMenuItem
                                    disabled={!codexAvailable}
                                    onClick={() => codexAvailable && onRunTab("codex")}
                                >
                                    <CodexIcon className="mr-2 h-4 w-4" />
                                    Codex{!codexAvailable ? " (not installed)" : ""}
                                </DropdownMenuItem>
                                <DropdownMenuSub>
                                    <DropdownMenuSubTrigger disabled={!codexAvailable}>
                                        <CodexIcon className="mr-2 h-4 w-4" />
                                        Codex with options
                                    </DropdownMenuSubTrigger>
                                    {codexAvailable && (
                                        <DropdownMenuSubContent className="p-0">
                                            <AgentOptionsPanel
                                                agentType="codex"
                                                onRun={(options) => onRunTab("codex", options)}
                                            />
                                        </DropdownMenuSubContent>
                                    )}
                                </DropdownMenuSub>
                            </>
                        )}
                    </DropdownMenuContent>
                </DropdownMenu>
            )}
            {allowSessionTabs && (
                <>
                    <Popover open={claudePopoverOpen} onOpenChange={setClaudePopoverOpen}>
                        <PopoverTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon-xs"
                                className="text-warning"
                                disabled={!claudeAvailable}
                                onClick={(e) => {
                                    if (!claudeAvailable) return;
                                    if (e.shiftKey) {
                                        setClaudePopoverOpen(true);
                                    } else {
                                        onNewTab("claude");
                                    }
                                }}
                                aria-label="New Claude session"
                                tooltip={
                                    claudeAvailable
                                        ? "New Claude session (Shift+click for options)"
                                        : "Claude CLI not installed"
                                }
                                tooltipSide="bottom"
                            >
                                <ClaudeIcon className="h-3.5 w-3.5" />
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-56 p-0">
                            <AgentOptionsPanel
                                agentType="claude"
                                onRun={(options) => {
                                    setClaudePopoverOpen(false);
                                    onNewTab("claude", undefined, options);
                                }}
                            />
                        </PopoverContent>
                    </Popover>
                    <Popover open={codexPopoverOpen} onOpenChange={setCodexPopoverOpen}>
                        <PopoverTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon-xs"
                                className="text-success"
                                disabled={!codexAvailable}
                                onClick={(e) => {
                                    if (!codexAvailable) return;
                                    if (e.shiftKey) {
                                        setCodexPopoverOpen(true);
                                    } else {
                                        onNewTab("codex");
                                    }
                                }}
                                aria-label="New Codex session"
                                tooltip={
                                    codexAvailable
                                        ? "New Codex session (Shift+click for options)"
                                        : "Codex CLI not installed"
                                }
                                tooltipSide="bottom"
                            >
                                <CodexIcon className="h-3.5 w-3.5" />
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-56 p-0">
                            <AgentOptionsPanel
                                agentType="codex"
                                onRun={(options) => {
                                    setCodexPopoverOpen(false);
                                    onNewTab("codex", undefined, options);
                                }}
                            />
                        </PopoverContent>
                    </Popover>
                </>
            )}
            {shells.length > 0 && (
                <>
                    <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label="New terminal"
                        tooltip="New terminal"
                        tooltipSide="bottom"
                        disabled={!defaultShellPath}
                        onClick={() => {
                            if (defaultShellPath) onNewTab("shell", defaultShellPath);
                        }}
                    >
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
                tooltipSide="bottom"
            >
                <Globe className="h-3.5 w-3.5" />
            </Button>
            {shells.length > 1 && (
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-label="Choose terminal shell"
                            tooltip="Choose terminal shell"
                            tooltipSide="bottom"
                        >
                            <ChevronDown className="h-3.5 w-3.5" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                        <DropdownMenuItem
                            disabled={!defaultShellPath}
                            onClick={() => {
                                if (defaultShellPath) onNewTab("shell", defaultShellPath);
                            }}
                        >
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
                                onClick={() => onNewTab("shell", shell.path)}
                            >
                                <Terminal className="mr-2 h-4 w-4" />
                                {getShellDisplayName(shell)}
                            </DropdownMenuItem>
                        ))}
                    </DropdownMenuContent>
                </DropdownMenu>
            )}
            {tabs.map((tab) => (
                <TabItem
                    key={tab.id}
                    tab={tab}
                    isActive={tab.id === activeTabId}
                    onTabClick={onTabClick}
                    onTabClose={onTabClose}
                    onTabRename={onTabRename}
                />
            ))}
        </div>
    );
}
