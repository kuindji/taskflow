import { useState, useCallback, useMemo, useEffect } from "react";
import type {
    Schedule,
    ScheduleCreatePayload,
    ScheduleUpdatePayload,
    ScheduleSessionType,
    Project,
    AgentLaunchOptions,
    ActionDefinition,
} from "@taskflow/shared";
import { ALL_AGENT_TYPES, AGENT_DISPLAY_NAMES } from "@taskflow/shared";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ConfirmDeleteDialog } from "@/components/ui/confirm-delete-dialog";
import { Label } from "@/components/ui/label";
import { ExpandableTextarea } from "@/components/ui/expandable-textarea";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Trash2 } from "lucide-react";
import { AgentOptionsPanel } from "@/components/workspace/AgentOptionsPanel";
import { filterByProject } from "@/stores/flow-store";
import {
    computeNextRunPreview,
    normalizeTimeout,
    serializeScheduleState,
} from "./schedule-helpers";

interface ScheduleFormProps {
    schedule: Schedule | null;
    projects: Project[];
    actions: ActionDefinition[];
    defaultProjectId?: string;
    onSave: (payload: ScheduleCreatePayload | ScheduleUpdatePayload) => Promise<void>;
    onCancel: () => void;
    onDelete?: () => void;
}

function ScheduleForm({
    schedule,
    projects,
    actions,
    defaultProjectId,
    onSave,
    onCancel,
    onDelete,
}: ScheduleFormProps) {
    const isEditing = schedule !== null;
    const [saving, setSaving] = useState(false);

    const [projectId, setProjectId] = useState<string>(
        schedule?.projectId ?? defaultProjectId ?? "",
    );
    const [actionId, setActionId] = useState<string>(schedule?.actionId ?? "");
    const [name, setName] = useState(schedule?.name ?? "");
    const [prompt, setPrompt] = useState(schedule?.prompt ?? "");
    const [expressionType, setExpressionType] = useState<"cron" | "rate">(
        schedule?.expressionType ?? "rate",
    );
    const [expression, setExpression] = useState(schedule?.expression ?? "rate(30 minutes)");
    const [agentType, setAgentType] = useState<ScheduleSessionType | "">(schedule?.agentType ?? "");
    const [agentOptions, setAgentOptions] = useState<AgentLaunchOptions | undefined>(
        schedule?.agentOptions,
    );
    const [timeout, setTimeout] = useState(String(schedule?.timeout ?? 30));
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [resetCounter, setResetCounter] = useState(0);

    const availableActions = useMemo(
        () => filterByProject(actions, projectId).filter((action) => action.standalone),
        [actions, projectId],
    );
    const selectedAction = useMemo(
        () => (actionId ? actions.find((a) => a.id === actionId) : undefined),
        [actionId, actions],
    );

    useEffect(() => {
        if (!actionId) return;
        if (availableActions.some((action) => action.id === actionId)) return;
        setActionId("");
    }, [actionId, availableActions]);

    const useAction = !!selectedAction;

    const handleAgentTypeChange = useCallback((value: string) => {
        const next = value === "__default__" ? "" : (value as ScheduleSessionType);
        setAgentType(next);
        setAgentOptions((current) => {
            if (!next || next === "shell") return undefined;
            return current?.type === next ? current : undefined;
        });
    }, []);

    const handleAgentOptionsChange = useCallback((options: AgentLaunchOptions) => {
        setAgentOptions(options);
    }, []);

    const handleResetAgentOptions = useCallback(() => {
        setAgentOptions(undefined);
        setResetCounter((c) => c + 1);
    }, []);

    const nextRunPreview = useMemo(
        () => computeNextRunPreview(expression, expressionType),
        [expression, expressionType],
    );
    const initialSnapshot = useMemo(
        () =>
            serializeScheduleState({
                includeProjectId: !isEditing,
                projectId: schedule?.projectId ?? defaultProjectId ?? "",
                name: schedule?.name,
                actionId: schedule?.actionId,
                prompt: schedule?.prompt,
                expression: schedule?.expression ?? "rate(30 minutes)",
                expressionType: schedule?.expressionType ?? "rate",
                agentType: schedule?.agentType ?? "",
                agentOptions: schedule?.agentOptions,
                timeout: schedule?.timeout ?? 30,
                useAction: Boolean(schedule?.actionId),
            }),
        [defaultProjectId, isEditing, schedule],
    );
    const currentSnapshot = useMemo(
        () =>
            serializeScheduleState({
                includeProjectId: !isEditing,
                projectId,
                name,
                actionId,
                prompt,
                expression,
                expressionType,
                agentType,
                agentOptions,
                timeout,
                useAction,
            }),
        [
            actionId,
            agentOptions,
            agentType,
            expression,
            expressionType,
            isEditing,
            name,
            projectId,
            prompt,
            timeout,
            useAction,
        ],
    );
    const hasChanges = initialSnapshot !== currentSnapshot;

    const canSave =
        (useAction || prompt.trim().length > 0) &&
        expression.trim().length > 0 &&
        (isEditing || projectId.length > 0);

    const handleSave = useCallback(async () => {
        if (!canSave || saving || !hasChanges) return;

        const effectiveTimeout = normalizeTimeout(timeout);

        setSaving(true);
        try {
            if (isEditing) {
                const payload: ScheduleUpdatePayload = {
                    id: schedule.id,
                    name: name || undefined,
                    actionId: actionId || null,
                    prompt: useAction ? undefined : prompt,
                    expression,
                    expressionType,
                    agentType: useAction ? null : agentType || null,
                    agentOptions: useAction ? null : agentType ? agentOptions : null,
                    timeout: effectiveTimeout,
                };
                await onSave(payload);
            } else {
                const payload: ScheduleCreatePayload = {
                    projectId,
                    name: name || undefined,
                    actionId: actionId || undefined,
                    prompt: useAction ? undefined : prompt,
                    expression,
                    expressionType,
                    agentType: useAction ? undefined : agentType || undefined,
                    agentOptions: useAction ? undefined : agentType ? agentOptions : undefined,
                    timeout: effectiveTimeout,
                };
                await onSave(payload);
            }
        } finally {
            setSaving(false);
        }
    }, [
        canSave,
        hasChanges,
        saving,
        isEditing,
        schedule,
        name,
        actionId,
        useAction,
        prompt,
        expression,
        expressionType,
        agentType,
        agentOptions,
        timeout,
        projectId,
        onSave,
    ]);

    return (
        <div className="flex h-full flex-col">
            <div className="border-border flex items-center justify-between border-b px-4 py-2">
                <h3 className="text-sm font-medium">
                    {isEditing ? "Edit Schedule" : "New Schedule"}
                </h3>
                <div className="flex items-center gap-1.5">
                    {onDelete && (
                        <>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="text-destructive hover:text-destructive h-7 w-7"
                                onClick={() => setConfirmDelete(true)}
                                title="Delete schedule">
                                <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                            <ConfirmDeleteDialog
                                open={confirmDelete}
                                onOpenChange={setConfirmDelete}
                                onConfirm={onDelete}
                                title="Delete this schedule?"
                            />
                        </>
                    )}
                </div>
            </div>

            {schedule?.lastError && (
                <div className="mx-4 mt-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
                    {schedule.lastError}
                </div>
            )}

            <div className="flex-1 space-y-4 overflow-y-auto p-4">
                {/* Project selector — only on create */}
                {!isEditing && (
                    <div className="space-y-1.5">
                        <Label className="text-xs">Project</Label>
                        <Select value={projectId} onValueChange={setProjectId}>
                            <SelectTrigger size="sm" className="text-xs">
                                <SelectValue placeholder="Select project" />
                            </SelectTrigger>
                            <SelectContent>
                                {projects.map((p) => (
                                    <SelectItem key={p.id} value={p.id}>
                                        {p.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                )}

                {/* Action selector */}
                {availableActions.length > 0 && (
                    <div className="space-y-1.5">
                        <Label className="text-xs">Action</Label>
                        <Select
                            value={actionId || "__none__"}
                            onValueChange={(v) => setActionId(v === "__none__" ? "" : v)}>
                            <SelectTrigger size="sm" className="text-xs">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="__none__">None (custom prompt)</SelectItem>
                                {availableActions.map((a) => (
                                    <SelectItem key={a.id} value={a.id}>
                                        {a.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                )}

                {/* Action summary when action is selected */}
                {useAction && selectedAction && (
                    <div className="border-border bg-muted/30 rounded-md border p-3">
                        <p className="text-muted-foreground text-[11px] tracking-wide uppercase">
                            Action: {selectedAction.name}
                        </p>
                        <p className="text-muted-foreground mt-1 text-xs">
                            Agent: {selectedAction.sessionType}
                        </p>
                        <p className="text-muted-foreground mt-1 line-clamp-3 text-xs">
                            {selectedAction.prompt}
                        </p>
                    </div>
                )}

                {/* Session type — hidden when action selected */}
                {!useAction && (
                    <div className="space-y-1.5">
                        <Label className="text-xs">Type</Label>
                        <Select
                            value={agentType || "__default__"}
                            onValueChange={handleAgentTypeChange}>
                            <SelectTrigger size="sm" className="text-xs">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="__default__">Default</SelectItem>
                                {ALL_AGENT_TYPES.map((t) => (
                                    <SelectItem key={t} value={t}>
                                        {AGENT_DISPLAY_NAMES[t]}
                                    </SelectItem>
                                ))}
                                <SelectItem value="shell">Shell</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                )}

                {/* Name — hidden when action selected */}
                {!useAction && (
                    <div className="space-y-1.5">
                        <Label className="text-xs">Name (optional)</Label>
                        <Input
                            size="sm"
                            className="text-xs"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Auto-generated from prompt"
                        />
                    </div>
                )}

                {/* Prompt — hidden when action selected */}
                {!useAction && (
                    <div className="space-y-1.5">
                        <Label className="text-xs">
                            {agentType === "shell" ? "Command" : "Prompt"}
                        </Label>
                        <ExpandableTextarea
                            className="min-h-[80px] text-xs"
                            dialogTitle={
                                agentType === "shell" ? "Shell Command" : "Schedule Prompt"
                            }
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                            placeholder={
                                agentType === "shell"
                                    ? "Shell command to run"
                                    : "What should the agent do?"
                            }
                        />
                    </div>
                )}

                {/* Schedule expression */}
                <div className="space-y-1.5">
                    <Label className="text-xs">Schedule</Label>
                    <div className="flex items-center gap-2">
                        <Select
                            value={expressionType}
                            onValueChange={(v) => setExpressionType(v as "cron" | "rate")}>
                            <SelectTrigger size="sm" className="w-24 text-xs">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="rate">Rate</SelectItem>
                                <SelectItem value="cron">Cron</SelectItem>
                            </SelectContent>
                        </Select>
                        <Input
                            size="sm"
                            className="flex-1 text-xs"
                            value={expression}
                            onChange={(e) => setExpression(e.target.value)}
                            placeholder={
                                expressionType === "rate" ? "rate(30 minutes)" : "0 */6 * * *"
                            }
                        />
                    </div>
                    {nextRunPreview && (
                        <p className="text-muted-foreground text-[11px]">
                            Next run: {nextRunPreview}
                        </p>
                    )}
                </div>

                {/* Agent options — hidden when action selected or shell */}
                {!useAction && agentType && agentType !== "shell" && (
                    <div className="border-border rounded-md border p-3">
                        <AgentOptionsPanel
                            key={`${schedule?.id ?? "new"}-${agentType}-${resetCounter}`}
                            agentType={agentType}
                            value={agentOptions}
                            emitOnMount
                            onChange={handleAgentOptionsChange}
                            onReset={handleResetAgentOptions}
                        />
                    </div>
                )}

                {/* Timeout */}
                <div className="space-y-1.5">
                    <Label className="text-xs">Timeout (minutes)</Label>
                    <Input
                        size="sm"
                        className="block w-24 text-xs"
                        type="number"
                        min={1}
                        value={timeout}
                        onChange={(e) => setTimeout(e.target.value)}
                    />
                </div>
            </div>

            {/* Footer */}
            <div className="border-border flex justify-end gap-2 border-t px-4 py-2">
                <Button variant="ghost" size="sm" onClick={onCancel}>
                    Cancel
                </Button>
                <Button
                    size="sm"
                    disabled={!canSave || saving || !hasChanges}
                    onClick={() => void handleSave()}>
                    {saving
                        ? isEditing
                            ? "Saving..."
                            : "Creating..."
                        : isEditing
                          ? "Save"
                          : "Create"}
                </Button>
            </div>
        </div>
    );
}

export { ScheduleForm };
