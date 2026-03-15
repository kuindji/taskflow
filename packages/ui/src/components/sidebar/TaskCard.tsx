import { useMemo, useState, useCallback, type MouseEvent } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Archive, ArchiveRestore, ChevronRight, GitBranch, Plus, Trash2 } from "lucide-react";
import type { Task } from "@taskflow/shared";
import { useTaskStore } from "@/stores/task-store";
import { useTaskCreationStore } from "@/stores/task-creation-store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { TruncatedText } from "@/components/ui/truncated-text";
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
import { SessionBadge } from "./SessionBadge";

const taskCardVariants = cva(
    "px-3 py-2.5 mx-1.5 my-0.5 rounded-lg cursor-pointer transition-colors",
    {
        variants: {
            active: {
                true: "bg-accent/15 text-foreground",
                false: "text-secondary-foreground hover:bg-muted/50",
            },
        },
        defaultVariants: { active: false },
    },
);

interface TaskCardProps extends VariantProps<typeof taskCardVariants> {
    task: Task;
    isActive: boolean;
    onClick: () => void;
    className?: string;
    archived?: boolean;
    compact?: boolean;
    diffStats?: { additions: number; deletions: number } | null;
    hasSubtasks?: boolean;
    isExpanded?: boolean;
    onToggleExpand?: () => void;
    isSubtask?: boolean;
}

export function TaskCard({
    task,
    isActive,
    onClick,
    className,
    archived,
    compact,
    diffStats,
    hasSubtasks,
    isExpanded,
    onToggleExpand,
    isSubtask,
}: TaskCardProps) {
    const [deleteOpen, setDeleteOpen] = useState(false);
    const [deleteWorktree, setDeleteWorktree] = useState(false);
    const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false);
    const archiveTask = useTaskStore((s) => s.archiveTask);
    const unarchiveTask = useTaskStore((s) => s.unarchiveTask);
    const deleteTask = useTaskStore((s) => s.deleteTask);
    const requestNewSubtask = useTaskCreationStore((s) => s.requestNewSubtask);
    const subtaskCount = useTaskStore((s) =>
        isSubtask ? 0 : s.tasks.filter((t) => t.parentId === task.id).length,
    );
    const hasWorktree = task.worktree.enabled && !!task.worktree.path;

    const cardClasses = useMemo(
        () => cn(taskCardVariants({ active: isActive }), className),
        [isActive, className],
    );

    const usingDescriptionAsTitle = !task.title && !!task.description;
    const rawTitle = task.title || task.description || "Untitled";
    const title =
        usingDescriptionAsTitle && rawTitle.length > 50
            ? rawTitle.slice(0, 50) + "\u2026"
            : rawTitle;
    const description = !usingDescriptionAsTitle ? (task.description ?? null) : null;

    const handleAddSubtask = (e: MouseEvent) => {
        e.stopPropagation();
        requestNewSubtask(task.id);
    };

    const handleArchiveConfirm = useCallback(() => {
        void archiveTask(task.id);
    }, [archiveTask, task.id]);

    const handleArchive = (e: MouseEvent) => {
        e.stopPropagation();
        if (subtaskCount > 0) {
            setArchiveConfirmOpen(true);
        } else {
            void archiveTask(task.id);
        }
    };

    const handleUnarchive = (e: MouseEvent) => {
        e.stopPropagation();
        void unarchiveTask(task.id);
    };

    const handleDeleteClick = (e: MouseEvent) => {
        e.stopPropagation();
        setDeleteWorktree(false);
        setDeleteOpen(true);
    };

    const handleDeleteConfirm = useCallback(() => {
        void deleteTask(task.id, hasWorktree ? { deleteWorktree } : undefined);
    }, [deleteTask, task.id, hasWorktree, deleteWorktree]);

    return (
        <>
            <div
                onClick={onClick}
                className={cn(
                    cardClasses,
                    "group relative min-w-0 overflow-hidden [-webkit-app-region:no-drag]",
                    compact && "py-1.5",
                    isSubtask && "py-1.5",
                )}
            >
                <div className="flex items-start gap-1">
                    {hasSubtasks && (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                onToggleExpand?.();
                            }}
                            className="text-muted-foreground mt-0.5 shrink-0 p-0"
                            aria-label={isExpanded ? "Collapse subtasks" : "Expand subtasks"}
                        >
                            <ChevronRight
                                className={cn(
                                    "h-3.5 w-3.5 transition-transform",
                                    isExpanded && "rotate-90",
                                )}
                            />
                        </button>
                    )}
                    <div className="min-w-0 flex-1">
                        <TruncatedText
                            truncate={!!compact}
                            tooltip={!!compact}
                            tooltipSide="right"
                            className={cn(
                                "font-medium",
                                isSubtask ? "text-xs" : "text-sm",
                                isActive && "text-foreground",
                            )}
                        >
                            {title}
                        </TruncatedText>
                        {!compact && description && (
                            <TruncatedText className="text-muted-foreground mt-0.5 text-xs">
                                {description}
                            </TruncatedText>
                        )}
                    </div>
                </div>
                {(task.sessions.length > 0 || (!isSubtask && task.worktree.enabled)) && (
                    <div className="mt-1.5 flex min-w-0 gap-1.5">
                        {!isSubtask && task.worktree.enabled && (
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Badge
                                        variant="outline"
                                        className="border-border/60 bg-muted/50 gap-0.5 px-1 py-0 text-[10px] font-medium"
                                    >
                                        <GitBranch className="text-muted-foreground h-3 w-3" />
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
                        {task.sessions.map((session) => (
                            <SessionBadge key={session.id} session={session} />
                        ))}
                    </div>
                )}
                <div className="absolute right-1 bottom-1 flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                    {!archived && !isSubtask && (
                        <Button
                            variant="ghost"
                            size="xs"
                            onClick={handleAddSubtask}
                            className="border-border/60 bg-background text-muted-foreground hover:bg-accent hover:text-foreground h-6 w-6 border p-0 shadow-xs"
                            aria-label="Add subtask"
                            tooltip="Add subtask"
                            tooltipSide="top"
                        >
                            <Plus className="h-3.5 w-3.5" />
                        </Button>
                    )}
                    {archived ? (
                        <Button
                            variant="ghost"
                            size="xs"
                            onClick={handleUnarchive}
                            className="border-border/60 bg-background text-muted-foreground hover:bg-accent hover:text-foreground h-6 w-6 border p-0 shadow-xs"
                            aria-label="Unarchive task"
                            tooltip="Unarchive task"
                            tooltipSide="top"
                        >
                            <ArchiveRestore className="h-3.5 w-3.5" />
                        </Button>
                    ) : (
                        <Button
                            variant="ghost"
                            size="xs"
                            onClick={handleArchive}
                            className="border-border/60 bg-background text-muted-foreground hover:bg-accent hover:text-foreground h-6 w-6 border p-0 shadow-xs"
                            aria-label="Archive task"
                            tooltip="Archive task"
                            tooltipSide="top"
                        >
                            <Archive className="h-3.5 w-3.5" />
                        </Button>
                    )}
                    <Button
                        variant="ghost"
                        size="xs"
                        onClick={handleDeleteClick}
                        className="border-border/60 bg-background text-muted-foreground hover:bg-accent hover:text-destructive h-6 w-6 border p-0 shadow-xs"
                        aria-label="Delete task"
                        tooltip="Delete task"
                        tooltipSide="top"
                    >
                        <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                </div>
            </div>
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
                                className="text-muted-foreground cursor-pointer text-sm tracking-normal normal-case"
                            >
                                Also delete worktree and branch ({task.worktree.branch})
                            </Label>
                        </div>
                    )}
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={handleDeleteConfirm}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
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
