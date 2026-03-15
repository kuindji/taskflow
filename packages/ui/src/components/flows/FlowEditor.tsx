import { useState, useCallback } from "react";
import type {
    AgentLaunchOptions,
    FlowDefinition,
    FlowActionEntry,
    ActionDefinition,
    SessionType,
} from "@taskflow/shared";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AgentOptionsPanel } from "@/components/workspace/AgentOptionsPanel";
import { ChevronUp, ChevronDown, X, Plus } from "lucide-react";

interface FlowEditorProps {
    flow: FlowDefinition | null;
    globalActions: ActionDefinition[];
    onSave: (flow: FlowDefinition) => void;
    onCancel: () => void;
    onDelete?: () => void;
}

function FlowEditor({ flow, globalActions, onSave, onCancel, onDelete }: FlowEditorProps) {
    const [name, setName] = useState(flow?.name ?? "");
    const [description, setDescription] = useState(flow?.description ?? "");
    const [actions, setActions] = useState<FlowActionEntry[]>(flow?.actions ?? []);

    const moveAction = useCallback(
        (index: number, direction: -1 | 1) => {
            const target = index + direction;
            if (target < 0 || target >= actions.length) return;
            setActions((prev) => {
                const next = [...prev];
                [next[index], next[target]] = [next[target], next[index]];
                return next;
            });
        },
        [actions.length],
    );

    const removeAction = useCallback((index: number) => {
        setActions((prev) => prev.filter((_, i) => i !== index));
    }, []);

    const addGlobalAction = useCallback((action: ActionDefinition) => {
        setActions((prev) => [
            ...prev,
            {
                id: crypto.randomUUID(),
                actionId: action.id,
            } as FlowActionEntry,
        ]);
    }, []);

    const addInlineAction = useCallback(() => {
        setActions((prev) => [
            ...prev,
            {
                id: crypto.randomUUID(),
                inline: { name: "", prompt: "", sessionType: "claude" },
            } as FlowActionEntry,
        ]);
    }, []);

    const updateInlineAction = useCallback(
        (
            entryId: string,
            updates: Partial<{
                name: string;
                prompt: string;
                sessionType: SessionType;
                agentOptions: AgentLaunchOptions | undefined;
            }>,
        ) => {
            setActions((prev) =>
                prev.map((entry) =>
                    entry.id === entryId && "inline" in entry && entry.inline
                        ? { ...entry, inline: { ...entry.inline, ...updates } }
                        : entry,
                ),
            );
        },
        [],
    );

    const handleInlineSessionTypeChange = useCallback((entryId: string, value: string) => {
        const nextSessionType = value as SessionType;
        setActions((prev) =>
            prev.map((entry) => {
                if (!("inline" in entry) || !entry.inline || entry.id !== entryId) return entry;
                return {
                    ...entry,
                    inline: {
                        ...entry.inline,
                        sessionType: nextSessionType,
                        agentOptions:
                            nextSessionType === "shell" ||
                            entry.inline.agentOptions?.type !== nextSessionType
                                ? undefined
                                : entry.inline.agentOptions,
                    },
                };
            }),
        );
    }, []);

    const handleSave = useCallback(() => {
        const now = new Date().toISOString();
        const normalizedActions = actions.map((entry) => {
            if (!("inline" in entry) || !entry.inline) return entry;
            return {
                ...entry,
                inline: {
                    ...entry.inline,
                    name: entry.inline.name.trim(),
                    prompt: entry.inline.prompt.trim(),
                    agentOptions:
                        entry.inline.sessionType === "shell"
                            ? undefined
                            : entry.inline.agentOptions,
                },
            } satisfies FlowActionEntry;
        });
        onSave({
            id: flow?.id ?? crypto.randomUUID(),
            name: name.trim(),
            description: description.trim(),
            actions: normalizedActions,
            createdAt: flow?.createdAt ?? now,
            updatedAt: now,
        });
    }, [flow, name, description, actions, onSave]);

    const isValid =
        name.trim() !== "" &&
        actions.length > 0 &&
        actions.every((entry) => {
            if (!("inline" in entry) || !entry.inline) return true;
            return (
                entry.inline.name.trim() !== "" &&
                entry.inline.prompt.trim() !== "" &&
                (entry.inline.sessionType === "shell" ||
                    entry.inline.agentOptions?.type === entry.inline.sessionType)
            );
        });

    const getActionName = (entry: FlowActionEntry): string => {
        if (entry.label) return entry.label;
        if ("inline" in entry && entry.inline) return entry.inline.name;
        if ("actionId" in entry && entry.actionId) {
            const global = globalActions.find((s) => s.id === entry.actionId);
            return global?.name ?? "Unknown action";
        }
        return "Unknown";
    };

    const getActionType = (entry: FlowActionEntry): string => {
        if ("inline" in entry && entry.inline) return entry.inline.sessionType;
        if ("actionId" in entry && entry.actionId) {
            const global = globalActions.find((s) => s.id === entry.actionId);
            return global?.sessionType ?? "?";
        }
        return "?";
    };

    return (
        <div className="flex h-full flex-col">
            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto p-6">
                <h3 className="mb-5 text-base font-semibold">
                    {flow ? flow.name || "Edit Flow" : "New Flow"}
                </h3>

                <div className="flex flex-col gap-4">
                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="flow-name">Name</Label>
                        <Input
                            id="flow-name"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="e.g., Feature Development"
                        />
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="flow-desc">Description</Label>
                        <Input
                            id="flow-desc"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="Full feature lifecycle..."
                        />
                    </div>

                    <div className="flex flex-col gap-2">
                        <div className="flex items-center justify-between">
                            <Label>Actions</Label>
                            <div className="flex gap-1">
                                {globalActions.length > 0 && (
                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                            <Button variant="outline" size="sm">
                                                <Plus className="mr-1 h-3 w-3" /> From Library
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end">
                                            {globalActions.map((action) => (
                                                <DropdownMenuItem
                                                    key={action.id}
                                                    onClick={() => addGlobalAction(action)}
                                                >
                                                    {action.name}
                                                </DropdownMenuItem>
                                            ))}
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                )}
                                <Button variant="outline" size="sm" onClick={addInlineAction}>
                                    <Plus className="mr-1 h-3 w-3" /> Inline Action
                                </Button>
                            </div>
                        </div>
                        <div className="flex flex-col gap-2">
                            {actions.map((entry, i) => (
                                <div key={entry.id} className="bg-muted/50 rounded-md border p-3">
                                    <div className="flex items-center gap-2">
                                        <div className="flex flex-col gap-0.5">
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-5 w-5"
                                                onClick={() => moveAction(i, -1)}
                                                disabled={i === 0}
                                            >
                                                <ChevronUp className="h-3 w-3" />
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-5 w-5"
                                                onClick={() => moveAction(i, 1)}
                                                disabled={i === actions.length - 1}
                                            >
                                                <ChevronDown className="h-3 w-3" />
                                            </Button>
                                        </div>
                                        <span className="text-muted-foreground mr-1 text-xs font-medium tabular-nums">
                                            {i + 1}.
                                        </span>
                                        <span className="flex-1 text-sm font-medium">
                                            {getActionName(entry)}
                                        </span>
                                        <span className="bg-background text-muted-foreground rounded-md px-2 py-0.5 text-xs">
                                            {getActionType(entry)}
                                        </span>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-6 w-6"
                                            onClick={() => removeAction(i)}
                                        >
                                            <X className="h-3 w-3" />
                                        </Button>
                                    </div>

                                    {"inline" in entry && entry.inline && (
                                        <div className="border-border mt-3 flex flex-col gap-2 border-t pt-3">
                                            <Input
                                                value={entry.inline.name}
                                                onChange={(e) =>
                                                    updateInlineAction(entry.id, {
                                                        name: e.target.value,
                                                    })
                                                }
                                                placeholder="Inline action name"
                                            />
                                            <Select
                                                value={entry.inline.sessionType}
                                                onValueChange={(value) =>
                                                    handleInlineSessionTypeChange(entry.id, value)
                                                }
                                            >
                                                <SelectTrigger>
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="claude">Claude</SelectItem>
                                                    <SelectItem value="codex">Codex</SelectItem>
                                                    <SelectItem value="shell">Shell</SelectItem>
                                                </SelectContent>
                                            </Select>
                                            <Textarea
                                                value={entry.inline.prompt}
                                                onChange={(e) =>
                                                    updateInlineAction(entry.id, {
                                                        prompt: e.target.value,
                                                    })
                                                }
                                                placeholder="Inline action prompt"
                                                className="min-h-[120px] font-mono text-sm"
                                            />
                                            {(entry.inline.sessionType === "claude" ||
                                                entry.inline.sessionType === "codex") && (
                                                <div className="border-border rounded-md border p-1">
                                                    <AgentOptionsPanel
                                                        key={`${entry.id}-${entry.inline.sessionType}`}
                                                        agentType={entry.inline.sessionType}
                                                        value={entry.inline.agentOptions}
                                                        emitOnMount
                                                        onChange={(options) =>
                                                            updateInlineAction(entry.id, {
                                                                agentOptions: options,
                                                            })
                                                        }
                                                    />
                                                </div>
                                            )}
                                        </div>
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

                    <div className="rounded-md border border-blue-900/50 bg-blue-950/30 p-3 text-xs text-muted-foreground">
                        <p className="mb-1 font-medium text-blue-400">Action Prompt Tips</p>
                        <p>Each action's agent receives the task description automatically.</p>
                        <p>
                            Use{" "}
                            <code className="bg-muted rounded px-1">
                                taskflow-cli artifact save &lt;type&gt;
                            </code>{" "}
                            to save outputs.
                        </p>
                        <p>
                            Use{" "}
                            <code className="bg-muted rounded px-1">taskflow-cli action complete</code>{" "}
                            when done.
                        </p>
                    </div>
                </div>
            </div>

            {/* Sticky footer */}
            <div className="border-border flex shrink-0 justify-end gap-2 border-t px-6 py-3">
                {flow && onDelete && (
                    <Button variant="destructive" size="sm" onClick={onDelete} className="mr-auto">
                        Delete Flow
                    </Button>
                )}
                <Button variant="secondary" size="sm" onClick={onCancel}>
                    Cancel
                </Button>
                <Button size="sm" onClick={handleSave} disabled={!isValid}>
                    Save Flow
                </Button>
            </div>
        </div>
    );
}

export { FlowEditor };
