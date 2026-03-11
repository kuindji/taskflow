import { useCallback } from "react";
import type { Task, Project } from "@taskflow/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useUIStore } from "@/stores/ui-store";
import { useTaskStore } from "@/stores/task-store";
import { confirm } from "@/stores/dialog-store";
import {
    Archive,
    Plus,
    Trash2,
    PanelLeftClose,
    PanelLeftOpen,
    PanelRightClose,
    PanelRightOpen,
} from "lucide-react";
import useIsElectron from "@/hooks/useIsElectron";
import { NewTaskControl } from "@/components/sidebar/NewTaskControl";

interface TaskHeaderProps {
    task?: Task;
    project?: Project;
}

export function TaskHeader({ task, project }: TaskHeaderProps) {
    const fileExplorerOpen = useUIStore((s) => s.fileExplorerOpen);
    const taskInfoOpen = useUIStore((s) => s.taskInfoOpen);
    const toggleFileExplorer = useUIStore((s) => s.toggleFileExplorer);
    const toggleTaskInfo = useUIStore((s) => s.toggleTaskInfo);
    const archiveTask = useTaskStore((s) => s.archiveTask);
    const deleteTask = useTaskStore((s) => s.deleteTask);
    const isElectron = useIsElectron();

    const handleArchive = useCallback(() => {
        if (!task) return;
        void confirm({
            title: "Archive task",
            description: `Archive "${task.title}"? You can restore it later.`,
            confirmLabel: "Archive",
            onConfirm: () => archiveTask(task.id),
        });
    }, [archiveTask, task]);

    const handleDelete = useCallback(() => {
        if (!task) return;
        void confirm({
            title: "Delete task",
            description: `Permanently delete "${task.title}"? This cannot be undone.`,
            confirmLabel: "Delete",
            variant: "destructive",
            onConfirm: () => deleteTask(task.id),
        });
    }, [deleteTask, task]);

    return (
        <div className={`border-border flex items-center gap-1.5 border-b px-1.5 py-1.5 ${isElectron ? "[-webkit-app-region:drag]" : ""}`}>
            {task ? (
                <>
                    <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={toggleFileExplorer}
                        aria-label={fileExplorerOpen ? "Hide file explorer" : "Show file explorer"}
                        className="[-webkit-app-region:no-drag]"
                    >
                        {fileExplorerOpen ? (
                            <PanelLeftClose className="h-4 w-4" />
                        ) : (
                            <PanelLeftOpen className="h-4 w-4" />
                        )}
                    </Button>
                    <span className="text-foreground text-sm font-semibold">{task.title}</span>
                    <span className="text-muted-foreground text-sm">{project?.name}</span>
                    {task.worktree?.branch && (
                        <Badge variant="outline" className="px-2 py-0.5 text-xs [-webkit-app-region:no-drag]">
                            {task.worktree.branch}
                        </Badge>
                    )}
                </>
            ) : (
                <div className="flex items-center gap-1.5">
                    <Plus className="text-muted-foreground h-3.5 w-3.5" />
                    <span className="text-muted-foreground text-sm">No task selected</span>
                </div>
            )}
            <div className="flex-1" />
            {isElectron && <NewTaskControl className="pr-1" />}
            {task && (
                <>
                    <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={handleArchive}
                        aria-label="Archive task"
                        className="[-webkit-app-region:no-drag]"
                    >
                        <Archive className="h-4 w-4" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={handleDelete}
                        aria-label="Delete task"
                        className="text-destructive hover:text-destructive [-webkit-app-region:no-drag]"
                    >
                        <Trash2 className="h-4 w-4" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={toggleTaskInfo}
                        aria-label={taskInfoOpen ? "Hide task info" : "Show task info"}
                        className="[-webkit-app-region:no-drag]"
                    >
                        {taskInfoOpen ? (
                            <PanelRightClose className="h-4 w-4" />
                        ) : (
                            <PanelRightOpen className="h-4 w-4" />
                        )}
                    </Button>
                </>
            )}
        </div>
    );
}
