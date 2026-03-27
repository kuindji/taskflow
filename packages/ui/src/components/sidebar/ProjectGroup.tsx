import { Fragment, useMemo, useState, type MouseEvent } from "react";
import type { Project, SessionStatus, Task } from "@taskflow/shared";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { StatusDot } from "@/components/ui/status-dot";
import { SessionBadge } from "./SessionBadge";
import { TaskCard } from "./TaskCard";
import { NoDragSpacer } from "./NoDragSpacer";
import { MissingLocationDialog } from "./MissingLocationDialog";
import { AlertTriangle, ChevronRight, GitFork, Play, Plus, Trash2 } from "lucide-react";
import { KeyBadge } from "@/components/ui/key-badge";
import { cn } from "@/lib/utils";
import { useSessionStore } from "@/stores/session-store";
import { useDiffStore } from "@/stores/diff-store";
import { useTaskCreationStore } from "@/stores/task-creation-store";
import { useProjectStore } from "@/stores/project-store";
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuLabel,
    ContextMenuSeparator,
    ContextMenuSub,
    ContextMenuSubContent,
    ContextMenuSubTrigger,
    ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { ForkProjectDialog } from "@/components/workspace/ForkProjectDialog";
import { RemoveProjectDialog } from "@/components/workspace/RemoveProjectDialog";
import { FlowInputDialog } from "@/components/flows/FlowInputDialog";
import { RunMenuItems } from "@/components/shared/RunMenuItems";
import type { MenuComponents } from "@/components/shared/RunMenuItems";
import { getEventMenuPosition, showNativeMenuAndRun, supportsNativeMenus } from "@/lib/native-menu";
import { buildNativeRunMenuItems } from "@/lib/run-menu";
import { useRunMenu } from "@/hooks/useRunMenu";

const contextMenuComponents: MenuComponents = {
    Sub: ContextMenuSub,
    SubTrigger: ContextMenuSubTrigger,
    SubContent: ContextMenuSubContent,
    Item: ContextMenuItem,
    Separator: ContextMenuSeparator,
    Label: ContextMenuLabel,
};

interface ProjectGroupProps {
    project: Project;
    tasks: Task[];
    activeTaskId: string | null;
    isActive: boolean;
    diffStats?: { additions: number; deletions: number } | null;
    diffStatsByTask?: Record<string, { additions: number; deletions: number } | null>;
    behind?: number;
    behindByTask?: Record<string, number>;
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
    behind = 0,
    behindByTask,
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
    const [forkOpen, setForkOpen] = useState(false);
    const [removeOpen, setRemoveOpen] = useState(false);
    const [contextMenuOpen, setContextMenuOpen] = useState(false);
    const requestNewTask = useTaskCreationStore((s) => s.requestNewTask);
    const hideProject = useProjectStore((s) => s.hideProject);
    const removeProject = useProjectStore((s) => s.removeProject);
    const nativeMenus = supportsNativeMenus();
    const runMenu = useRunMenu({
        projectId: project.id,
        projectPath: project.path,
        showAgentOptions: false,
        enabled: contextMenuOpen,
    });

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

    const handleCreateTask = () => {
        requestNewTask(project.id);
    };

    const handleNativeContextMenu = async (event: MouseEvent<HTMLDivElement>) => {
        event.preventDefault();
        setContextMenuOpen(true);

        try {
            const { items: runItems, actions: runActions } = buildNativeRunMenuItems(
                runMenu.data,
                runMenu.callbacks,
            );

            await showNativeMenuAndRun(
                [
                    { id: "create-task", label: "Create task" },
                    { id: "fork-project", label: "Fork project" },
                    ...(runItems.length > 0
                        ? [
                              { type: "separator" as const },
                              {
                                  type: "submenu" as const,
                                  label: "Run",
                                  submenu: runItems,
                              },
                          ]
                        : []),
                    { type: "separator" },
                    { id: "delete-project", label: "Delete project" },
                ],
                {
                    "create-task": handleCreateTask,
                    "fork-project": () => setForkOpen(true),
                    "delete-project": () => setRemoveOpen(true),
                    ...runActions,
                },
                getEventMenuPosition(event),
            );
        } finally {
            setContextMenuOpen(false);
        }
    };

    const projectHeader = (
        <div
            className={cn(
                "group flex min-w-0 flex-col overflow-hidden",
                "rounded-lg transition-colors duration-300 [-webkit-app-region:no-drag]",
                (isActive || contextMenuOpen) && !locationInvalid
                    ? isActive
                        ? "bg-accent/15"
                        : "bg-accent/8"
                    : open
                      ? "hover:bg-accent/5"
                      : "hover:bg-accent/5",
            )}>
            <div className="flex items-center">
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        onOpenChange(!open);
                    }}
                    aria-label={projectToggleLabel}
                    className="text-foreground flex shrink-0 items-center px-1">
                    <ChevronRight
                        className={cn("h-3.5 w-3.5 duration-200", open ? "rotate-90" : "")}
                    />
                </button>
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        handleProjectClick();
                    }}
                    className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 overflow-hidden py-1.5 pr-1.5 text-left"
                    title={project.name}>
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
                            "block min-w-0 truncate text-sm font-medium tracking-wide",
                            locationInvalid ? "text-foreground/50" : "text-foreground",
                        )}>
                        {project.name}
                    </span>
                    {!locationInvalid && branch && (
                        <span className="text-foreground/40 shrink-0 truncate text-xs">
                            ({branch})
                        </span>
                    )}
                </button>
                {!locationInvalid && (keyBadgeNumber != null || diffStats || behind > 0) && (
                    <div className="relative mr-1.5 flex shrink-0 items-center">
                        {keyBadgeNumber != null ? (
                            <KeyBadge number={keyBadgeNumber} />
                        ) : (
                            <Badge
                                variant="outline"
                                className="border-border/60 bg-muted/50 gap-0.5 px-1.5 py-0 text-[10px] font-medium">
                                {behind > 0 && <span className="text-info">↓{behind}</span>}
                                {diffStats && (
                                    <>
                                        <span className="text-success">+{diffStats.additions}</span>
                                        <span className="text-destructive">
                                            -{diffStats.deletions}
                                        </span>
                                    </>
                                )}
                            </Badge>
                        )}
                    </div>
                )}
            </div>
            {open && !locationInvalid && project.sessions.length > 0 && (
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        handleProjectClick();
                    }}
                    className="min-w-0 cursor-pointer pr-1.5 pb-1.5 pl-5.5 text-left"
                    title={project.name}>
                    <div className="flex min-w-0 flex-wrap gap-1">
                        {project.sessions.map((session) => (
                            <SessionBadge key={session.id} session={session} />
                        ))}
                    </div>
                </button>
            )}
        </div>
    );

    //max-w-[calc(100%-0.75rem)]
    return (
        <>
            <Collapsible
                open={open}
                onOpenChange={onOpenChange}
                className={cn(
                    "min-w-0 rounded-lg border border-transparent",
                    // open && topLevelTasks.length > 0 ? "border border-white/50" : ""
                )}>
                {nativeMenus ? (
                    <div style={{ display: "contents" }} onContextMenu={handleNativeContextMenu}>
                        {projectHeader}
                    </div>
                ) : (
                    <ContextMenu onOpenChange={setContextMenuOpen}>
                        <ContextMenuTrigger asChild>{projectHeader}</ContextMenuTrigger>
                        <ContextMenuContent>
                            <ContextMenuItem onSelect={handleCreateTask}>
                                <Plus className="h-4 w-4" />
                                Create task
                            </ContextMenuItem>
                            <ContextMenuItem onSelect={() => setForkOpen(true)}>
                                <GitFork className="h-4 w-4" />
                                Fork project
                            </ContextMenuItem>
                            {runMenu.hasItems && (
                                <>
                                    <ContextMenuSeparator />
                                    <ContextMenuSub>
                                        <ContextMenuSubTrigger>
                                            <Play className="h-4 w-4" />
                                            Run
                                        </ContextMenuSubTrigger>
                                        <ContextMenuSubContent>
                                            <RunMenuItems
                                                data={runMenu.data}
                                                callbacks={runMenu.callbacks}
                                                components={contextMenuComponents}
                                            />
                                        </ContextMenuSubContent>
                                    </ContextMenuSub>
                                </>
                            )}
                            <ContextMenuSeparator />
                            <ContextMenuItem
                                variant="destructive"
                                onSelect={() => setRemoveOpen(true)}>
                                <Trash2 className="h-4 w-4" />
                                Delete project
                            </ContextMenuItem>
                        </ContextMenuContent>
                    </ContextMenu>
                )}
                {!locationInvalid && (
                    <CollapsibleContent
                        className={
                            cn()

                            // topLevelTasks.length > 0 ? "border-border/40 mb-0.5 border-b pb-1" : "",
                        }>
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
                                        projectId={project.id}
                                        projectPath={project.path}
                                        isActive={task.id === activeTaskId}
                                        onClick={() => onTaskClick(task.id)}
                                        archived={archived}
                                        compact={compact}
                                        diffStats={diffStatsByTask?.[task.id]}
                                        behind={behindByTask?.[task.id] ?? 0}
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
                                                        projectId={project.id}
                                                        projectPath={project.path}
                                                        isActive={subtask.id === activeTaskId}
                                                        onClick={() => onTaskClick(subtask.id)}
                                                        archived={archived}
                                                        compact={compact}
                                                        diffStats={diffStatsByTask?.[subtask.id]}
                                                        behind={behindByTask?.[subtask.id] ?? 0}
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
            <ForkProjectDialog open={forkOpen} onOpenChange={setForkOpen} project={project} />
            <RemoveProjectDialog
                open={removeOpen}
                project={project}
                onOpenChange={setRemoveOpen}
                onRemove={removeProject}
                onHide={hideProject}
            />
            {runMenu.flowInputState && (
                <FlowInputDialog
                    open
                    flowName={runMenu.flowInputState.flowName}
                    inputs={runMenu.flowInputState.inputs}
                    onSubmit={runMenu.onFlowInputSubmit}
                    onCancel={runMenu.onFlowInputCancel}
                />
            )}
        </>
    );
}
