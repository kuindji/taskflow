import { useState, useCallback } from "react";
import type { StepDefinition, AgentLaunchOptions, SessionType } from "@taskflow/shared";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectTrigger,
    SelectValue,
    SelectContent,
    SelectItem,
} from "@/components/ui/select";
import { AgentOptionsPanel } from "@/components/workspace/AgentOptionsPanel";

interface StepEditorProps {
    step: StepDefinition | null;
    onSave: (step: StepDefinition) => void;
    onCancel: () => void;
    onDelete?: () => void;
    deleteDisabled?: boolean;
    deleteDisabledReason?: string;
}

function StepEditor({
    step,
    onSave,
    onCancel,
    onDelete,
    deleteDisabled = false,
    deleteDisabledReason,
}: StepEditorProps) {
    const [name, setName] = useState(step?.name ?? "");
    const [prompt, setPrompt] = useState(step?.prompt ?? "");
    const [sessionType, setSessionType] = useState<SessionType>(step?.sessionType ?? "claude");
    const [agentOptions, setAgentOptions] = useState(step?.agentOptions);

    const handleSave = useCallback(() => {
        const now = new Date().toISOString();
        onSave({
            id: step?.id ?? crypto.randomUUID(),
            name: name.trim(),
            prompt,
            sessionType,
            agentOptions: sessionType === "shell" ? undefined : agentOptions,
            createdAt: step?.createdAt ?? now,
            updatedAt: now,
        });
    }, [step, name, prompt, sessionType, agentOptions, onSave]);

    const handleAgentOptionsChange = useCallback((options: AgentLaunchOptions) => {
        setAgentOptions(options);
    }, []);

    const isValid = name.trim() !== "" && prompt.trim() !== "";

    return (
        <div className="flex flex-col gap-4 p-4">
            <div>
                <Label htmlFor="step-name">Name</Label>
                <Input
                    id="step-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g., Plan Review"
                />
            </div>
            <div>
                <Label htmlFor="step-session-type">Session Type</Label>
                <Select
                    value={sessionType}
                    onValueChange={(v) => setSessionType(v as SessionType)}
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
            </div>
            <div className="flex-1">
                <Label htmlFor="step-prompt">Prompt</Label>
                <Textarea
                    id="step-prompt"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="Instructions for the agent..."
                    className="min-h-[200px] font-mono text-sm"
                />
            </div>
            {(sessionType === "claude" || sessionType === "codex") && (
                <div className="border-border rounded-md border p-1">
                    <AgentOptionsPanel
                        agentType={sessionType}
                        onChange={handleAgentOptionsChange}
                    />
                </div>
            )}
            <div className="flex justify-end gap-2">
                {step && onDelete && (
                    <Button
                        variant="destructive"
                        onClick={onDelete}
                        disabled={deleteDisabled}
                        title={deleteDisabledReason}
                    >
                        Delete Step
                    </Button>
                )}
                <Button variant="ghost" onClick={onCancel}>
                    Cancel
                </Button>
                <Button onClick={handleSave} disabled={!isValid}>
                    Save Step
                </Button>
            </div>
            {step && deleteDisabledReason && (
                <p className="text-muted-foreground text-xs">{deleteDisabledReason}</p>
            )}
        </div>
    );
}

export { StepEditor };
