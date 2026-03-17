import { useState, useCallback } from "react";
import type { Task, Project, TaskWorktreePr } from "@taskflow/shared";
import { Button } from "@/components/ui/button";
import { useUIStore } from "@/stores/ui-store";
import { useProjectStore } from "@/stores/project-store";
import { useTaskStore } from "@/stores/task-store";

import { useDiffStore } from "@/stores/diff-store";
import { confirm } from "@/stores/dialog-store";
import { TruncatedText } from "@/components/ui/truncated-text";

import { CopyButton } from "@/components/ui/copy-button";
import { RenameProjectDialog } from "./RenameProjectDialog";
import { CommitDialog } from "./CommitDialog";
import { ForkProjectDialog } from "./ForkProjectDialog";
import { RemoveProjectDialog } from "./RemoveProjectDialog";
import {
    Archive,
    ArrowUpFromLine,
    Diff,
    FolderTree,
    GitCommitHorizontal,
    GitFork,
    NotebookText,
    Pencil,
    Trash2,
} from "lucide-react";
import useIsElectron from "@/hooks/useIsElectron";
import { Toolbar } from "@/components/ui/toolbar";

interface TaskHeaderProps {
    task?: Task;
    project?: Project;
    onDiff?: () => void;
}

function openUrl(url: string) {
    if (window.taskflow) {
        void window.taskflow.openExternalUrl(url);
    } else {
        window.open(url, "_blank");
    }
}

function PrLink({ pr }: { pr: TaskWorktreePr }) {
    return (
        <span
            role="link"
            tabIndex={0}
            className="text-accent hover:underline cursor-pointer text-xs font-medium"
            onClick={() => openUrl(pr.url)}
            onKeyDown={(e) => {
                if (e.key === "Enter") openUrl(pr.url);
            }}
        >
            #{pr.number}
        </span>
    );
}

export function TaskHeader({ task, project, onDiff }: TaskHeaderProps) {
    const fileExplorerOpen = useUIStore((s) => s.fileExplorerOpen);
    const taskInfoOpen = useUIStore((s) => s.taskInfoOpen);
    const toggleFileExplorer = useUIStore((s) => s.toggleFileExplorer);
    const toggleTaskInfo = useUIStore((s) => s.toggleTaskInfo);
    const archiveTask = useTaskStore((s) => s.archiveTask);
    const deleteTask = useTaskStore((s) => s.deleteTask);
    const updateProject = useProjectStore((s) => s.updateProject);
    const hideProject = useProjectStore((s) => s.hideProject);
    const removeProject = useProjectStore((s) => s.removeProject);
    const [removeOpen, setRemoveOpen] = useState(false);

    const isElectron = useIsElectron();
    const [renameOpen, setRenameOpen] = useState(false);
    const [commitOpen, setCommitOpen] = useState(false);
    const [forkOpen, setForkOpen] = useState(false);
    const isWorktreeTask = !!task?.worktree.enabled && !!task.worktree.path;
    const gitRepoPath = isWorktreeTask ? (task?.worktree.path ?? "") : (project?.path ?? "");
    const diffKey = isWorktreeTask ? task.id : project?.id;
    const diffStats = useDiffStore((s) => (diffKey ? (s.statsByProject[diffKey] ?? null) : null));
    const diffDisabled = useDiffStore((s) =>
        diffKey ? (s.diffDisabledByProject[diffKey] ?? true) : true,
    );
    const commitDisabled = useDiffStore((s) =>
        diffKey ? (s.commitDisabledByProject[diffKey] ?? true) : true,
    );
    const hasChanges = useDiffStore((s) =>
        diffKey ? (s.hasChangesByProject[diffKey] ?? false) : false,
    );

    const showPush = !hasChanges && !commitDisabled;
    const commitLabel = showPush ? "Push" : "Commit";
    const CommitIcon = showPush ? ArrowUpFromLine : GitCommitHorizontal;

    const showGitButtons = !!project && (!task || isWorktreeTask);
    const showDiffButton = !!onDiff && showGitButtons;
    const showCommitButton = showGitButtons;

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
        setRemoveOpen(true);
    }, [deleteTask, project, task]);

    return (
        <Toolbar className={`gap-1.5 ${isElectron ? "[-webkit-app-region:drag]" : ""}`}>
            {task || project ? (
                <>
                    <Button
                        variant={fileExplorerOpen ? "secondary" : "ghost"}
                        size="icon-xs"
                        onClick={toggleFileExplorer}
                        aria-pressed={fileExplorerOpen}
                        aria-label={fileExplorerOpen ? "Hide file explorer" : "Show file explorer"}
                        tooltip={fileExplorerOpen ? "Hide file explorer" : "Show file explorer"}
                        tooltipSide="bottom"
                        className="[-webkit-app-region:no-drag]"
                    >
                        <FolderTree className="h-4 w-4" />
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
                            <div className="border-border flex min-w-0 shrink-3 items-center gap-1 rounded-md border py-0.5 pr-1 pl-2 [-webkit-app-region:no-drag]">
                                <TruncatedText
                                    as="div"
                                    tooltip
                                    tooltipSide="bottom"
                                    className="flex-1 text-xs"
                                    tooltipContent={task.worktree.branch}
                                >
                                    {task.worktree.branch}
                                </TruncatedText>
                                {task.worktree.pr && (
                                    <PrLink pr={task.worktree.pr} />
                                )}
                                <CopyButton
                                    value={task.worktree.branch}
                                    tooltip="Copy branch name"
                                    variant="transparent"
                                    size="icon-2xs"
                                    className="text-muted-foreground hover:text-foreground shrink-0 px-0 [-webkit-app-region:no-drag]"
                                />
                            </div>
                        )}
                    </div>
                </>
            ) : (
                <div className="flex min-h-6 items-center gap-1.5">
                    <span className="text-muted-foreground ml-2 text-sm">No task selected</span>
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
                            aria-label={commitLabel}
                            className="[-webkit-app-region:no-drag]"
                        >
                            <CommitIcon className="h-3 w-3" />
                            <span className="text-xs">{commitLabel}</span>
                        </Button>
                    )}
                    {showDiffButton && (
                        <Button
                            variant="ghost"
                            size="xs"
                            onClick={onDiff}
                            disabled={diffDisabled}
                            aria-label="Show diff"
                            className="[-webkit-app-region:no-drag]"
                        >
                            <Diff className="h-3 w-3" />
                            <span className="text-xs">Diff</span>
                            {diffStats && (diffStats.additions > 0 || diffStats.deletions > 0) && (
                                <span className="flex gap-0.5 text-xs">
                                    <span className="text-success">+{diffStats.additions}</span>
                                    <span className="text-destructive">-{diffStats.deletions}</span>
                                </span>
                            )}
                        </Button>
                    )}
                    {showGitButtons && !task && project && (
                        <Button
                            variant="ghost"
                            size="xs"
                            onClick={() => setForkOpen(true)}
                            aria-label="Fork project"
                            className="[-webkit-app-region:no-drag]"
                        >
                            <GitFork className="h-3 w-3" />
                            <span className="text-xs">Fork</span>
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
                        variant={taskInfoOpen ? "secondary" : "ghost"}
                        size="icon-xs"
                        onClick={toggleTaskInfo}
                        aria-pressed={taskInfoOpen}
                        aria-label={taskInfoOpen ? "Hide task info" : "Show task info"}
                        tooltip={taskInfoOpen ? "Hide task info" : "Show task info"}
                        tooltipSide="bottom"
                        className="[-webkit-app-region:no-drag]"
                    >
                        <NotebookText className="h-4 w-4" />
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
                    repoPath={gitRepoPath}
                    sessionOwner={task ? { taskId: task.id } : { projectId: project?.id ?? "" }}
                />
            )}
            {project && (
                <ForkProjectDialog open={forkOpen} onOpenChange={setForkOpen} project={project} />
            )}
            {project && (
                <RemoveProjectDialog
                    open={removeOpen}
                    project={project}
                    onOpenChange={setRemoveOpen}
                    onRemove={removeProject}
                    onHide={hideProject}
                />
            )}
        </Toolbar>
    );
}
