import { useState, useCallback } from "react";
import type { FlowDefinition, FlowStepEntry, StepDefinition, SessionType } from "@taskflow/shared";
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
import { ChevronUp, ChevronDown, X, Plus } from "lucide-react";

interface FlowEditorProps {
    flow: FlowDefinition | null;
    globalSteps: StepDefinition[];
    onSave: (flow: FlowDefinition) => void;
    onCancel: () => void;
}

function FlowEditor({ flow, globalSteps, onSave, onCancel }: FlowEditorProps) {
    const [name, setName] = useState(flow?.name ?? "");
    const [description, setDescription] = useState(flow?.description ?? "");
    const [steps, setSteps] = useState<FlowStepEntry[]>(flow?.steps ?? []);

    const moveStep = useCallback(
        (index: number, direction: -1 | 1) => {
            const target = index + direction;
            if (target < 0 || target >= steps.length) return;
            setSteps((prev) => {
                const next = [...prev];
                [next[index], next[target]] = [next[target], next[index]];
                return next;
            });
        },
        [steps.length],
    );

    const removeStep = useCallback((index: number) => {
        setSteps((prev) => prev.filter((_, i) => i !== index));
    }, []);

    const addGlobalStep = useCallback((step: StepDefinition) => {
        setSteps((prev) => [
            ...prev,
            {
                id: crypto.randomUUID(),
                stepId: step.id,
            } as FlowStepEntry,
        ]);
    }, []);

    const addInlineStep = useCallback(() => {
        setSteps((prev) => [
            ...prev,
            {
                id: crypto.randomUUID(),
                inline: { name: "New Step", prompt: "", sessionType: "claude" },
            } as FlowStepEntry,
        ]);
    }, []);

    const updateInlineStep = useCallback(
        (entryId: string, updates: Partial<{ name: string; prompt: string; sessionType: SessionType }>) => {
            setSteps((prev) =>
                prev.map((entry) =>
                    entry.id === entryId && "inline" in entry && entry.inline
                        ? { ...entry, inline: { ...entry.inline, ...updates } }
                        : entry,
                ),
            );
        },
        [],
    );

    const handleSave = useCallback(() => {
        const now = new Date().toISOString();
        onSave({
            id: flow?.id ?? crypto.randomUUID(),
            name: name.trim(),
            description: description.trim(),
            steps,
            createdAt: flow?.createdAt ?? now,
            updatedAt: now,
        });
    }, [flow, name, description, steps, onSave]);

    const isValid = name.trim() !== "" && steps.length > 0;

    const getStepName = (entry: FlowStepEntry): string => {
        if (entry.label) return entry.label;
        if ("inline" in entry && entry.inline) return entry.inline.name;
        if ("stepId" in entry && entry.stepId) {
            const global = globalSteps.find((s) => s.id === entry.stepId);
            return global?.name ?? "Unknown step";
        }
        return "Unknown";
    };

    const getStepType = (entry: FlowStepEntry): string => {
        if ("inline" in entry && entry.inline) return entry.inline.sessionType;
        if ("stepId" in entry && entry.stepId) {
            const global = globalSteps.find((s) => s.id === entry.stepId);
            return global?.sessionType ?? "?";
        }
        return "?";
    };

    return (
        <div className="flex flex-col gap-4 p-4">
            <div>
                <Label htmlFor="flow-name">Name</Label>
                <Input
                    id="flow-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g., Feature Development"
                />
            </div>
            <div>
                <Label htmlFor="flow-desc">Description</Label>
                <Input
                    id="flow-desc"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Full feature lifecycle..."
                />
            </div>

            <div>
                <div className="mb-2 flex items-center justify-between">
                    <Label>Steps</Label>
                    <div className="flex gap-1">
                        {globalSteps.length > 0 && (
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button variant="outline" size="sm">
                                        <Plus className="mr-1 h-3 w-3" /> From Library
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                    {globalSteps.map((step) => (
                                        <DropdownMenuItem
                                            key={step.id}
                                            onClick={() => addGlobalStep(step)}
                                        >
                                            {step.name}
                                        </DropdownMenuItem>
                                    ))}
                                </DropdownMenuContent>
                            </DropdownMenu>
                        )}
                        <Button variant="outline" size="sm" onClick={addInlineStep}>
                            <Plus className="mr-1 h-3 w-3" /> Inline Step
                        </Button>
                    </div>
                </div>
                <div className="flex flex-col gap-1">
                    {steps.map((entry, i) => (
                        <div key={entry.id} className="bg-muted rounded border p-2">
                            <div className="flex items-center gap-2">
                                <div className="flex flex-col">
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-4 w-4"
                                        onClick={() => moveStep(i, -1)}
                                        disabled={i === 0}
                                    >
                                        <ChevronUp className="h-3 w-3" />
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-4 w-4"
                                        onClick={() => moveStep(i, 1)}
                                        disabled={i === steps.length - 1}
                                    >
                                        <ChevronDown className="h-3 w-3" />
                                    </Button>
                                </div>
                                <span className="flex-1 text-sm">{getStepName(entry)}</span>
                                <span className="bg-background text-muted-foreground rounded px-2 py-0.5 text-xs">
                                    {getStepType(entry)}
                                </span>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-5 w-5"
                                    onClick={() => removeStep(i)}
                                >
                                    <X className="h-3 w-3" />
                                </Button>
                            </div>

                            {"inline" in entry && entry.inline && (
                                <div className="mt-3 grid gap-2">
                                    <Input
                                        value={entry.inline.name}
                                        onChange={(e) =>
                                            updateInlineStep(entry.id, {
                                                name: e.target.value,
                                            })
                                        }
                                        placeholder="Inline step name"
                                    />
                                    <Select
                                        value={entry.inline.sessionType}
                                        onValueChange={(value) =>
                                            updateInlineStep(entry.id, {
                                                sessionType: value as SessionType,
                                            })
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
                                            updateInlineStep(entry.id, {
                                                prompt: e.target.value,
                                            })
                                        }
                                        placeholder="Inline step prompt"
                                        className="min-h-[120px] font-mono text-sm"
                                    />
                                </div>
                            )}
                        </div>
                    ))}
                    {steps.length === 0 && (
                        <div className="text-muted-foreground py-4 text-center text-sm">
                            No steps added yet
                        </div>
                    )}
                </div>
            </div>

            <div className="rounded border border-blue-900/50 bg-blue-950/30 p-3 text-xs text-muted-foreground">
                <p className="mb-1 text-blue-400">Step Prompt Tips</p>
                <p>Each step's agent receives the task description automatically.</p>
                <p>
                    Use{" "}
                    <code className="bg-muted rounded px-1">
                        taskflow-cli artifact save &lt;type&gt;
                    </code>{" "}
                    to save outputs.
                </p>
                <p>
                    Use{" "}
                    <code className="bg-muted rounded px-1">taskflow-cli step complete</code>{" "}
                    when done.
                </p>
            </div>

            <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={onCancel}>
                    Cancel
                </Button>
                <Button onClick={handleSave} disabled={!isValid}>
                    Save Flow
                </Button>
            </div>
        </div>
    );
}

export { FlowEditor };
