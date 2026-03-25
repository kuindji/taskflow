import { useMemo, useState, useRef, useCallback } from "react";
import type { Tab } from "@/stores/session-store";
import { useSessionStore } from "@/stores/session-store";
import { Button } from "@/components/ui/button";
import { StatusDot } from "@/components/ui/status-dot";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { tabVariants } from "./tab-constants";
import { KeyBadge } from "@/components/ui/key-badge";

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

export { TabItem };
export type { TabItemProps };
