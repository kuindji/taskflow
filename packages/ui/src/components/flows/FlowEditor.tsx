import { useState, useCallback, useMemo } from "react";
import type {
    AgentLaunchOptions,
    FlowDefinition,
    FlowActionEntry,
    ActionDefinition,
    SessionType,
    FlowInputDefinition,
} from "@taskflow/shared";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ConfirmDeleteDialog } from "@/components/ui/confirm-delete-dialog";
import { ExpandableTextarea } from "@/components/ui/expandable-textarea";
import { Label } from "@/components/ui/label";
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
import { useProjectStore } from "@/stores/project-store";
import { ChevronUp, ChevronDown, X, Plus } from "lucide-react";

interface FlowEditorProps {
    flow: FlowDefinition | null;
    globalActions: ActionDefinition[];
    defaultProjectId?: string;
    onSave: (flow: FlowDefinition) => void;
    onCancel: () => void;
    onDelete?: () => void;
}

function FlowEditor({
    flow,
    globalActions,
    defaultProjectId,
    onSave,
    onCancel,
    onDelete,
}: FlowEditorProps) {
    const projects = useProjectStore((s) => s.projects);
    const [name, setName] = useState(flow?.name ?? "");
    const [description, setDescription] = useState(flow?.description ?? "");
    const [projectId, setProjectId] = useState<string | undefined>(
        flow?.projectId ?? defaultProjectId,
    );
    const [actions, setActions] = useState<FlowActionEntry[]>(flow?.actions ?? []);
    const [inputs, setInputs] = useState<FlowInputDefinition[]>(flow?.inputs ?? []);
    const [confirmDelete, setConfirmDelete] = useState(false);

    const libraryActions = useMemo(
        () => globalActions.filter((a) => !a.projectId || a.projectId === projectId),
        [globalActions, projectId],
    );

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

    const addInput = useCallback(() => {
        setInputs((prev) => [...prev, { id: "", label: "", type: "text" }]);
    }, []);

    const removeInput = useCallback((index: number) => {
        setInputs((prev) => prev.filter((_, i) => i !== index));
    }, []);

    const updateInput = useCallback((index: number, updates: Partial<FlowInputDefinition>) => {
        setInputs((prev) =>
            prev.map((input, i) => (i === index ? { ...input, ...updates } : input)),
        );
    }, []);

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
            projectId,
            name: name.trim(),
            description: description.trim(),
            actions: normalizedActions,
            inputs: inputs.length > 0 ? inputs : undefined,
            createdAt: flow?.createdAt ?? now,
            updatedAt: now,
        });
    }, [flow, name, description, actions, inputs, projectId, onSave]);

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
        }) &&
        inputs.every(
            (input) =>
                input.id.trim() !== "" &&
                /^[a-zA-Z0-9_-]+$/.test(input.id) &&
                input.label.trim() !== "",
        ) &&
        new Set(inputs.map((i) => i.id)).size === inputs.length;

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
            <div className="flex-1 overflow-y-auto px-6 py-5">
                <h3 className="mb-5 text-base font-semibold">
                    {flow ? flow.name || "Edit Flow" : "New Flow"}
                </h3>

                <div className="flex flex-col gap-4">
                    <div className="flex flex-col gap-1.5">
                        <Label
                            htmlFor="flow-name"
                            className="text-muted-foreground text-[11px] font-medium tracking-wider uppercase">
                            Name
                        </Label>
                        <Input
                            id="flow-name"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="e.g., Feature Development"
                        />
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <Label
                            htmlFor="flow-desc"
                            className="text-muted-foreground text-[11px] font-medium tracking-wider uppercase">
                            Description
                        </Label>
                        <Input
                            id="flow-desc"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="Full feature lifecycle..."
                        />
                    </div>

                    <div className="flex flex-col gap-1.5">
                        <Label
                            htmlFor="flow-project"
                            className="text-muted-foreground text-[11px] font-medium tracking-wider uppercase">
                            Project
                        </Label>
                        <Select
                            value={projectId ?? "__global__"}
                            onValueChange={(v) => setProjectId(v === "__global__" ? undefined : v)}>
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="__global__">Global</SelectItem>
                                {projects.map((p) => (
                                    <SelectItem key={p.id} value={p.id}>
                                        {p.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="flex flex-col gap-2">
                        <div className="flex items-center justify-between">
                            <Label className="text-muted-foreground text-[11px] font-medium tracking-wider uppercase">
                                Inputs
                            </Label>
                            <Button variant="outline" size="sm" onClick={addInput}>
                                <Plus className="mr-1 h-3 w-3" /> Add Input
                            </Button>
                        </div>
                        <div className="flex flex-col gap-2">
                            {inputs.map((input, i) => (
                                <div
                                    key={i}
                                    className="bg-island-base border-border flex items-start gap-2 rounded-lg border p-2.5">
                                    <div className="flex flex-1 flex-col gap-2">
                                        <div className="flex gap-2">
                                            <Input
                                                value={input.id}
                                                onChange={(e) =>
                                                    updateInput(i, { id: e.target.value })
                                                }
                                                placeholder="Input ID"
                                                className="flex-1"
                                            />
                                            <Select
                                                value={input.type}
                                                onValueChange={(v) =>
                                                    updateInput(i, {
                                                        type: v as "text" | "filepath",
                                                    })
                                                }>
                                                <SelectTrigger className="w-[120px]">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="text">Text</SelectItem>
                                                    <SelectItem value="filepath">
                                                        File Path
                                                    </SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <Input
                                            value={input.label}
                                            onChange={(e) =>
                                                updateInput(i, { label: e.target.value })
                                            }
                                            placeholder="Display label"
                                        />
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="mt-1 h-6 w-6"
                                        onClick={() => removeInput(i)}>
                                        <X className="h-3 w-3" />
                                    </Button>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="flex flex-col gap-2">
                        <div className="flex items-center justify-between">
                            <Label className="text-muted-foreground text-[11px] font-medium tracking-wider uppercase">
                                Actions
                            </Label>
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
                                                    onClick={() => addGlobalAction(action)}>
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
                                <div
                                    key={entry.id}
                                    className="bg-island-base border-border rounded-lg border p-2.5">
                                    <div className="flex items-center gap-2">
                                        <div className="flex flex-col gap-0.5">
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-5 w-5"
                                                onClick={() => moveAction(i, -1)}
                                                disabled={i === 0}>
                                                <ChevronUp className="h-3 w-3" />
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-5 w-5"
                                                onClick={() => moveAction(i, 1)}
                                                disabled={i === actions.length - 1}>
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
                                            onClick={() => removeAction(i)}>
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
                                                }>
                                                <SelectTrigger>
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="claude">Claude</SelectItem>
                                                    <SelectItem value="codex">Codex</SelectItem>
                                                    <SelectItem value="shell">Shell</SelectItem>
                                                </SelectContent>
                                            </Select>
                                            <ExpandableTextarea
                                                value={entry.inline.prompt}
                                                onChange={(e) =>
                                                    updateInlineAction(entry.id, {
                                                        prompt: e.target.value,
                                                    })
                                                }
                                                placeholder="Inline action prompt"
                                                className="min-h-[120px] text-sm"
                                                dialogTitle="Inline Action Prompt"
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

                    <div className="text-muted-foreground rounded-md border border-blue-900/50 bg-blue-950/30 p-3 text-xs">
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
                            <code className="bg-muted rounded px-1">
                                taskflow-cli action complete
                            </code>{" "}
                            when done.
                        </p>
                    </div>
                </div>
            </div>

            {/* Sticky footer outside scroll */}
            <div className="flex shrink-0 items-center gap-2 px-6 py-3">
                {flow && onDelete && (
                    <>
                        <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => setConfirmDelete(true)}
                            className="mr-auto">
                            Delete Flow
                        </Button>
                        <ConfirmDeleteDialog
                            open={confirmDelete}
                            onOpenChange={setConfirmDelete}
                            onConfirm={onDelete}
                            title="Delete this flow?"
                        />
                    </>
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
