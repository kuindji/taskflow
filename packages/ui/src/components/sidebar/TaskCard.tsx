import { useMemo, useState, useCallback, type MouseEvent } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Archive, ArchiveRestore, GitBranch, Trash2 } from "lucide-react";
import type { SessionRef, Task } from "@taskflow/shared";
import { useSessionStore } from "@/stores/session-store";
import { useTaskStore } from "@/stores/task-store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusDot } from "@/components/ui/status-dot";
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
    const description =
        !usingDescriptionAsTitle && task.description
            ? task.description.length > 60
                ? task.description.slice(0, 60) + "\u2026"
                : task.description
            : null;

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
                <div
                    className={cn(
                        "text-sm font-medium",
                        isActive && "text-foreground",
                        compact && "truncate",
                    )}
                    title={compact ? rawTitle : undefined}
                >
                    {title}
                </div>
                {!compact && description && (
                    <div className="text-muted-foreground mt-0.5 line-clamp-1 text-xs">
                        {description}
                    </div>
                )}
                {(task.sessions.length > 0 || task.worktree.enabled) && (
                    <div className="mt-1.5 flex min-w-0 gap-1.5">
                        {task.worktree.enabled && (
                            <Badge
                                variant="outline"
                                className="text-muted-foreground min-w-0 max-w-full truncate px-1 py-0 text-xs"
                            >
                                <GitBranch className="mr-0.5 h-3 w-3 shrink-0" />
                                <span className="truncate">
                                    {task.worktree.branch ?? "pending"}
                                </span>
                            </Badge>
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
                        <label className="flex cursor-pointer items-center gap-2 text-sm">
                            <input
                                type="checkbox"
                                checked={deleteWorktree}
                                onChange={(e) => setDeleteWorktree(e.target.checked)}
                                className="rounded"
                            />
                            <span className="text-muted-foreground">
                                Also delete worktree and branch ({task.worktree.branch})
                            </span>
                        </label>
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
