import { Fragment, useMemo, useState } from "react";
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
import { KeyBadge } from "@/components/ui/key-badge";
import { cn } from "@/lib/utils";
import { useSessionStore } from "@/stores/session-store";
import { useDiffStore } from "@/stores/diff-store";

interface ProjectGroupProps {
    project: Project;
    tasks: Task[];
    activeTaskId: string | null;
    isActive: boolean;
    diffStats?: { additions: number; deletions: number } | null;
    diffStatsByTask?: Record<string, { additions: number; deletions: number } | null>;
    keyBadgeNumber?: number;
    taskKeyBadges?: Record<string, number>;
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
    keyBadgeNumber,
    taskKeyBadges,
    onProjectClick,
    onTaskClick,
    archived,
    compact,
    open,
    onOpenChange,
}: ProjectGroupProps) {
    const [missingDialogOpen, setMissingDialogOpen] = useState(false);

    const { topLevelTasks, subtaskMap } = useMemo(() => {
        const topLevel: Task[] = [];
        const subtasks = new Map<string, Task[]>();
        for (const task of tasks) {
            if (task.parentId) {
                const list = subtasks.get(task.parentId) ?? [];
                list.push(task);
                subtasks.set(task.parentId, list);
            } else {
                topLevel.push(task);
            }
        }
        return { topLevelTasks: topLevel, subtaskMap: subtasks };
    }, [tasks]);

    const activeSubtaskParentIds = useMemo(() => {
        const ids = new Set<string>();
        if (!activeTaskId) return ids;
        for (const [parentId, subs] of subtaskMap) {
            if (parentId === activeTaskId || subs.some((s) => s.id === activeTaskId)) {
                ids.add(parentId);
            }
        }
        return ids;
    }, [activeTaskId, subtaskMap]);

    const projectToggleLabel = open ? "Collapse project" : "Expand project";
    const projectStatus = useSessionStore((state) => {
        let hasWorking = false;
        const sessionStatus = state.sessionStatus;

        const getAggregateStatus = (sessionIds: string[]): SessionStatus | undefined => {
            let hasLocalWorking = false;
            let hasInitializing = false;

            for (const sessionId of sessionIds) {
                const status = sessionStatus[sessionId];
                if (status === "attention") return "attention";
                if (status === "working") hasLocalWorking = true;
                if (status === "initializing") hasInitializing = true;
            }

            if (hasLocalWorking) return "working";
            if (hasInitializing) return "initializing";
            return undefined;
        };

        let hasInitializing = false;

        const projectLevelStatus = getAggregateStatus(
            project.sessions.map((session) => session.id),
        );
        if (projectLevelStatus === "attention") return "attention";
        if (projectLevelStatus === "working") hasWorking = true;
        if (projectLevelStatus === "initializing") hasInitializing = true;

        for (const task of tasks) {
            const taskStatus = getAggregateStatus(task.sessions.map((session) => session.id));
            if (taskStatus === "attention") return "attention";
            if (taskStatus === "working") hasWorking = true;
            if (taskStatus === "initializing") hasInitializing = true;
        }

        if (hasWorking) return "working";
        if (hasInitializing) return "initializing";
        return undefined;
    });

    const branch = useDiffStore((s) => s.branchByProject[project.id] ?? null);

    const hasAgents = project.sessions.length > 0 || tasks.some((t) => t.sessions.length > 0);

    const locationInvalid = project.locationValid === false;

    const handleProjectClick = () => {
        if (locationInvalid) {
            setMissingDialogOpen(true);
        } else {
            onProjectClick(project.id);
        }
    };

    //max-w-[calc(100%-0.75rem)]
    return (
        <>
            <Collapsible open={open} onOpenChange={onOpenChange} className="min-w-0">
                <div
                    className={cn(
                        "group mx-1.5 flex min-w-0 cursor-pointer items-center overflow-hidden rounded-lg transition-colors [-webkit-app-region:no-drag]",
                        isActive && !locationInvalid ? "bg-accent/15" : "hover:bg-muted/50",
                    )}>
                    <Tooltip key={projectToggleLabel}>
                        <TooltipTrigger asChild>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onOpenChange(!open);
                                }}
                                aria-label={projectToggleLabel}
                                className="text-muted-foreground flex h-full shrink-0 items-center px-1">
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
                        title={project.name}>
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
                            {!open &&
                                !locationInvalid &&
                                (projectStatus ? (
                                    <StatusDot status={projectStatus} />
                                ) : (
                                    hasAgents && (
                                        <span className="bg-muted-foreground/30 inline-block h-2 w-2 shrink-0 rounded-full" />
                                    )
                                ))}
                            <span
                                className={cn(
                                    "block min-w-0 truncate text-xs font-medium tracking-wide",
                                    locationInvalid ? "text-foreground/40" : "text-foreground/60",
                                )}>
                                {project.name}
                            </span>
                            {!locationInvalid && branch && (
                                <span className="text-foreground/40 shrink-0 truncate text-[10px]">
                                    ({branch})
                                </span>
                            )}
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
                        {keyBadgeNumber == null && !locationInvalid && diffStats && (
                            <Badge
                                variant="outline"
                                className="border-border/60 bg-muted/50 gap-0.5 px-1.5 py-0 text-[10px] font-medium transition-opacity group-hover:opacity-0">
                                <span className="text-success">+{diffStats.additions}</span>
                                <span className="text-destructive">-{diffStats.deletions}</span>
                            </Badge>
                        )}
                        {keyBadgeNumber != null ? (
                            <KeyBadge number={keyBadgeNumber} />
                        ) : (
                            !locationInvalid && (
                                <ArrowRight className="text-accent absolute right-0 h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
                            )
                        )}
                    </div>
                </div>
                {!locationInvalid && (
                    <CollapsibleContent
                        className={cn(
                            topLevelTasks.length > 0 ? "border-border/40 mb-1 border-b pb-1.5" : "",
                        )}>
                        {topLevelTasks.map((task, index) => {
                            const subtasks = subtaskMap.get(task.id);
                            const hasSubtasks = !!subtasks && subtasks.length > 0;
                            const isExpanded = activeSubtaskParentIds.has(task.id);
                            const prevTask = index > 0 ? topLevelTasks[index - 1] : null;
                            const showPinnedSeparator = prevTask?.pinned === true && !task.pinned;

                            return (
                                <div key={task.id}>
                                    {showPinnedSeparator && (
                                        <div className="border-border/40 mx-3 mt-1 mb-0.25 border-t" />
                                    )}
                                    <NoDragSpacer />
                                    <TaskCard
                                        task={task}
                                        isActive={task.id === activeTaskId}
                                        onClick={() => onTaskClick(task.id)}
                                        archived={archived}
                                        compact={compact}
                                        diffStats={diffStatsByTask?.[task.id]}
                                        isSubtask={false}
                                        isExpanded={hasSubtasks && isExpanded}
                                        keyBadgeNumber={taskKeyBadges?.[task.id]}
                                    />
                                    {hasSubtasks && isExpanded && (
                                        <div className="pl-4">
                                            {subtasks.map((subtask) => (
                                                <Fragment key={subtask.id}>
                                                    <NoDragSpacer />
                                                    <TaskCard
                                                        task={subtask}
                                                        isActive={subtask.id === activeTaskId}
                                                        onClick={() => onTaskClick(subtask.id)}
                                                        archived={archived}
                                                        compact={compact}
                                                        diffStats={diffStatsByTask?.[subtask.id]}
                                                        isSubtask={true}
                                                    />
                                                </Fragment>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
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
