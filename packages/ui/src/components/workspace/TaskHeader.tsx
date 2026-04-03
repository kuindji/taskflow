import { useState, useCallback } from "react";
import type { Task, Project, TaskWorktreePr } from "@taskflow/shared";
import { MSG } from "@taskflow/shared";
import { sendRequest } from "@/hooks/useWebSocket";
import { Button } from "@/components/ui/button";
import { useUIStore } from "@/stores/ui-store";
import { useSessionStore } from "@/stores/session-store";
import { useProjectStore } from "@/stores/project-store";
import { useTaskStore } from "@/stores/task-store";
import { useTaskCreationStore } from "@/stores/task-creation-store";

import { useDiffStore } from "@/stores/diff-store";
import { confirm } from "@/stores/dialog-store";
import { TruncatedText } from "@/components/ui/truncated-text";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { CopyButton } from "@/components/ui/copy-button";
import { CommitDialog } from "./CommitDialog";
import { ForkProjectDialog } from "./ForkProjectDialog";
import { RemoveProjectDialog } from "./RemoveProjectDialog";
import {
    getElementMenuPosition,
    showNativeMenuAndRun,
    supportsNativeMenus,
    type NativeMenuActionMap,
    type NativeMenuItem,
} from "@/lib/native-menu";
import {
    Archive,
    ArchiveRestore,
    ArrowDownToLine,
    ArrowUpFromLine,
    Columns2,
    Diff,
    Ellipsis,
    FolderTree,
    GitCommitHorizontal,
    GitFork,
    GitPullRequestCreateArrow,
    NotebookText,
    Pin,
    Plus,
    Search,
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
            className="text-accent cursor-pointer text-xs font-medium hover:underline"
            onClick={() => openUrl(pr.url)}
            onKeyDown={(e) => {
                if (e.key === "Enter") openUrl(pr.url);
            }}>
            #{pr.number}
        </span>
    );
}

export function TaskHeader({ task, project, onDiff }: TaskHeaderProps) {
    const fileExplorerOpen = useUIStore((s) => s.fileExplorerOpen);
    const taskInfoOpen = useUIStore((s) => s.taskInfoOpen);
    const toggleFileExplorer = useUIStore((s) => s.toggleFileExplorer);
    const toggleTaskInfo = useUIStore((s) => s.toggleTaskInfo);
    const searchPanelOpen = useUIStore((s) => s.searchPanelOpen);
    const toggleSearchPanel = useUIStore((s) => s.toggleSearchPanel);
    const archiveTask = useTaskStore((s) => s.archiveTask);
    const unarchiveTask = useTaskStore((s) => s.unarchiveTask);
    const deleteTask = useTaskStore((s) => s.deleteTask);
    const updateTask = useTaskStore((s) => s.updateTask);
    const requestNewTask = useTaskCreationStore((s) => s.requestNewTask);
    const requestNewSubtask = useTaskCreationStore((s) => s.requestNewSubtask);
    const hideProject = useProjectStore((s) => s.hideProject);
    const removeProject = useProjectStore((s) => s.removeProject);
    const [removeOpen, setRemoveOpen] = useState(false);

    const splitOpen = useUIStore((s) =>
        task
            ? (s.splitByWorkspace[`task:${task.id}`]?.open ?? false)
            : project
              ? (s.splitByWorkspace[`project:${project.id}`]?.open ?? false)
              : false,
    );
    const toggleSplit = useUIStore((s) => s.toggleSplit);
    const mergeSplitTabs = useSessionStore((s) => s.mergeSplitTabs);

    const isElectron = useIsElectron();
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
    const behind = useDiffStore((s) => (diffKey ? (s.behindByProject[diffKey] ?? 0) : 0));
    const projectBranch = useDiffStore((s) =>
        project ? (s.branchByProject[project.id] ?? null) : null,
    );

    const [pulling, setPulling] = useState(false);
    const infoLabel = task ? "task" : "project";
    const isArchivedTask = task?.status === "archived";
    const canShowTaskExtras = !!task && !isArchivedTask && !task.parentId;
    const nativeMenus = supportsNativeMenus();

    const handlePull = useCallback(async () => {
        if (pulling || !gitRepoPath) return;
        setPulling(true);
        try {
            await sendRequest(MSG.GIT_PULL, { path: gitRepoPath });
        } catch {
            // Pull failed — user will see the error via git output
        } finally {
            setPulling(false);
        }
    }, [pulling, gitRepoPath]);

    const showPush = !hasChanges && !commitDisabled;
    const showCreatePr =
        commitDisabled && isWorktreeTask && !!task?.worktree.branch && !task?.worktree.pr;
    const commitLabel = showCreatePr ? "Create PR" : showPush ? "Push" : "Commit";
    const CommitIcon = showCreatePr
        ? GitPullRequestCreateArrow
        : showPush
          ? ArrowUpFromLine
          : GitCommitHorizontal;

    const showGitButtons = !!project && (!task || isWorktreeTask);
    const showDiffButton = !!onDiff && showGitButtons;
    const showCommitButton = showGitButtons;

    const handleArchive = useCallback(() => {
        if (!task) return;
        void confirm({
            title: "Archive task",
            description: `Archive "${task.title}"? You can restore it later.`,
            confirmLabel: "Archive",
            onConfirm: () => archiveTask(task.id),
        });
    }, [archiveTask, task]);

    const handleUnarchive = useCallback(() => {
        if (!task) return;
        void unarchiveTask(task.id);
    }, [task, unarchiveTask]);

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

    const handleTogglePin = useCallback(() => {
        if (!task) return;
        void updateTask(task.id, { pinned: !task.pinned });
    }, [task, updateTask]);

    const handleAddSubtask = useCallback(() => {
        if (!task) return;
        requestNewSubtask(task.id);
    }, [requestNewSubtask, task]);

    const handleCreateProjectTask = useCallback(() => {
        if (!project) return;
        requestNewTask(project.id);
    }, [project, requestNewTask]);

    const handleToggleSplit = useCallback(() => {
        const workspaceKey = task ? `task:${task.id}` : project ? `project:${project.id}` : null;
        if (!workspaceKey) return;
        if (splitOpen) {
            mergeSplitTabs(workspaceKey);
        }
        toggleSplit(workspaceKey);
    }, [task, project, splitOpen, mergeSplitTabs, toggleSplit]);

    const openTaskActions = useCallback(
        async (target: HTMLElement) => {
            if (!task) return;

            const items: NativeMenuItem[] = [];
            const actions: NativeMenuActionMap = {};

            if (canShowTaskExtras) {
                items.push(
                    { id: "add-subtask", label: "Add subtask" },
                    { id: "toggle-pin", label: task.pinned ? "Unpin task" : "Pin task" },
                    { type: "separator" },
                );
                actions["add-subtask"] = handleAddSubtask;
                actions["toggle-pin"] = handleTogglePin;
            }

            items.push(
                {
                    id: isArchivedTask ? "unarchive" : "archive",
                    label: isArchivedTask ? "Unarchive task" : "Archive task",
                },
                { id: "delete", label: "Delete task" },
            );

            actions[isArchivedTask ? "unarchive" : "archive"] = isArchivedTask
                ? handleUnarchive
                : handleArchive;
            actions.delete = handleDelete;

            await showNativeMenuAndRun(items, actions, getElementMenuPosition(target, "end"));
        },
        [
            canShowTaskExtras,
            handleAddSubtask,
            handleArchive,
            handleDelete,
            handleTogglePin,
            handleUnarchive,
            isArchivedTask,
            task,
        ],
    );

    const openProjectActions = useCallback(
        async (target: HTMLElement) => {
            if (!project) return;

            await showNativeMenuAndRun(
                [
                    { id: "create-task", label: "Create task" },
                    { id: "fork-project", label: "Fork project" },
                    { type: "separator" },
                    { id: "delete-project", label: "Delete project" },
                ],
                {
                    "create-task": handleCreateProjectTask,
                    "fork-project": () => setForkOpen(true),
                    "delete-project": handleDelete,
                },
                getElementMenuPosition(target, "end"),
            );
        },
        [handleCreateProjectTask, handleDelete, project],
    );

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
                        className="[-webkit-app-region:no-drag]">
                        <FolderTree className="h-4 w-4" />
                    </Button>
                    <Button
                        variant={searchPanelOpen ? "secondary" : "ghost"}
                        size="icon-xs"
                        onClick={toggleSearchPanel}
                        aria-pressed={searchPanelOpen}
                        aria-label={searchPanelOpen ? "Hide search" : "Show search"}
                        tooltip={searchPanelOpen ? "Hide search" : "Show search"}
                        tooltipSide="bottom"
                        className="[-webkit-app-region:no-drag]">
                        <Search className="h-4 w-4" />
                    </Button>
                    <div className="flex min-w-0 shrink items-center gap-1.5 overflow-hidden">
                        <TruncatedText
                            tooltip
                            tooltipSide="bottom"
                            className="text-foreground shrink text-sm font-semibold">
                            {task?.title ?? project?.name}
                        </TruncatedText>
                        {task?.worktree?.branch && (
                            <div className="border-border flex min-w-0 shrink-3 items-center gap-1 rounded-md border py-0.5 pr-1 pl-2 [-webkit-app-region:no-drag]">
                                <TruncatedText
                                    as="div"
                                    tooltip
                                    tooltipSide="bottom"
                                    className="flex-1 text-xs"
                                    tooltipContent={task.worktree.branch}>
                                    {task.worktree.branch}
                                </TruncatedText>
                                {task.worktree.pr && <PrLink pr={task.worktree.pr} />}
                                <CopyButton
                                    value={task.worktree.branch}
                                    tooltip="Copy branch name"
                                    variant="transparent"
                                    size="icon-2xs"
                                    className="text-muted-foreground hover:text-foreground shrink-0 px-0 [-webkit-app-region:no-drag]"
                                />
                            </div>
                        )}
                        {!task?.worktree?.branch && projectBranch && (
                            <div className="border-border flex min-w-0 shrink-3 items-center gap-1 rounded-md border py-0.5 pr-1 pl-2 [-webkit-app-region:no-drag]">
                                <TruncatedText
                                    as="div"
                                    tooltip
                                    tooltipSide="bottom"
                                    className="flex-1 text-xs"
                                    tooltipContent={projectBranch}>
                                    {projectBranch}
                                </TruncatedText>
                                <CopyButton
                                    value={projectBranch}
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
                    {showGitButtons && behind > 0 && (
                        <Button
                            variant="ghost"
                            size="xs"
                            onClick={() => void handlePull()}
                            loading={pulling}
                            aria-label="Pull"
                            className="[-webkit-app-region:no-drag]">
                            <ArrowDownToLine className="h-3 w-3" />
                            <span className="text-xs">Pull</span>
                        </Button>
                    )}
                    {showCommitButton && (
                        <Button
                            variant="ghost"
                            size="xs"
                            onClick={() => setCommitOpen(true)}
                            disabled={commitDisabled && !showCreatePr}
                            aria-label={commitLabel}
                            className="[-webkit-app-region:no-drag]">
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
                            className="[-webkit-app-region:no-drag]">
                            <Diff className="h-3 w-3" />
                            <span className="text-xs">Diff</span>
                            {(behind > 0 ||
                                (diffStats &&
                                    (diffStats.additions > 0 || diffStats.deletions > 0))) && (
                                <span className="flex gap-0.5 text-xs">
                                    {behind > 0 && <span className="text-info">↓{behind}</span>}
                                    {diffStats &&
                                        (diffStats.additions > 0 || diffStats.deletions > 0) && (
                                            <>
                                                <span className="text-success">
                                                    +{diffStats.additions}
                                                </span>
                                                <span className="text-destructive">
                                                    -{diffStats.deletions}
                                                </span>
                                            </>
                                        )}
                                </span>
                            )}
                        </Button>
                    )}
                    {task ? (
                        nativeMenus ? (
                            <Button
                                variant="ghost"
                                size="icon-xs"
                                aria-label="Task actions"
                                tooltip="Task actions"
                                tooltipSide="bottom"
                                onClick={(e) => void openTaskActions(e.currentTarget)}
                                className="[-webkit-app-region:no-drag]">
                                <Ellipsis className="h-4 w-4" />
                            </Button>
                        ) : (
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button
                                        variant="ghost"
                                        size="icon-xs"
                                        aria-label="Task actions"
                                        tooltip="Task actions"
                                        tooltipSide="bottom"
                                        className="[-webkit-app-region:no-drag]">
                                        <Ellipsis className="h-4 w-4" />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                    {canShowTaskExtras && (
                                        <>
                                            <DropdownMenuItem onSelect={handleAddSubtask}>
                                                <Plus className="h-4 w-4" />
                                                Add subtask
                                            </DropdownMenuItem>
                                            <DropdownMenuItem onSelect={handleTogglePin}>
                                                <Pin
                                                    className={
                                                        task.pinned
                                                            ? "h-4 w-4 fill-current"
                                                            : "h-4 w-4"
                                                    }
                                                />
                                                {task.pinned ? "Unpin task" : "Pin task"}
                                            </DropdownMenuItem>
                                            <DropdownMenuSeparator />
                                        </>
                                    )}
                                    {isArchivedTask ? (
                                        <DropdownMenuItem onSelect={handleUnarchive}>
                                            <ArchiveRestore className="h-4 w-4" />
                                            Unarchive task
                                        </DropdownMenuItem>
                                    ) : (
                                        <DropdownMenuItem onSelect={handleArchive}>
                                            <Archive className="h-4 w-4" />
                                            Archive task
                                        </DropdownMenuItem>
                                    )}
                                    <DropdownMenuItem variant="destructive" onSelect={handleDelete}>
                                        <Trash2 className="h-4 w-4" />
                                        Delete task
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        )
                    ) : project ? (
                        nativeMenus ? (
                            <Button
                                variant="ghost"
                                size="icon-xs"
                                aria-label="Project actions"
                                tooltip="Project actions"
                                tooltipSide="bottom"
                                onClick={(e) => void openProjectActions(e.currentTarget)}
                                className="[-webkit-app-region:no-drag]">
                                <Ellipsis className="h-4 w-4" />
                            </Button>
                        ) : (
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button
                                        variant="ghost"
                                        size="icon-xs"
                                        aria-label="Project actions"
                                        tooltip="Project actions"
                                        tooltipSide="bottom"
                                        className="[-webkit-app-region:no-drag]">
                                        <Ellipsis className="h-4 w-4" />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                    <DropdownMenuItem onSelect={handleCreateProjectTask}>
                                        <Plus className="h-4 w-4" />
                                        Create task
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onSelect={() => setForkOpen(true)}>
                                        <GitFork className="h-4 w-4" />
                                        Fork project
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem variant="destructive" onSelect={handleDelete}>
                                        <Trash2 className="h-4 w-4" />
                                        Delete project
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        )
                    ) : null}
                    <Button
                        variant={splitOpen ? "secondary" : "ghost"}
                        size="icon-xs"
                        onClick={handleToggleSplit}
                        aria-pressed={splitOpen}
                        aria-label={splitOpen ? "Close split view" : "Split view"}
                        tooltip={splitOpen ? "Close split view" : "Split view"}
                        tooltipSide="bottom"
                        className="[-webkit-app-region:no-drag]">
                        <Columns2 className="h-4 w-4" />
                    </Button>
                    <Button
                        variant={taskInfoOpen ? "secondary" : "ghost"}
                        size="icon-xs"
                        onClick={toggleTaskInfo}
                        aria-pressed={taskInfoOpen}
                        aria-label={
                            taskInfoOpen ? `Hide ${infoLabel} info` : `Show ${infoLabel} info`
                        }
                        tooltip={taskInfoOpen ? `Hide ${infoLabel} info` : `Show ${infoLabel} info`}
                        tooltipSide="bottom"
                        className="[-webkit-app-region:no-drag]">
                        <NotebookText className="h-4 w-4" />
                    </Button>
                </>
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
