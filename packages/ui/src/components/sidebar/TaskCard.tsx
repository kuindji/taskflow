import { useMemo, useState, useCallback, type MouseEvent } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Archive, ArchiveRestore, GitBranch, Pin, Plus, Trash2 } from "lucide-react";
import type { Task, SessionRef } from "@taskflow/shared";
import { useShallow } from "zustand/react/shallow";
import { useTaskStore } from "@/stores/task-store";
import { useTaskCreationStore } from "@/stores/task-creation-store";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { TruncatedText } from "@/components/ui/truncated-text";
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuSeparator,
    ContextMenuTrigger,
} from "@/components/ui/context-menu";
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
import { cn } from "@/lib/utils";
import { KeyBadge } from "@/components/ui/key-badge";
import { getEventMenuPosition, showNativeMenuAndRun, supportsNativeMenus } from "@/lib/native-menu";
import { SessionBadge } from "./SessionBadge";

const taskCardVariants = cva("px-2.5 py-1.5 rounded-lg cursor-pointer transition-colors", {
    variants: {
        active: {
            true: "bg-accent/15 text-foreground",
            false: "text-secondary-foreground",
        },
    },
    defaultVariants: { active: false },
});

const emptySessions: SessionRef[] = [];

interface TaskCardProps extends VariantProps<typeof taskCardVariants> {
    task: Task;
    isActive: boolean;
    onClick: () => void;
    className?: string;
    archived?: boolean;
    compact?: boolean;
    diffStats?: { additions: number; deletions: number } | null;
    behind?: number;
    keyBadgeNumber?: number;
    isSubtask?: boolean;
    isExpanded?: boolean;
}

export function TaskCard({
    task,
    isActive,
    onClick,
    className,
    archived,
    compact,
    diffStats,
    behind = 0,
    keyBadgeNumber,
    isSubtask,
    isExpanded,
}: TaskCardProps) {
    const [deleteOpen, setDeleteOpen] = useState(false);
    const [deleteWorktree, setDeleteWorktree] = useState(false);
    const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false);
    const [contextMenuOpen, setContextMenuOpen] = useState(false);
    const archiveTask = useTaskStore((s) => s.archiveTask);
    const unarchiveTask = useTaskStore((s) => s.unarchiveTask);
    const deleteTask = useTaskStore((s) => s.deleteTask);
    const updateTask = useTaskStore((s) => s.updateTask);
    const requestNewSubtask = useTaskCreationStore((s) => s.requestNewSubtask);
    const subtaskCount = useTaskStore((s) =>
        isSubtask ? 0 : s.tasks.filter((t) => t.parentId === task.id).length,
    );
    const subtaskSessions = useTaskStore(
        useShallow((s) => {
            if (isSubtask || isExpanded) return emptySessions;
            return s.tasks.filter((t) => t.parentId === task.id).flatMap((t) => t.sessions);
        }),
    );
    const displaySessions = useMemo(
        () => (isExpanded || isSubtask ? task.sessions : [...task.sessions, ...subtaskSessions]),
        [task.sessions, subtaskSessions, isExpanded, isSubtask],
    );
    const hasWorktree = task.worktree.enabled && !!task.worktree.path;
    const nativeMenus = supportsNativeMenus();

    const cardClasses = useMemo(
        () =>
            cn(
                taskCardVariants({ active: isActive }),
                contextMenuOpen && !isActive && "bg-accent/[0.08] text-foreground",
                className,
            ),
        [isActive, contextMenuOpen, className],
    );

    const usingDescriptionAsTitle = !task.title && !!task.description;
    const rawTitle = task.title || task.description || "Untitled";
    const title =
        usingDescriptionAsTitle && rawTitle.length > 50
            ? rawTitle.slice(0, 50) + "\u2026"
            : rawTitle;
    const description = !usingDescriptionAsTitle ? (task.description ?? null) : null;

    const openAddSubtask = useCallback(() => {
        requestNewSubtask(task.id);
    }, [requestNewSubtask, task.id]);

    const handleArchiveConfirm = useCallback(() => {
        void archiveTask(task.id);
    }, [archiveTask, task.id]);

    const openArchive = useCallback(() => {
        if (subtaskCount > 0) {
            setArchiveConfirmOpen(true);
        } else {
            void archiveTask(task.id);
        }
    }, [archiveTask, subtaskCount, task.id]);

    const openUnarchive = useCallback(() => {
        void unarchiveTask(task.id);
    }, [unarchiveTask, task.id]);

    const togglePin = useCallback(() => {
        void updateTask(task.id, { pinned: !task.pinned });
    }, [task.id, task.pinned, updateTask]);

    const openDelete = useCallback(() => {
        setDeleteWorktree(false);
        setDeleteOpen(true);
    }, []);

    const handleDeleteConfirm = useCallback(() => {
        void deleteTask(task.id, hasWorktree ? { deleteWorktree } : undefined);
    }, [deleteTask, task.id, hasWorktree, deleteWorktree]);

    const handleNativeContextMenu = useCallback(
        async (event: MouseEvent<HTMLDivElement>) => {
            event.preventDefault();
            setContextMenuOpen(true);

            try {
                await showNativeMenuAndRun(
                    [
                        ...(!archived && !isSubtask
                            ? [
                                  { id: "add-subtask", label: "Add subtask" as const },
                                  {
                                      id: "toggle-pin",
                                      label: task.pinned ? "Unpin task" : "Pin task",
                                  },
                                  { type: "separator" as const },
                              ]
                            : []),
                        {
                            id: archived ? "unarchive" : "archive",
                            label: archived ? "Unarchive task" : "Archive task",
                        },
                        { id: "delete", label: "Delete task" },
                    ],
                    {
                        "add-subtask": openAddSubtask,
                        "toggle-pin": togglePin,
                        [archived ? "unarchive" : "archive"]: archived
                            ? openUnarchive
                            : openArchive,
                        delete: openDelete,
                    },
                    getEventMenuPosition(event),
                );
            } finally {
                setContextMenuOpen(false);
            }
        },
        [
            archived,
            isSubtask,
            openAddSubtask,
            openArchive,
            openDelete,
            openUnarchive,
            task.pinned,
            togglePin,
        ],
    );

    const cardBody = (
        <div
            role="button"
            tabIndex={0}
            onClick={(e) => {
                e.stopPropagation();
                onClick();
            }}
            onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onClick?.();
                }
            }}
            className={cn(
                cardClasses,
                "ml-3 flex flex-col",
                "group relative min-w-0 overflow-hidden [-webkit-app-region:no-drag]",
                compact && "py-1.5",
                isSubtask && "ml-0.5 py-1.5",
            )}>
            <div className="min-w-0 flex-1">
                <TruncatedText
                    truncate={!!compact}
                    tooltip={!!compact}
                    tooltipSide="right"
                    className={cn(
                        isSubtask ? "text-xs" : "text-sm",
                        isActive && "text-foreground",
                        "leading-normal font-medium",
                    )}>
                    {title}
                </TruncatedText>
            </div>
            {keyBadgeNumber != null && (
                <div className="absolute top-2 right-2">
                    <KeyBadge number={keyBadgeNumber} />
                </div>
            )}
            {!compact && description && (
                <div className="min-w-0 flex-1">
                    <TruncatedText
                        tooltip
                        tooltipSide="right"
                        tooltipDelay={1000}
                        tooltipClassName="max-w-[300px]"
                        className="text-foreground/50 text-xs leading-normal">
                        {description}
                    </TruncatedText>
                </div>
            )}

            {(displaySessions.length > 0 || (!isSubtask && task.worktree.enabled)) && (
                <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-1">
                    {!isSubtask && task.worktree.enabled && (
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Badge
                                    variant="outline"
                                    className="border-border/60 bg-muted/50 min-h-4.5 gap-0.5 px-1 py-0 text-xs font-medium">
                                    <GitBranch className="text-muted-foreground" />
                                    {task.worktree.pr && (
                                        <span className="text-accent">
                                            #{task.worktree.pr.number}
                                        </span>
                                    )}
                                    {behind > 0 && <span className="text-info">↓{behind}</span>}
                                    {diffStats && (
                                        <>
                                            <span className="text-success">
                                                +{diffStats.additions}
                                            </span>
                                            <span className="text-destructive">
                                                -{diffStats.deletions}
                                            </span>
                                        </>
                                    )}
                                </Badge>
                            </TooltipTrigger>
                            <TooltipContent side="right">
                                {task.worktree.branch ?? "pending"}
                            </TooltipContent>
                        </Tooltip>
                    )}
                    {displaySessions.map((session) => (
                        <SessionBadge key={session.id} session={session} />
                    ))}
                </div>
            )}
        </div>
    );

    return (
        <>
            {nativeMenus ? (
                <div style={{ display: "contents" }} onContextMenu={handleNativeContextMenu}>
                    {cardBody}
                </div>
            ) : (
                <ContextMenu onOpenChange={setContextMenuOpen}>
                    <ContextMenuTrigger asChild>{cardBody}</ContextMenuTrigger>
                    <ContextMenuContent>
                        {!archived && !isSubtask && (
                            <>
                                <ContextMenuItem onSelect={openAddSubtask}>
                                    <Plus className="h-3.5 w-3.5" />
                                    Add subtask
                                </ContextMenuItem>
                                <ContextMenuItem onSelect={togglePin}>
                                    <Pin
                                        className={cn("h-3.5 w-3.5", task.pinned && "fill-current")}
                                    />
                                    {task.pinned ? "Unpin task" : "Pin task"}
                                </ContextMenuItem>
                                <ContextMenuSeparator />
                            </>
                        )}
                        {archived ? (
                            <ContextMenuItem onSelect={openUnarchive}>
                                <ArchiveRestore className="h-3.5 w-3.5" />
                                Unarchive task
                            </ContextMenuItem>
                        ) : (
                            <ContextMenuItem onSelect={openArchive}>
                                <Archive className="h-3.5 w-3.5" />
                                Archive task
                            </ContextMenuItem>
                        )}
                        <ContextMenuItem variant="destructive" onSelect={openDelete}>
                            <Trash2 className="h-3.5 w-3.5" />
                            Delete task
                        </ContextMenuItem>
                    </ContextMenuContent>
                </ContextMenu>
            )}
            <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
                <AlertDialogContent onClick={(e: MouseEvent) => e.stopPropagation()}>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete task</AlertDialogTitle>
                        <AlertDialogDescription>
                            {subtaskCount > 0
                                ? `This will permanently delete this task and its ${subtaskCount} subtask${subtaskCount > 1 ? "s" : ""}, their sessions, and all logs. This action cannot be undone.`
                                : "This will permanently delete this task, its sessions, and all logs. This action cannot be undone."}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    {hasWorktree && !isSubtask && (
                        <div className="flex items-center gap-2">
                            <Switch
                                id={`delete-worktree-${task.id}`}
                                checked={deleteWorktree}
                                onCheckedChange={setDeleteWorktree}
                            />
                            <Label
                                htmlFor={`delete-worktree-${task.id}`}
                                className="text-muted-foreground cursor-pointer text-sm tracking-normal normal-case">
                                Also delete worktree and branch ({task.worktree.branch})
                            </Label>
                        </div>
                    )}
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={handleDeleteConfirm}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                            Delete
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
            <AlertDialog open={archiveConfirmOpen} onOpenChange={setArchiveConfirmOpen}>
                <AlertDialogContent onClick={(e: MouseEvent) => e.stopPropagation()}>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Archive task</AlertDialogTitle>
                        <AlertDialogDescription>
                            This task has {subtaskCount} subtask{subtaskCount > 1 ? "s" : ""} that
                            will also be archived. Archive all?
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={handleArchiveConfirm}>
                            Archive
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
}
