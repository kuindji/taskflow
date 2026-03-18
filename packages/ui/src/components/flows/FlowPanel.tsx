import { useState, useCallback } from "react";
import type { FlowActionState } from "@taskflow/shared";
import { useFlowStore } from "@/stores/flow-store";
import { useSessionStore } from "@/stores/session-store";
import { Button } from "@/components/ui/button";
import { Toolbar } from "@/components/ui/toolbar";
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
import {
    Check,
    X,
    SkipForward,
    Pause,
    Play,
    Square,
    Loader2,
    RotateCcw,
    Download,
} from "lucide-react";
import { TruncatedText } from "@/components/ui/truncated-text";
import { getTaskWorkspaceKey, getProjectWorkspaceKey } from "@/hooks/useActiveWorkspace";

interface FlowPanelProps {
    ownerId: string;
    onClose: () => void;
}

function FlowPanel({ ownerId, onClose }: FlowPanelProps) {
    const run = useFlowStore((s) => s.activeRuns[ownerId]);
    const flows = useFlowStore((s) => s.flows);
    const actions = useFlowStore((s) => s.actions);
    const [rerunConfirm, setRerunConfirm] = useState<{ index: number; name: string } | null>(null);

    const handlePause = useCallback(() => {
        if (!run) return;
        void useFlowStore.getState().pauseFlow(ownerId, run.flowId);
    }, [ownerId, run]);

    const handleResume = useCallback(() => {
        if (!run) return;
        void useFlowStore.getState().resumeFlow(ownerId, run.flowId);
    }, [ownerId, run]);

    const handleStop = useCallback(() => {
        if (!run) return;
        void useFlowStore.getState().stopFlow(ownerId, run.flowId);
    }, [ownerId, run]);

    const handleSkip = useCallback(
        (e: React.MouseEvent) => {
            if (!run) return;
            e.stopPropagation();
            void useFlowStore.getState().skipAction(ownerId, run.flowId);
        },
        [ownerId, run],
    );

    if (!run) return null;

    const flowDef = flows.find((f) => f.id === run.flowId);
    const flowName = flowDef?.name ?? "Flow";

    const workspaceKey = run.taskId
        ? getTaskWorkspaceKey(run.taskId)
        : run.projectId
          ? getProjectWorkspaceKey(run.projectId)
          : null;

    const getActionName = (_state: FlowActionState, index: number): string => {
        const entry = flowDef?.actions[index];
        if (!entry) return `Action ${index + 1}`;
        if (entry.label) return entry.label;
        if ("inline" in entry && entry.inline) return entry.inline.name;
        if ("actionId" in entry && entry.actionId) {
            return (
                actions.find((action) => action.id === entry.actionId)?.name ??
                `Action ${index + 1}`
            );
        }
        return `Action ${index + 1}`;
    };

    const getActionSessionType = (index: number): string => {
        const entry = flowDef?.actions[index];
        if (!entry) return "agent";
        if ("inline" in entry && entry.inline) return entry.inline.sessionType;
        if ("actionId" in entry && entry.actionId) {
            return actions.find((action) => action.id === entry.actionId)?.sessionType ?? "agent";
        }
        return "agent";
    };

    const handleActionClick = (action: FlowActionState) => {
        if (!action.sessionId || !workspaceKey) return;
        const sessionStore = useSessionStore.getState();
        const tabs = sessionStore.getTabs(workspaceKey);
        const tab = tabs.find((t) => t.sessionId === action.sessionId);
        if (tab) {
            sessionStore.setActiveTab(workspaceKey, tab.id);
        }
    };

    const handleRerun = (e: React.MouseEvent, index: number) => {
        e.stopPropagation();
        setRerunConfirm({ index, name: getActionName(run.actions[index], index) });
    };

    const confirmRerun = () => {
        if (!rerunConfirm) return;
        void useFlowStore.getState().jumpToAction(ownerId, run.flowId, rerunConfirm.index);
        setRerunConfirm(null);
    };

    const statusIcon = (status: FlowActionState["status"]) => {
        switch (status) {
            case "completed":
                return <Check className="h-3 w-3 text-green-400" />;
            case "running":
                return <Loader2 className="h-3 w-3 animate-spin text-blue-400" />;
            case "failed":
                return <X className="h-3 w-3 text-red-400" />;
            case "skipped":
                return <SkipForward className="text-muted-foreground h-3 w-3" />;
            default:
                return null;
        }
    };

    const isFlowDone = run.status === "completed" || run.status === "failed";

    return (
        <div className="flex h-full flex-col">
            {/* Header */}
            <Toolbar className="justify-between">
                <TruncatedText tooltip tooltipSide="bottom" className="ml-2 text-xs font-medium">
                    {flowName}
                </TruncatedText>
                <div className="flex items-center gap-1">
                    {run.status === "running" && (
                        <Button
                            variant="ghost"
                            size="icon-2xs"
                            onClick={handlePause}
                            tooltip="Pause"
                            tooltipSide="bottom"
                        >
                            <Pause className="h-2 w-2" />
                        </Button>
                    )}
                    {run.status === "paused" && (
                        <Button
                            variant="ghost"
                            size="icon-2xs"
                            onClick={handleResume}
                            tooltip="Resume"
                            tooltipSide="bottom"
                        >
                            <Play className="h-2 w-2" />
                        </Button>
                    )}
                    {(run.status === "running" || run.status === "paused") && (
                        <Button
                            variant="ghost"
                            size="icon-2xs"
                            className="text-destructive"
                            onClick={handleStop}
                            tooltip="Stop"
                            tooltipSide="bottom"
                        >
                            <Square className="h-2 w-2" />
                        </Button>
                    )}
                    <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={onClose}
                        disabled={run.status === "running" || run.status === "paused"}
                        tooltip="Close"
                        tooltipSide="bottom"
                    >
                        <X className="h-3 w-3" />
                    </Button>
                </div>
            </Toolbar>

            {/* Action list */}
            <div className="flex-1 space-y-0.5 overflow-y-auto p-2">
                {run.actions.map((action, i) => (
                    <div
                        key={action.actionEntryId}
                        role="button"
                        tabIndex={0}
                        className={`flex items-center gap-2 rounded px-2 py-1 text-xs ${
                            action.sessionId && workspaceKey ? "cursor-pointer" : ""
                        } ${
                            action.status === "running"
                                ? "border border-blue-800/50 bg-blue-950/40"
                                : ""
                        } ${action.status === "completed" ? "bg-green-950/20" : ""} ${
                            action.status === "failed" ? "bg-red-950/20" : ""
                        } ${
                            action.status === "pending" || action.status === "skipped"
                                ? "opacity-50"
                                : ""
                        }`}
                        onClick={() => handleActionClick(action)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                handleActionClick(action);
                            }
                        }}
                    >
                        <div className="flex h-5 w-5 shrink-0 items-center justify-center">
                            {action.status === "pending" ? (
                                <span className="text-muted-foreground">{i + 1}</span>
                            ) : (
                                statusIcon(action.status)
                            )}
                        </div>
                        <div className="min-w-0 flex-1">
                            <div className="truncate">{getActionName(action, i)}</div>
                            <div className="text-muted-foreground text-[10px]">
                                {getActionSessionType(i)}
                            </div>
                        </div>
                        {action.status === "running" && run.status === "running" && (
                            <Button
                                variant="ghost"
                                size="icon-2xs"
                                onClick={handleSkip}
                                tooltip="Skip"
                                tooltipSide="left"
                            >
                                <SkipForward className="h-2 w-2" />
                            </Button>
                        )}
                        {isFlowDone &&
                            (action.status === "completed" || action.status === "failed") && (
                                <Button
                                    variant="ghost"
                                    size="icon-2xs"
                                    onClick={(e) => handleRerun(e, i)}
                                    tooltip="Re-run"
                                    tooltipSide="left"
                                >
                                    <RotateCcw className="h-2 w-2" />
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
                    {run.artifacts.map((a) => (
                        <div
                            key={`${a.actionEntryId}-${a.createdAt}`}
                            className="flex items-center gap-2 text-xs"
                        >
                            <span className="text-blue-400">&bull;</span>
                            <span>{a.type}</span>
                            <span className="text-muted-foreground min-w-0 flex-1 truncate text-[10px]">
                                {a.path ?? a.text?.slice(0, 40)}
                            </span>
                            {window.taskflow?.saveArtifact && (
                                <Button
                                    variant="ghost"
                                    size="icon-2xs"
                                    tooltip="Download"
                                    tooltipSide="left"
                                    onClick={() => {
                                        const defaultName = a.path
                                            ? (a.path.split("/").pop() ?? a.type)
                                            : `${a.type}.txt`;
                                        void window.taskflow?.saveArtifact({
                                            path: a.path,
                                            text: a.text,
                                            defaultName,
                                        });
                                    }}
                                >
                                    <Download className="h-2.5 w-2.5" />
                                </Button>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {/* Re-run confirmation dialog */}
            <AlertDialog
                open={!!rerunConfirm}
                onOpenChange={(open) => !open && setRerunConfirm(null)}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Re-run action?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Re-run action &quot;{rerunConfirm?.name}&quot;? This will reset all
                            subsequent actions.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={confirmRerun}>Re-run</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}

export { FlowPanel };
