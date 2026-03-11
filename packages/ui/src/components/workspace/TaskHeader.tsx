import { useCallback } from "react";
import type { Task, Project } from "@taskflow/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useUIStore } from "@/stores/ui-store";
import { useTaskStore } from "@/stores/task-store";
import { confirm } from "@/stores/dialog-store";
import {
    Archive,
    Trash2,
    PanelLeftClose,
    PanelLeftOpen,
    PanelRightClose,
    PanelRightOpen,
} from "lucide-react";

interface TaskHeaderProps {
    task: Task;
    project: Project | undefined;
}

export function TaskHeader({ task, project }: TaskHeaderProps) {
    const fileExplorerOpen = useUIStore((s) => s.fileExplorerOpen);
    const taskInfoOpen = useUIStore((s) => s.taskInfoOpen);
    const toggleFileExplorer = useUIStore((s) => s.toggleFileExplorer);
    const toggleTaskInfo = useUIStore((s) => s.toggleTaskInfo);
    const archiveTask = useTaskStore((s) => s.archiveTask);
    const deleteTask = useTaskStore((s) => s.deleteTask);

    const handleArchive = useCallback(() => {
        void confirm({
            title: "Archive task",
            description: `Archive "${task.title}"? You can restore it later.`,
            confirmLabel: "Archive",
            onConfirm: () => archiveTask(task.id),
        });
    }, [task.id, task.title, archiveTask]);

    const handleDelete = useCallback(() => {
        void confirm({
            title: "Delete task",
            description: `Permanently delete "${task.title}"? This cannot be undone.`,
            confirmLabel: "Delete",
            variant: "destructive",
            onConfirm: () => deleteTask(task.id),
        });
    }, [task.id, task.title, deleteTask]);

    return (
        <div className="border-border flex items-center gap-2 border-b px-3 py-1.5">
            <Button
                variant="ghost"
                size="icon-sm"
                onClick={toggleFileExplorer}
                aria-label={fileExplorerOpen ? "Hide file explorer" : "Show file explorer"}
            >
                {fileExplorerOpen ? (
                    <PanelLeftClose className="h-3.5 w-3.5" />
                ) : (
                    <PanelLeftOpen className="h-3.5 w-3.5" />
                )}
            </Button>
            <span className="text-foreground text-[13px] font-bold">{task.title}</span>
            <span className="text-muted-foreground text-[11px]">{project?.name}</span>
            {task.worktree?.branch && (
                <Badge variant="outline" className="px-1.5 py-0 text-[9px]">
                    {task.worktree.branch}
                </Badge>
            )}
            <div className="flex-1" />
            <Button
                variant="ghost"
                size="icon-sm"
                onClick={handleArchive}
                aria-label="Archive task"
            >
                <Archive className="h-3.5 w-3.5" />
            </Button>
            <Button
                variant="ghost"
                size="icon-sm"
                onClick={handleDelete}
                aria-label="Delete task"
                className="text-destructive hover:text-destructive"
            >
                <Trash2 className="h-3.5 w-3.5" />
            </Button>
            <Button
                variant="ghost"
                size="icon-sm"
                onClick={toggleTaskInfo}
                aria-label={taskInfoOpen ? "Hide task info" : "Show task info"}
            >
                {taskInfoOpen ? (
                    <PanelRightClose className="h-3.5 w-3.5" />
                ) : (
                    <PanelRightOpen className="h-3.5 w-3.5" />
                )}
            </Button>
        </div>
    );
}
