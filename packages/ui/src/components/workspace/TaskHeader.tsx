import { useState, useCallback } from "react";
import type { Task, Project } from "@taskflow/shared";
import { Button } from "@/components/ui/button";
import { useUIStore } from "@/stores/ui-store";
import { useProjectStore } from "@/stores/project-store";
import { useTaskStore } from "@/stores/task-store";
import { useDiffStore } from "@/stores/diff-store";
import { confirm } from "@/stores/dialog-store";
import { TruncatedText } from "@/components/ui/truncated-text";
import { RenameProjectDialog } from "./RenameProjectDialog";
import { CommitDialog } from "./CommitDialog";
import {
    Archive,
    Diff,
    GitCommitHorizontal,
    Pencil,
    Trash2,
    PanelLeftClose,
    PanelLeftOpen,
    PanelRightClose,
    PanelRightOpen,
} from "lucide-react";
import useIsElectron from "@/hooks/useIsElectron";

interface TaskHeaderProps {
    task?: Task;
    project?: Project;
    onDiff?: () => void;
}

export function TaskHeader({ task, project, onDiff }: TaskHeaderProps) {
    const fileExplorerOpen = useUIStore((s) => s.fileExplorerOpen);
    const taskInfoOpen = useUIStore((s) => s.taskInfoOpen);
    const toggleFileExplorer = useUIStore((s) => s.toggleFileExplorer);
    const toggleTaskInfo = useUIStore((s) => s.toggleTaskInfo);
    const archiveTask = useTaskStore((s) => s.archiveTask);
    const deleteTask = useTaskStore((s) => s.deleteTask);
    const updateProject = useProjectStore((s) => s.updateProject);
    const removeProject = useProjectStore((s) => s.removeProject);
    const isElectron = useIsElectron();
    const [renameOpen, setRenameOpen] = useState(false);
    const [commitOpen, setCommitOpen] = useState(false);
    const isWorktreeTask = !!task?.worktree.enabled && !!task.worktree.path;
    const diffKey = isWorktreeTask ? task.id : project?.id;
    const diffStats = useDiffStore((s) =>
        diffKey ? (s.statsByProject[diffKey] ?? null) : null,
    );
    const commitDisabled = useDiffStore((s) =>
        diffKey ? (s.commitDisabledByProject[diffKey] ?? true) : true,
    );

    const showDiffButton = !!onDiff && ((!task && !!project) || isWorktreeTask);
    const showCommitButton = (!task && !!project) || isWorktreeTask;

    const handleRename = useCallback(
        (name: string) => {
            if (!project) return;
            void updateProject(project.id, { name });
        },
        [project, updateProject],
    );

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
        if (task) {
            void confirm({
                title: "Delete task",
                description: `Permanently delete "${task.title}"? This cannot be undone.`,
                confirmLabel: "Delete",
                variant: "destructive",
                onConfirm: () => deleteTask(task.id),
            });
            return;
        }
        if (!project) return;
        void confirm({
            title: "Remove project",
            description: `Remove "${project.name}" and delete all of its tasks? This cannot be undone.`,
            confirmLabel: "Remove",
            variant: "destructive",
            onConfirm: () => removeProject(project.id),
        });
    }, [deleteTask, project, removeProject, task]);

    return (
        <div
            className={`border-border flex min-h-9 items-center gap-1.5 border-b px-1.5 py-1.5 ${isElectron ? "[-webkit-app-region:drag]" : ""}`}
        >
            {task || project ? (
                <>
                    <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={toggleFileExplorer}
                        aria-label={fileExplorerOpen ? "Hide file explorer" : "Show file explorer"}
                        tooltip={fileExplorerOpen ? "Hide file explorer" : "Show file explorer"}
                        tooltipSide="bottom"
                        className="[-webkit-app-region:no-drag]"
                    >
                        {fileExplorerOpen ? (
                            <PanelLeftClose className="h-4 w-4" />
                        ) : (
                            <PanelLeftOpen className="h-4 w-4" />
                        )}
                    </Button>
                    <div className="flex min-w-0 shrink items-center gap-1.5 overflow-hidden">
                        <TruncatedText
                            tooltip
                            tooltipSide="bottom"
                            className="text-foreground shrink text-sm font-semibold"
                        >
                            {task?.title ?? project?.name}
                        </TruncatedText>
                        {task?.worktree?.branch && (
                            <TruncatedText
                                as="div"
                                tooltip
                                tooltipSide="bottom"
                                className="border-border shrink-[3] rounded-md border px-2 py-0.5 text-xs [-webkit-app-region:no-drag]"
                                tooltipContent={task.worktree.branch}
                            >
                                {task.worktree.branch}
                            </TruncatedText>
                        )}
                    </div>
                </>
            ) : (
                <div className="flex min-h-6 items-center gap-1.5">
                    <span className="text-muted-foreground text-sm ml-2">No task selected</span>
                </div>
            )}
            <div className="flex-1" />
            {(task || project) && (
                <>
                    {showCommitButton && (
                        <Button
                            variant="ghost"
                            size="xs"
                            onClick={() => setCommitOpen(true)}
                            disabled={commitDisabled}
                            aria-label="Commit / Push"
                            className="[-webkit-app-region:no-drag]"
                        >
                            <GitCommitHorizontal className="h-3 w-3" />
                            <span className="text-xs">Commit / Push</span>
                        </Button>
                    )}
                    {showDiffButton && (
                        <Button
                            variant="ghost"
                            size="xs"
                            onClick={onDiff}
                            aria-label="Show diff"
                            className="[-webkit-app-region:no-drag]"
                        >
                            <Diff className="h-3 w-3" />
                            <span className="text-xs">Diff</span>
                            {diffStats && (diffStats.additions > 0 || diffStats.deletions > 0) && (
                                <span className="text-xs">
                                    <span className="text-success">+{diffStats.additions}</span>{" "}
                                    <span className="text-destructive">-{diffStats.deletions}</span>
                                </span>
                            )}
                        </Button>
                    )}
                    {task && (
                        <Button
                            variant="ghost"
                            size="icon-xs"
                            onClick={handleArchive}
                            aria-label="Archive task"
                            tooltip="Archive task"
                            tooltipSide="bottom"
                            className="[-webkit-app-region:no-drag]"
                        >
                            <Archive className="h-4 w-4" />
                        </Button>
                    )}
                    {!task && project && (
                        <Button
                            variant="ghost"
                            size="icon-xs"
                            onClick={() => setRenameOpen(true)}
                            aria-label="Rename project"
                            tooltip="Rename project"
                            tooltipSide="bottom"
                            className="[-webkit-app-region:no-drag]"
                        >
                            <Pencil className="h-4 w-4" />
                        </Button>
                    )}
                    <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={handleDelete}
                        aria-label={task ? "Delete task" : "Remove project"}
                        tooltip={task ? "Delete task" : "Remove project"}
                        tooltipSide="bottom"
                        className="text-destructive hover:text-destructive [-webkit-app-region:no-drag]"
                    >
                        <Trash2 className="h-4 w-4" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={toggleTaskInfo}
                        aria-label={taskInfoOpen ? "Hide task info" : "Show task info"}
                        tooltip={taskInfoOpen ? "Hide task info" : "Show task info"}
                        tooltipSide="bottom"
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
            {project && (
                <RenameProjectDialog
                    open={renameOpen}
                    currentName={project.name}
                    onOpenChange={setRenameOpen}
                    onSubmit={handleRename}
                />
            )}
            {showCommitButton && (
                <CommitDialog
                    open={commitOpen}
                    onOpenChange={setCommitOpen}
                    repoPath={isWorktreeTask ? (task.worktree.path ?? "") : (project?.path ?? "")}
                    sessionOwner={isWorktreeTask ? { taskId: task.id } : { projectId: project?.id ?? "" }}
                />
            )}
        </div>
    );
}
