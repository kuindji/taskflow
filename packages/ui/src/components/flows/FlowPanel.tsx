import { useState, useCallback } from "react";
import type { FlowStepState } from "@taskflow/shared";
import { useFlowStore } from "@/stores/flow-store";
import { Button } from "@/components/ui/button";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Check, X, SkipForward, Pause, Play, Square, Loader2 } from "lucide-react";

interface FlowPanelProps {
    taskId: string;
}

function FlowPanel({ taskId }: FlowPanelProps) {
    const run = useFlowStore((s) => s.activeRuns[taskId]);
    const flows = useFlowStore((s) => s.flows);
    const steps = useFlowStore((s) => s.steps);
    const [jumpConfirm, setJumpConfirm] = useState<{ index: number; name: string } | null>(null);

    const handlePause = useCallback(() => {
        if (!run) return;
        void useFlowStore.getState().pauseFlow(taskId, run.flowId);
    }, [taskId, run]);

    const handleResume = useCallback(() => {
        if (!run) return;
        void useFlowStore.getState().resumeFlow(taskId, run.flowId);
    }, [taskId, run]);

    const handleStop = useCallback(() => {
        if (!run) return;
        void useFlowStore.getState().stopFlow(taskId, run.flowId);
    }, [taskId, run]);

    const handleSkip = useCallback(
        (e: React.MouseEvent) => {
            if (!run) return;
            e.stopPropagation();
            void useFlowStore.getState().skipStep(taskId, run.flowId);
        },
        [taskId, run],
    );

    if (!run) return null;

    const flowDef = flows.find((f) => f.id === run.flowId);
    const flowName = flowDef?.name ?? "Flow";

    const getStepName = (_state: FlowStepState, index: number): string => {
        const entry = flowDef?.steps[index];
        if (!entry) return `Step ${index + 1}`;
        if (entry.label) return entry.label;
        if ("inline" in entry && entry.inline) return entry.inline.name;
        if ("stepId" in entry && entry.stepId) {
            return steps.find((step) => step.id === entry.stepId)?.name ?? `Step ${index + 1}`;
        }
        return `Step ${index + 1}`;
    };

    const getStepSessionType = (index: number): string => {
        const entry = flowDef?.steps[index];
        if (!entry) return "agent";
        if ("inline" in entry && entry.inline) return entry.inline.sessionType;
        if ("stepId" in entry && entry.stepId) {
            return steps.find((step) => step.id === entry.stepId)?.sessionType ?? "agent";
        }
        return "agent";
    };

    const handleJump = (index: number) => {
        setJumpConfirm({ index, name: getStepName(run.steps[index], index) });
    };

    const confirmJump = () => {
        if (!jumpConfirm) return;
        void useFlowStore.getState().jumpToStep(taskId, run.flowId, jumpConfirm.index);
        setJumpConfirm(null);
    };

    const statusIcon = (status: FlowStepState["status"]) => {
        switch (status) {
            case "completed":
                return <Check className="h-3 w-3 text-green-400" />;
            case "running":
                return <Loader2 className="h-3 w-3 animate-spin text-blue-400" />;
            case "failed":
                return <X className="h-3 w-3 text-red-400" />;
            case "skipped":
                return <SkipForward className="h-3 w-3 text-muted-foreground" />;
            default:
                return null;
        }
    };

    return (
        <div className="border-border flex flex-col border-b">
            {/* Header */}
            <div className="border-border flex items-center justify-between border-b px-3 py-1.5">
                <span className="truncate text-xs font-medium">{flowName}</span>
                <div className="flex gap-1">
                    {run.status === "running" && (
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-5 w-5"
                            onClick={handlePause}
                            tooltip="Pause"
                            tooltipSide="bottom"
                        >
                            <Pause className="h-3 w-3" />
                        </Button>
                    )}
                    {run.status === "paused" && (
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-5 w-5"
                            onClick={handleResume}
                            tooltip="Resume"
                            tooltipSide="bottom"
                        >
                            <Play className="h-3 w-3" />
                        </Button>
                    )}
                    {(run.status === "running" || run.status === "paused") && (
                        <Button
                            variant="ghost"
                            size="icon"
                            className="text-destructive h-5 w-5"
                            onClick={handleStop}
                            tooltip="Stop"
                            tooltipSide="bottom"
                        >
                            <Square className="h-3 w-3" />
                        </Button>
                    )}
                </div>
            </div>

            {/* Step list */}
            <div className="max-h-48 space-y-0.5 overflow-y-auto p-2">
                {run.steps.map((step, i) => (
                    <div
                        key={step.stepEntryId}
                        className={`flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs ${
                            step.status === "running"
                                ? "border border-blue-800/50 bg-blue-950/40"
                                : ""
                        } ${step.status === "completed" ? "bg-green-950/20" : ""} ${
                            step.status === "failed" ? "bg-red-950/20" : ""
                        } ${
                            step.status === "pending" || step.status === "skipped"
                                ? "opacity-50"
                                : ""
                        }`}
                        onClick={() =>
                            step.status === "completed" || step.status === "failed"
                                ? handleJump(i)
                                : undefined
                        }
                    >
                        <div className="flex h-5 w-5 shrink-0 items-center justify-center">
                            {step.status === "pending" ? (
                                <span className="text-muted-foreground">{i + 1}</span>
                            ) : (
                                statusIcon(step.status)
                            )}
                        </div>
                        <div className="min-w-0 flex-1">
                            <div className="truncate">{getStepName(step, i)}</div>
                            <div className="text-muted-foreground text-[10px]">
                                {getStepSessionType(i)}
                            </div>
                        </div>
                        {step.status === "running" && run.status === "running" && (
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-4 w-4"
                                onClick={handleSkip}
                            >
                                <SkipForward className="h-3 w-3" />
                            </Button>
                        )}
                    </div>
                ))}
            </div>

            {/* Artifacts */}
            {run.artifacts.length > 0 && (
                <div className="border-border border-t px-3 py-2">
                    <div className="text-muted-foreground mb-1 text-[10px] uppercase">
                        Artifacts
                    </div>
                    {run.artifacts.map((a, i) => (
                        <div key={i} className="flex items-center gap-2 text-xs">
                            <span className="text-blue-400">&bull;</span>
                            <span>{a.type}</span>
                            <span className="text-muted-foreground truncate text-[10px]">
                                {a.path ?? a.text?.slice(0, 40)}
                            </span>
                        </div>
                    ))}
                </div>
            )}

            {/* Jump confirmation dialog */}
            <AlertDialog
                open={!!jumpConfirm}
                onOpenChange={(open) => !open && setJumpConfirm(null)}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Re-run step?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Re-run step &quot;{jumpConfirm?.name}&quot;? This will reset all
                            subsequent steps.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={confirmJump}>Re-run</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}

export { FlowPanel };
