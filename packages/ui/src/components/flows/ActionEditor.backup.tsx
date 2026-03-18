import { useState, useCallback } from "react";
import type { ActionDefinition, AgentLaunchOptions, SessionType } from "@taskflow/shared";
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
import { Switch } from "@/components/ui/switch";
import { AgentOptionsPanel } from "@/components/workspace/AgentOptionsPanel";
import { useProjectStore } from "@/stores/project-store";

interface ActionEditorProps {
    action: ActionDefinition | null;
    defaultProjectId?: string;
    onSave: (action: ActionDefinition) => void;
    onCancel: () => void;
    onDelete?: () => void;
    deleteDisabled?: boolean;
    deleteDisabledReason?: string;
}

function ActionEditor({
    action,
    defaultProjectId,
    onSave,
    onCancel,
    onDelete,
    deleteDisabled = false,
    deleteDisabledReason,
}: ActionEditorProps) {
    const projects = useProjectStore((s) => s.projects);
    const [name, setName] = useState(action?.name ?? "");
    const [prompt, setPrompt] = useState(action?.prompt ?? "");
    const [projectId, setProjectId] = useState<string | undefined>(
        action?.projectId ?? defaultProjectId,
    );
    const [sessionType, setSessionType] = useState<SessionType>(action?.sessionType ?? "claude");
    const [agentOptions, setAgentOptions] = useState(action?.agentOptions);
    const [standalone, setStandalone] = useState(action?.standalone ?? false);

    const handleSessionTypeChange = useCallback((value: string) => {
        const nextSessionType = value as SessionType;
        setSessionType(nextSessionType);
        setAgentOptions((current) => {
            if (nextSessionType === "shell") return undefined;
            return current?.type === nextSessionType ? current : undefined;
        });
    }, []);

    const handleSave = useCallback(() => {
        const now = new Date().toISOString();
        onSave({
            id: action?.id ?? crypto.randomUUID(),
            projectId,
            name: name.trim(),
            prompt,
            sessionType,
            agentOptions: sessionType === "shell" ? undefined : agentOptions,
            standalone: standalone || undefined,
            createdAt: action?.createdAt ?? now,
            updatedAt: now,
        });
    }, [action, name, prompt, projectId, sessionType, agentOptions, standalone, onSave]);

    const handleAgentOptionsChange = useCallback((options: AgentLaunchOptions) => {
        setAgentOptions(options);
    }, []);

    const isValid = name.trim() !== "" && prompt.trim() !== "";

    return (
        <div className="flex h-full flex-col">
            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto pl-4">
                <h3 className="mb-5 text-base font-semibold">
                    {action ? action.name || "Edit Action" : "New Action"}
                </h3>

                <div className="flex flex-col gap-4">
                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="action-name">Name</Label>
                        <Input
                            id="action-name"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="e.g., Plan Review"
                        />
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="action-project">Project</Label>
                        <Select
                            value={projectId ?? "__global__"}
                            onValueChange={(v) => setProjectId(v === "__global__" ? undefined : v)}
                        >
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
                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="action-session-type">Session Type</Label>
                        <Select value={sessionType} onValueChange={handleSessionTypeChange}>
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
                    <div className="flex items-center gap-2">
                        <Switch
                            id="action-standalone"
                            checked={standalone}
                            onCheckedChange={setStandalone}
                        />
                        <Label htmlFor="action-standalone" className="cursor-pointer">
                            Standalone
                        </Label>
                        <span className="text-muted-foreground text-xs">
                            — available in the Run menu
                        </span>
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="action-prompt">Prompt</Label>
                        <Textarea
                            id="action-prompt"
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                            placeholder="Instructions for the agent..."
                            className="min-h-[200px] font-mono text-sm"
                        />
                    </div>
                    {(sessionType === "claude" || sessionType === "codex") && (
                        <div className="border-border rounded-md border p-1">
                            <AgentOptionsPanel
                                key={`${action?.id ?? "new-action"}-${sessionType}`}
                                agentType={sessionType}
                                value={agentOptions}
                                emitOnMount
                                onChange={handleAgentOptionsChange}
                            />
                        </div>
                    )}
                </div>

                {/* Sticky footer */}
                <div className="flex shrink-0 flex-row items-center gap-2 pt-3">
                    {action && onDelete && (
                        <Button
                            variant="destructive"
                            size="sm"
                            onClick={onDelete}
                            disabled={deleteDisabled}
                            title={deleteDisabledReason}
                        >
                            Delete Action
                        </Button>
                    )}
                    {action && deleteDisabledReason && (
                        <span className="text-muted-foreground text-xs">
                            {deleteDisabledReason}
                        </span>
                    )}
                    <div className="flex-1" />
                    <Button variant="secondary" size="sm" onClick={onCancel}>
                        Cancel
                    </Button>
                    <Button size="sm" onClick={handleSave} disabled={!isValid}>
                        Save Action
                    </Button>
                </div>
            </div>
        </div>
    );
}

export { ActionEditor };
