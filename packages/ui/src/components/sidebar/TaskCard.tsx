import { useMemo, useState, useCallback, type MouseEvent } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Archive, ArchiveRestore, GitBranch, Trash2 } from "lucide-react";
import type { SessionRef, Task } from "@taskflow/shared";
import { useSessionStore } from "@/stores/session-store";
import { useTaskStore } from "@/stores/task-store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { StatusDot } from "@/components/ui/status-dot";
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
}

function SessionBadge({ session }: { session: SessionRef }) {
    const status = useSessionStore((s) => s.sessionStatus[session.id]);

    return (
        <Badge
            variant="outline"
            colorScheme={session.type === "claude" ? "claude" : "codex"}
            className="px-1 py-0 text-xs"
        >
            <StatusDot status={status} className="mr-0.5" />
            {session.type}
        </Badge>
    );
}

export function TaskCard({ task, isActive, onClick, className, archived, compact }: TaskCardProps) {
    const [deleteOpen, setDeleteOpen] = useState(false);
    const [deleteWorktree, setDeleteWorktree] = useState(false);
    const archiveTask = useTaskStore((s) => s.archiveTask);
    const unarchiveTask = useTaskStore((s) => s.unarchiveTask);
    const deleteTask = useTaskStore((s) => s.deleteTask);
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
    const description = !usingDescriptionAsTitle ? task.description ?? null : null;

    const handleArchive = (e: MouseEvent) => {
        e.stopPropagation();
        void archiveTask(task.id);
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
                )}
            >
                <TruncatedText
                    truncate={!!compact}
                    tooltip={!!compact}
                    tooltipSide="right"
                    className={cn(
                        "text-sm font-medium",
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
                {(task.sessions.length > 0 || task.worktree.enabled) && (
                    <div className="mt-1.5 flex min-w-0 gap-1.5">
                        {task.worktree.enabled && (
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <div className="text-muted-foreground flex items-center">
                                        <GitBranch className="h-3.5 w-3.5" />
                                    </div>
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
                            This will permanently delete this task, its sessions, and all logs. This
                            action cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    {hasWorktree && (
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
        </>
    );
}
