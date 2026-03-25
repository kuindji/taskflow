import type {
    FlowActionEntry,
    ActionDefinition,
    SessionType,
    AgentLaunchOptions,
} from "@taskflow/shared";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronUp, ChevronDown, X, Plus } from "lucide-react";
import { InlineActionEditor } from "./InlineActionEditor";

interface FlowActionListProps {
    actions: FlowActionEntry[];
    globalActions: ActionDefinition[];
    libraryActions: ActionDefinition[];
    onMove: (index: number, direction: -1 | 1) => void;
    onRemove: (index: number) => void;
    onAddGlobal: (action: ActionDefinition) => void;
    onAddInline: () => void;
    onUpdateInline: (
        entryId: string,
        updates: Partial<{
            name: string;
            prompt: string;
            sessionType: SessionType;
            agentOptions: AgentLaunchOptions | undefined;
        }>,
    ) => void;
    onInlineSessionTypeChange: (entryId: string, value: string) => void;
}

function getActionName(entry: FlowActionEntry, globalActions: ActionDefinition[]): string {
    if (entry.label) return entry.label;
    if ("inline" in entry && entry.inline) return entry.inline.name;
    if ("actionId" in entry && entry.actionId) {
        const global = globalActions.find((s) => s.id === entry.actionId);
        return global?.name ?? "Unknown action";
    }
    return "Unknown";
}

function getActionType(entry: FlowActionEntry, globalActions: ActionDefinition[]): string {
    if ("inline" in entry && entry.inline) return entry.inline.sessionType;
    if ("actionId" in entry && entry.actionId) {
        const global = globalActions.find((s) => s.id === entry.actionId);
        return global?.sessionType ?? "?";
    }
    return "?";
}

function FlowActionList({
    actions,
    globalActions,
    libraryActions,
    onMove,
    onRemove,
    onAddGlobal,
    onAddInline,
    onUpdateInline,
    onInlineSessionTypeChange,
}: FlowActionListProps) {
    return (
        <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
                <span className="text-muted-foreground text-[11px] font-medium tracking-wider uppercase">
                    Actions
                </span>
                <div className="flex gap-1">
                    {libraryActions.length > 0 && (
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="outline" size="sm">
                                    <Plus className="mr-1 h-3 w-3" /> From Library
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                {libraryActions.map((action) => (
                                    <DropdownMenuItem
                                        key={action.id}
                                        onClick={() => onAddGlobal(action)}>
                                        {action.name}
                                    </DropdownMenuItem>
                                ))}
                            </DropdownMenuContent>
                        </DropdownMenu>
                    )}
                    <Button variant="outline" size="sm" onClick={onAddInline}>
                        <Plus className="mr-1 h-3 w-3" /> Inline Action
                    </Button>
                </div>
            </div>
            <div className="flex flex-col gap-2">
                {actions.map((entry, i) => (
                    <div
                        key={entry.id}
                        className="bg-island-base border-border rounded-lg border p-2.5">
                        <div className="flex items-center gap-2">
                            <div className="flex flex-col gap-0.5">
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-5 w-5"
                                    onClick={() => onMove(i, -1)}
                                    disabled={i === 0}>
                                    <ChevronUp className="h-3 w-3" />
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-5 w-5"
                                    onClick={() => onMove(i, 1)}
                                    disabled={i === actions.length - 1}>
                                    <ChevronDown className="h-3 w-3" />
                                </Button>
                            </div>
                            <span className="text-muted-foreground mr-1 text-xs font-medium tabular-nums">
                                {i + 1}.
                            </span>
                            <span className="flex-1 text-sm font-medium">
                                {getActionName(entry, globalActions)}
                            </span>
                            <span className="bg-background text-muted-foreground rounded-md px-2 py-0.5 text-xs">
                                {getActionType(entry, globalActions)}
                            </span>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6"
                                onClick={() => onRemove(i)}>
                                <X className="h-3 w-3" />
                            </Button>
                        </div>

                        {"inline" in entry && entry.inline && (
                            <InlineActionEditor
                                entryId={entry.id}
                                inline={entry.inline}
                                onUpdate={onUpdateInline}
                                onSessionTypeChange={onInlineSessionTypeChange}
                            />
                        )}
                    </div>
                ))}
                {actions.length === 0 && (
                    <div className="text-muted-foreground rounded-md border border-dashed py-6 text-center text-sm">
                        No actions added yet
                    </div>
                )}
            </div>
        </div>
    );
}

export { FlowActionList };
