import { useMemo, useEffect, useState } from "react";
import { cva } from "class-variance-authority";
import type { Tab } from "@/stores/session-store";
import { useSessionStore } from "@/stores/session-store";
import type { ShellInfo } from "@taskflow/shared";
import { MSG } from "@taskflow/shared";
import { sendRequest } from "@/hooks/useWebSocket";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { StatusDot } from "@/components/ui/status-dot";
import { X, Plus, Play, Terminal, Code, Globe } from "lucide-react";
import { cn } from "@/lib/utils";

const tabVariants = cva(
    "px-1.5 py-1 rounded-md cursor-pointer flex items-center gap-1 text-sm transition-colors",
    {
        variants: {
            type: {
                claude: "text-success",
                codex: "text-warning",
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
}

function TabItem({ tab, isActive, onTabClick, onTabClose }: TabItemProps) {
    const classes = useMemo(
        () => cn(tabVariants({ type: tab.type, active: isActive })),
        [tab.type, isActive],
    );
    const status = useSessionStore(
        (s) => (tab.sessionId ? (s.sessionStatus[tab.sessionId] ?? "idle") : "idle"),
    );

    return (
        <div onClick={() => onTabClick(tab.id)} className={classes}>
            {tab.sessionId && <StatusDot status={status} />}
            <span>{tab.label}</span>
            <Button
                variant="ghost"
                size="icon-sm"
                className="ml-0.5 h-5 w-5"
                onClick={(e) => {
                    e.stopPropagation();
                    onTabClose(tab.id);
                }}
            >
                <X className="h-3.5 w-3.5" />
            </Button>
        </div>
    );
}

interface TabBarProps {
    tabs: Tab[];
    activeTabId: string;
    onTabClick: (tabId: string) => void;
    onTabClose: (tabId: string) => void;
    onNewTab: (
        type: "claude" | "codex" | "changes" | "browser" | "shell",
        shellPath?: string,
    ) => void;
    onRunTab: (type: "claude" | "codex") => void;
}

export function TabBar({ tabs, activeTabId, onTabClick, onTabClose, onNewTab, onRunTab }: TabBarProps) {
    const [shells, setShells] = useState<ShellInfo[]>([]);

    useEffect(() => {
        sendRequest<{ shells: ShellInfo[] }>(MSG.SHELLS_LIST, {}).then(
            (res) => setShells(res.shells),
            () => {},
        );
    }, []);

    return (
        <div className="bg-card border-border flex items-center gap-1 border-b px-1.5 py-1.5">
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-xs">
                        <Play className="h-3.5 w-3.5" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                    <DropdownMenuItem onClick={() => onRunTab("claude")}>
                        <Terminal className="mr-2 h-4 w-4" />
                        Claude Code
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onRunTab("codex")}>
                        <Code className="mr-2 h-4 w-4" />
                        Codex
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-xs">
                        <Plus className="h-4 w-4" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                    <DropdownMenuItem onClick={() => onNewTab("claude")}>
                        <Terminal className="mr-2 h-4 w-4" />
                        Claude Code
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onNewTab("codex")}>
                        <Code className="mr-2 h-4 w-4" />
                        Codex
                    </DropdownMenuItem>
                    {shells.length > 0 && <DropdownMenuSeparator />}
                    {shells.map((shell) => (
                        <DropdownMenuItem
                            key={shell.path}
                            onClick={() => onNewTab("shell", shell.path)}
                        >
                            <Terminal className="mr-2 h-4 w-4" />
                            {shell.name.charAt(0).toUpperCase() + shell.name.slice(1)}
                        </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => onNewTab("changes")}>
                        <Code className="mr-2 h-4 w-4" />
                        Changes
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onNewTab("browser")}>
                        <Globe className="mr-2 h-4 w-4" />
                        Browser
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
            {tabs.map((tab) => (
                <TabItem
                    key={tab.id}
                    tab={tab}
                    isActive={tab.id === activeTabId}
                    onTabClick={onTabClick}
                    onTabClose={onTabClose}
                />
            ))}
        </div>
    );
}
