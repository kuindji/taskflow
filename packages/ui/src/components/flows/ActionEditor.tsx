import { useState, useCallback, useMemo } from "react";
import type { ActionDefinition, AgentLaunchOptions, SessionType } from "@taskflow/shared";
import { Info } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ExpandableTextarea } from "@/components/ui/expandable-textarea";
import { Button } from "@/components/ui/button";
import { ConfirmDeleteDialog } from "@/components/ui/confirm-delete-dialog";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
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

function normalizeAgentOptions(
    sessionType: SessionType,
    agentOptions: AgentLaunchOptions | undefined,
): AgentLaunchOptions | undefined {
    if (sessionType === "shell") return undefined;

    const matchingOptions = agentOptions?.type === sessionType ? agentOptions : undefined;

    switch (sessionType) {
        case "claude": {
            const opts = matchingOptions?.type === "claude" ? matchingOptions : undefined;
            const legacyOpts = opts as
                | (NonNullable<typeof opts> & { dangerouslySkipPermissions?: unknown })
                | undefined;
            return {
                type: "claude",
                permissionMode:
                    opts?.permissionMode ??
                    (legacyOpts?.dangerouslySkipPermissions === true
                        ? "bypassPermissions"
                        : undefined),
                model: opts?.model,
                effort: opts?.effort,
            };
        }
        case "codex": {
            const opts = matchingOptions?.type === "codex" ? matchingOptions : undefined;
            return {
                type: "codex",
                model: opts?.model,
                reasoningEffort: opts?.reasoningEffort,
                sandbox: opts?.sandbox,
                approvalPolicy: opts?.approvalPolicy,
                dangerouslyBypassApprovalsAndSandbox:
                    opts?.dangerouslyBypassApprovalsAndSandbox || undefined,
            };
        }
        case "opencode": {
            const opts = matchingOptions?.type === "opencode" ? matchingOptions : undefined;
            return {
                type: "opencode",
                model: opts?.model,
                variant: opts?.variant,
                autoApprove: opts?.autoApprove || undefined,
            };
        }
        case "gemini": {
            const opts = matchingOptions?.type === "gemini" ? matchingOptions : undefined;
            return {
                type: "gemini",
                approvalMode: opts?.approvalMode,
                sandbox: opts?.sandbox,
                model: opts?.model,
            };
        }
        case "cursor": {
            const opts = matchingOptions?.type === "cursor" ? matchingOptions : undefined;
            return {
                type: "cursor",
                yolo: opts?.yolo || undefined,
                model: opts?.model,
            };
        }
        default:
            return undefined;
    }
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
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [resetCounter, setResetCounter] = useState(0);

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

    const handleResetAgentOptions = useCallback(() => {
        setAgentOptions(undefined);
        setResetCounter((c) => c + 1);
    }, []);

    const isValid = name.trim() !== "" && prompt.trim() !== "";
    const initialSnapshot = useMemo(
        () =>
            JSON.stringify({
                projectId: action?.projectId ?? defaultProjectId,
                name: action?.name ?? "",
                prompt: action?.prompt ?? "",
                sessionType: action?.sessionType ?? "claude",
                agentOptions: normalizeAgentOptions(
                    action?.sessionType ?? "claude",
                    action?.agentOptions,
                ),
                standalone: action?.standalone || undefined,
            }),
        [action, defaultProjectId],
    );
    const currentSnapshot = JSON.stringify({
        projectId,
        name,
        prompt,
        sessionType,
        agentOptions: normalizeAgentOptions(sessionType, agentOptions),
        standalone: standalone || undefined,
    });
    const hasChanges = initialSnapshot !== currentSnapshot;

    return (
        <div className="flex h-full flex-col">
            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto px-6 py-5">
                <h3 className="mb-5 text-base font-semibold">
                    {action ? action.name || "Edit Action" : "New Action"}
                </h3>

                <div className="flex flex-col gap-4">
                    <div className="flex flex-col gap-1.5">
                        <Label
                            htmlFor="action-name"
                            className="text-muted-foreground text-[11px] font-medium tracking-wider uppercase">
                            Name
                        </Label>
                        <Input
                            id="action-name"
                            size="sm"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="e.g., Plan Review"
                        />
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <Label
                            htmlFor="action-project"
                            className="text-muted-foreground text-[11px] font-medium tracking-wider uppercase">
                            Project
                        </Label>
                        <Select
                            value={projectId ?? "__global__"}
                            onValueChange={(v) => setProjectId(v === "__global__" ? undefined : v)}>
                            <SelectTrigger size="sm">
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
                        <Label
                            htmlFor="action-session-type"
                            className="text-muted-foreground text-[11px] font-medium tracking-wider uppercase">
                            Session Type
                        </Label>
                        <Select value={sessionType} onValueChange={handleSessionTypeChange}>
                            <SelectTrigger size="sm">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="claude">Claude</SelectItem>
                                <SelectItem value="codex">Codex</SelectItem>
                                <SelectItem value="opencode">OpenCode</SelectItem>
                                <SelectItem value="gemini">Gemini</SelectItem>
                                <SelectItem value="cursor">Cursor</SelectItem>
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
                        <Tooltip>
                            <TooltipTrigger>
                                <Info className="text-muted-foreground h-3 w-3 shrink-0" />
                            </TooltipTrigger>
                            <TooltipContent side="top">Available in the Run menu</TooltipContent>
                        </Tooltip>
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <Label
                            htmlFor="action-prompt"
                            className="text-muted-foreground text-[11px] font-medium tracking-wider uppercase">
                            {sessionType === "shell" ? "Command" : "Prompt"}
                        </Label>
                        <ExpandableTextarea
                            id="action-prompt"
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                            placeholder={
                                sessionType === "shell"
                                    ? "Command to run in the terminal..."
                                    : "Instructions for the agent..."
                            }
                            className="min-h-[200px] text-sm"
                            dialogTitle="Action Prompt"
                        />
                    </div>
                    {sessionType !== "shell" && (
                        <div className="border-border rounded-md border p-3">
                            <AgentOptionsPanel
                                key={`${action?.id ?? "new-action"}-${sessionType}-${resetCounter}`}
                                agentType={sessionType}
                                value={agentOptions}
                                emitOnMount
                                onChange={handleAgentOptionsChange}
                                onReset={handleResetAgentOptions}
                            />
                        </div>
                    )}
                </div>
            </div>

            {/* Sticky footer outside scroll */}
            <div className="flex shrink-0 items-center gap-2 px-6 py-3">
                {action && onDelete && (
                    <>
                        <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => setConfirmDelete(true)}
                            disabled={deleteDisabled}
                            title={deleteDisabledReason}>
                            Delete Action
                        </Button>
                        <ConfirmDeleteDialog
                            open={confirmDelete}
                            onOpenChange={setConfirmDelete}
                            onConfirm={onDelete}
                            title="Delete this action?"
                        />
                    </>
                )}
                {action && deleteDisabledReason && (
                    <span className="text-muted-foreground text-xs">{deleteDisabledReason}</span>
                )}
                <div className="flex-1" />
                <Button variant="secondary" size="sm" onClick={onCancel}>
                    Cancel
                </Button>
                <Button size="sm" onClick={handleSave} disabled={!isValid || !hasChanges}>
                    Save Action
                </Button>
            </div>
        </div>
    );
}

export { ActionEditor };
