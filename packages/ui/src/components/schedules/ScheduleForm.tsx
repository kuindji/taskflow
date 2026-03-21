import { useState, useCallback, useMemo } from "react";
import type {
    Schedule,
    ScheduleCreatePayload,
    ScheduleUpdatePayload,
    Project,
    AgentType,
} from "@taskflow/shared";
import { ALL_AGENT_TYPES, AGENT_DISPLAY_NAMES } from "@taskflow/shared";
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
import { Trash2 } from "lucide-react";

function computeNextRunPreview(
    expression: string,
    expressionType: "cron" | "rate",
): string | null {
    try {
        if (expressionType === "rate") {
            const match = expression.match(
                /^rate\((\d+)\s+(minutes?|hours?|days?)\)$/i,
            );
            if (!match) return null;
            const value = parseInt(match[1], 10);
            const unit = match[2].toLowerCase().replace(/s$/, "");
            const msMap: Record<string, number> = {
                minute: 60000,
                hour: 3600000,
                day: 86400000,
            };
            const ms = msMap[unit];
            if (!ms) return null;
            return new Date(Date.now() + value * ms).toLocaleString();
        }
        return null; // cron preview needs backend cron-parser
    } catch {
        return null;
    }
}

interface ScheduleFormProps {
    schedule: Schedule | null;
    projects: Project[];
    defaultProjectId?: string;
    onSave: (
        payload: ScheduleCreatePayload | ScheduleUpdatePayload,
    ) => void;
    onCancel: () => void;
    onDelete?: () => void;
}

function ScheduleForm({
    schedule,
    projects,
    defaultProjectId,
    onSave,
    onCancel,
    onDelete,
}: ScheduleFormProps) {
    const isEditing = schedule !== null;

    const [projectId, setProjectId] = useState<string>(
        schedule?.projectId ?? defaultProjectId ?? "",
    );
    const [name, setName] = useState(schedule?.name ?? "");
    const [prompt, setPrompt] = useState(schedule?.prompt ?? "");
    const [expressionType, setExpressionType] = useState<"cron" | "rate">(
        schedule?.expressionType ?? "rate",
    );
    const [expression, setExpression] = useState(
        schedule?.expression ?? "rate(30 minutes)",
    );
    const [agentType, setAgentType] = useState<AgentType | "">(
        schedule?.agentType ?? "",
    );
    const [timeout, setTimeout] = useState(
        String(schedule?.timeout ?? 30),
    );

    const nextRunPreview = useMemo(
        () => computeNextRunPreview(expression, expressionType),
        [expression, expressionType],
    );

    const canSave = prompt.trim().length > 0 && expression.trim().length > 0 &&
        (isEditing || projectId.length > 0);

    const handleSave = useCallback(() => {
        if (!canSave) return;

        const timeoutNum = parseInt(timeout, 10);
        const effectiveTimeout = Number.isFinite(timeoutNum) && timeoutNum > 0 ? timeoutNum : 30;

        if (isEditing) {
            const payload: ScheduleUpdatePayload = {
                id: schedule.id,
                name: name || undefined,
                prompt,
                expression,
                expressionType,
                agentType: agentType || null,
                timeout: effectiveTimeout,
            };
            onSave(payload);
        } else {
            const payload: ScheduleCreatePayload = {
                projectId,
                name: name || undefined,
                prompt,
                expression,
                expressionType,
                agentType: agentType || undefined,
                timeout: effectiveTimeout,
            };
            onSave(payload);
        }
    }, [
        canSave, isEditing, schedule, name, prompt, expression,
        expressionType, agentType, timeout, projectId, onSave,
    ]);

    return (
        <div className="flex h-full flex-col">
            <div className="flex items-center justify-between border-b px-4 py-2">
                <h3 className="text-sm font-medium">
                    {isEditing ? "Edit Schedule" : "New Schedule"}
                </h3>
                <div className="flex items-center gap-1.5">
                    {onDelete && (
                        <Button
                            variant="ghost"
                            size="icon"
                            className="text-destructive hover:text-destructive h-7 w-7"
                            onClick={onDelete}
                            title="Delete schedule">
                            <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                    )}
                </div>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto p-4">
                {/* Project selector — only on create */}
                {!isEditing && (
                    <div className="space-y-1.5">
                        <Label className="text-xs">Project</Label>
                        <Select value={projectId} onValueChange={setProjectId}>
                            <SelectTrigger className="h-8 text-xs">
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

                {/* Name */}
                <div className="space-y-1.5">
                    <Label className="text-xs">Name (optional)</Label>
                    <Input
                        className="h-8 text-xs"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Auto-generated from prompt"
                    />
                </div>

                {/* Prompt */}
                <div className="space-y-1.5">
                    <Label className="text-xs">Prompt</Label>
                    <Textarea
                        className="min-h-[80px] text-xs"
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        placeholder="What should the agent do?"
                    />
                </div>

                {/* Schedule expression */}
                <div className="space-y-1.5">
                    <Label className="text-xs">Schedule</Label>
                    <div className="flex items-center gap-2">
                        <Select
                            value={expressionType}
                            onValueChange={(v) => setExpressionType(v as "cron" | "rate")}>
                            <SelectTrigger className="h-8 w-24 text-xs">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="rate">Rate</SelectItem>
                                <SelectItem value="cron">Cron</SelectItem>
                            </SelectContent>
                        </Select>
                        <Input
                            className="h-8 flex-1 text-xs"
                            value={expression}
                            onChange={(e) => setExpression(e.target.value)}
                            placeholder={
                                expressionType === "rate"
                                    ? "rate(30 minutes)"
                                    : "0 */6 * * *"
                            }
                        />
                    </div>
                    {nextRunPreview && (
                        <p className="text-muted-foreground text-[11px]">
                            Next run: {nextRunPreview}
                        </p>
                    )}
                </div>

                {/* Agent type */}
                <div className="space-y-1.5">
                    <Label className="text-xs">Agent Type</Label>
                    <Select
                        value={agentType || "__default__"}
                        onValueChange={(v) =>
                            setAgentType(v === "__default__" ? "" : (v as AgentType))
                        }>
                        <SelectTrigger className="h-8 text-xs">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="__default__">Default</SelectItem>
                            {ALL_AGENT_TYPES.map((t) => (
                                <SelectItem key={t} value={t}>
                                    {AGENT_DISPLAY_NAMES[t]}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                {/* Timeout */}
                <div className="space-y-1.5">
                    <Label className="text-xs">Timeout (minutes)</Label>
                    <Input
                        className="h-8 w-24 text-xs"
                        type="number"
                        min={1}
                        value={timeout}
                        onChange={(e) => setTimeout(e.target.value)}
                    />
                </div>
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-2 border-t px-4 py-2">
                <Button variant="ghost" size="sm" onClick={onCancel}>
                    Cancel
                </Button>
                <Button size="sm" disabled={!canSave} onClick={handleSave}>
                    {isEditing ? "Save" : "Create"}
                </Button>
            </div>
        </div>
    );
}

export { ScheduleForm };
export type { ScheduleFormProps };
