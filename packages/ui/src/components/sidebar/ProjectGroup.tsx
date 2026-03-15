import { useState } from "react";
import type { Project, SessionStatus, Task } from "@taskflow/shared";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { StatusDot } from "@/components/ui/status-dot";
import { SessionBadge } from "./SessionBadge";
import { TaskCard } from "./TaskCard";
import { NoDragSpacer } from "./NoDragSpacer";
import { MissingLocationDialog } from "./MissingLocationDialog";
import { AlertTriangle, ArrowRight, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSessionStore } from "@/stores/session-store";

interface ProjectGroupProps {
    project: Project;
    tasks: Task[];
    activeTaskId: string | null;
    isActive: boolean;
    diffStats?: { additions: number; deletions: number } | null;
    diffStatsByTask?: Record<string, { additions: number; deletions: number } | null>;
    onProjectClick: (projectId: string) => void;
    onTaskClick: (taskId: string) => void;
    archived?: boolean;
    compact?: boolean;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function ProjectGroup({
    project,
    tasks,
    activeTaskId,
    isActive,
    diffStats,
    diffStatsByTask,
    onProjectClick,
    onTaskClick,
    archived,
    compact,
    open,
    onOpenChange,
}: ProjectGroupProps) {
    const [missingDialogOpen, setMissingDialogOpen] = useState(false);
    const projectToggleLabel = open ? "Collapse project" : "Expand project";
    const projectStatus = useSessionStore((state) => {
        let hasWorking = false;
        const sessionStatus = state.sessionStatus;

        const getAggregateStatus = (sessionIds: string[]): SessionStatus | undefined => {
            let hasLocalWorking = false;

            for (const sessionId of sessionIds) {
                const status = sessionStatus[sessionId];
                if (status === "attention") return "attention";
                if (status === "working") hasLocalWorking = true;
            }

            return hasLocalWorking ? "working" : undefined;
        };

        const projectLevelStatus = getAggregateStatus(
            project.sessions.map((session) => session.id),
        );
        if (projectLevelStatus === "attention") return "attention";
        if (projectLevelStatus === "working") hasWorking = true;

        for (const task of tasks) {
            const taskStatus = getAggregateStatus(task.sessions.map((session) => session.id));
            if (taskStatus === "attention") return "attention";
            if (taskStatus === "working") hasWorking = true;
        }

        return hasWorking ? "working" : undefined;
    });

    const locationInvalid = project.locationValid === false;

    const handleProjectClick = () => {
        if (locationInvalid) {
            setMissingDialogOpen(true);
        } else {
            onProjectClick(project.id);
        }
    };

    return (
        <>
            <Collapsible open={open} onOpenChange={onOpenChange} className="min-w-0">
                <div
                    className={cn(
                        "group mx-1 flex max-w-[calc(100%-0.75rem)] min-w-0 cursor-pointer items-stretch overflow-hidden rounded-lg transition-colors [-webkit-app-region:no-drag]",
                        isActive && !locationInvalid ? "bg-accent/15" : "hover:bg-muted/50",
                    )}
                >
                    <Tooltip key={projectToggleLabel}>
                        <TooltipTrigger asChild>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onOpenChange(!open);
                                }}
                                aria-label={projectToggleLabel}
                                className="text-muted-foreground flex h-full shrink-0 items-center px-1.5 py-1.5"
                            >
                                {open ? (
                                    <ChevronDown className="h-3.5 w-3.5" />
                                ) : (
                                    <ChevronRight className="h-3.5 w-3.5" />
                                )}
                            </button>
                        </TooltipTrigger>
                        <TooltipContent key={projectToggleLabel} side="right" sideOffset={4}>
                            {projectToggleLabel}
                        </TooltipContent>
                    </Tooltip>
                    <button
                        onClick={handleProjectClick}
                        className="flex w-0 min-w-0 flex-1 cursor-pointer flex-col overflow-hidden py-1.5 pr-1.5 text-left"
                        title={project.name}
                    >
                        <div className="flex min-w-0 items-center gap-1.5">
                            {locationInvalid && (
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <AlertTriangle className="text-warning h-3.5 w-3.5 shrink-0" />
                                    </TooltipTrigger>
                                    <TooltipContent side="right" sideOffset={4}>
                                        Project location not found
                                    </TooltipContent>
                                </Tooltip>
                            )}
                            {!open && !locationInvalid && <StatusDot status={projectStatus} />}
                            <span
                                className={cn(
                                    "block w-full min-w-0 truncate text-xs font-medium tracking-wide",
                                    locationInvalid
                                        ? "text-muted-foreground/60"
                                        : "text-muted-foreground",
                                )}
                            >
                                {project.name}
                            </span>
                        </div>
                        {open && !locationInvalid && project.sessions.length > 0 && (
                            <div className="mt-1.5 flex min-w-0 flex-wrap gap-1">
                                {project.sessions.map((session) => (
                                    <SessionBadge key={session.id} session={session} />
                                ))}
                            </div>
                        )}
                    </button>
                    <div className="relative mr-1.5 flex shrink-0 items-center">
                        {!locationInvalid && diffStats && (
                            <Badge
                                variant="outline"
                                className="border-border/60 bg-muted/50 gap-0.5 px-1.5 py-0 text-[10px] font-medium transition-opacity group-hover:opacity-0"
                            >
                                <span className="text-success">+{diffStats.additions}</span>
                                <span className="text-destructive">-{diffStats.deletions}</span>
                            </Badge>
                        )}
                        {!locationInvalid && (
                            <ArrowRight className="text-accent absolute right-0 h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
                        )}
                    </div>
                </div>
                {!locationInvalid && (
                    <CollapsibleContent>
                        {tasks.map((task) => (
                            <div key={task.id}>
                                <NoDragSpacer />
                                <TaskCard
                                    task={task}
                                    isActive={task.id === activeTaskId}
                                    onClick={() => onTaskClick(task.id)}
                                    archived={archived}
                                    compact={compact}
                                    diffStats={diffStatsByTask?.[task.id]}
                                />
                            </div>
                        ))}
                    </CollapsibleContent>
                )}
            </Collapsible>

            <MissingLocationDialog
                project={project}
                open={missingDialogOpen}
                onOpenChange={setMissingDialogOpen}
            />
        </>
    );
}
