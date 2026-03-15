import { useEffect, useMemo, useState, useCallback } from "react";
import type { Task } from "@taskflow/shared";
import { useProjectStore } from "@/stores/project-store";
import { useTaskStore } from "@/stores/task-store";
import { useSessionStore } from "@/stores/session-store";
import { useSettingsStore } from "@/stores/settings-store";
import { updateCollapsedProjectIds, useUIStore } from "@/stores/ui-store";
import { useFlowStore } from "@/stores/flow-store";
import { useDiffStore } from "@/stores/diff-store";
import { useThemeStore } from "@/stores/theme-store";
import { useWsStatus } from "@/providers/ws-context";
import { ProjectGroup } from "./ProjectGroup";
import { NoDragSpacer } from "./NoDragSpacer";
import { NewProjectDialog } from "./NewProjectDialog";
import { NewTaskControl } from "./NewTaskControl";
import { ArrowDownToLine, Loader2, Palette, Plus, Settings2, Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
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

export function TaskSidebar() {
    const { connected } = useWsStatus();
    const { projects, fetchProjects, addProject } = useProjectStore();
    const { tasks, activeTaskId, fetchTasks, setActiveTask } = useTaskStore();
    const archivedTasks = useTaskStore((s) => s.archivedTasks);
    const showArchive = useTaskStore((s) => s.showArchive);
    const setShowArchive = useTaskStore((s) => s.setShowArchive);
    const activeProjectId = useUIStore((s) => s.activeProjectId);
    const setActiveProject = useUIStore((s) => s.setActiveProject);
    const collapsedProjectIds = useUIStore((s) => s.collapsedProjectIds);
    const setProjectCollapsed = useUIStore((s) => s.setProjectCollapsed);
    const syncWithTasks = useSessionStore((s) => s.syncWithTasks);
    const syncWithProjects = useSessionStore((s) => s.syncWithProjects);
    const fetchSettings = useSettingsStore((s) => s.fetchSettings);
    const updateSettings = useSettingsStore((s) => s.updateSettings);
    const compactSidebar = useSettingsStore(
        (s) => s.settings?.layout?.panels?.compactSidebar ?? false,
    );
    const openSettings = useUIStore((s) => s.openSettings);
    const toggleFlowManagement = useUIStore((s) => s.toggleFlowManagement);
    const toggleAppearance = useUIStore((s) => s.toggleAppearance);
    const fetchThemes = useThemeStore((s) => s.fetchThemes);
    const [newProjectOpen, setNewProjectOpen] = useState(false);
    const [projectError, setProjectError] = useState<string | null>(null);
    const [updateStatus, setUpdateStatus] = useState<{
        status: "idle" | "checking" | "downloading" | "ready";
        version?: string;
    }>({ status: "idle" });
    const [updateDialogOpen, setUpdateDialogOpen] = useState(false);
    const diffStatsByProject = useDiffStore((s) => s.statsByProject);
    const startPolling = useDiffStore((s) => s.startPolling);

    useEffect(() => {
        if (!connected) return;
        void fetchProjects();
        void fetchTasks();
        void useFlowStore.getState().fetchFlows();
        void useFlowStore.getState().fetchActions();

        void (async () => {
            try {
                await fetchSettings();
            } catch {
                // Keep existing defaults if settings are temporarily unavailable.
            }

            try {
                await fetchThemes();
            } catch {
                // Theme store already has a bundled fallback; keep the app usable.
            }
        })();
    }, [connected, fetchProjects, fetchTasks, fetchSettings, fetchThemes]);

    useEffect(() => {
        syncWithTasks(tasks);
    }, [tasks, syncWithTasks]);

    useEffect(() => {
        syncWithProjects(projects);
    }, [projects, syncWithProjects]);

    const diffTargets = useMemo(() => {
        const targets: Array<{ id: string; path: string }> = projects.map((p) => ({
            id: p.id,
            path: p.path,
        }));
        for (const task of tasks) {
            if (task.worktree.enabled && task.worktree.path) {
                targets.push({ id: task.id, path: task.worktree.path });
            }
        }
        return targets;
    }, [projects, tasks]);

    useEffect(() => {
        if (!connected || diffTargets.length === 0) return;
        return startPolling(diffTargets);
    }, [connected, startPolling, diffTargets]);

    useEffect(() => {
        const cleanup = window.taskflow?.onToggleArchive(() => {
            const next = !useTaskStore.getState().showArchive;
            setShowArchive(next);
        });
        return cleanup;
    }, [setShowArchive]);

    useEffect(() => {
        window.taskflow?.sendArchiveState(showArchive);
    }, [showArchive]);

    useEffect(() => {
        const cleanup = window.taskflow?.onToggleCompactSidebar(() => {
            const current =
                useSettingsStore.getState().settings?.layout?.panels?.compactSidebar ?? false;
            const next = !current;
            void useSettingsStore
                .getState()
                .updateSettings({ layout: { panels: { compactSidebar: next } } });
            window.taskflow?.sendCompactSidebarState(next);
        });
        return cleanup;
    }, []);

    useEffect(() => {
        const cleanup = window.taskflow?.onUpdateStatus((payload) => {
            setUpdateStatus({
                status: payload.status as "idle" | "checking" | "downloading" | "ready",
                version: payload.version,
            });
        });
        return cleanup;
    }, []);

    const displayTasks = showArchive ? archivedTasks : tasks;

    const tasksByProject = useMemo(() => {
        const map = new Map<string, Task[]>();
        for (const task of displayTasks) {
            const list = map.get(task.projectId) ?? [];
            list.push(task);
            map.set(task.projectId, list);
        }
        return map;
    }, [displayTasks]);

    const visibleProjects = useMemo(
        () =>
            projects.filter((project) => {
                if (!showArchive) return true;
                return (tasksByProject.get(project.id) ?? []).length > 0;
            }),
        [projects, showArchive, tasksByProject],
    );

    const handleOpenProjectDialog = useCallback(() => {
        setProjectError(null);
        setNewProjectOpen(true);
    }, []);

    const handleProjectSubmit = useCallback(
        async (path: string) => {
            try {
                setProjectError(null);
                await addProject(path);
                setNewProjectOpen(false);
            } catch (err) {
                setProjectError(err instanceof Error ? err.message : "Failed to add project");
            }
        },
        [addProject],
    );

    const handleProjectDialogChange = useCallback((open: boolean) => {
        if (!open) setProjectError(null);
        setNewProjectOpen(open);
    }, []);

    const handleProjectClick = useCallback(
        (projectId: string) => {
            setActiveProject(projectId);
            setActiveTask(null);
        },
        [setActiveProject, setActiveTask],
    );

    const handleTaskClick = useCallback(
        (taskId: string) => {
            const task = tasks.find((entry) => entry.id === taskId);
            setActiveTask(taskId);
            setActiveProject(task?.projectId ?? null);
        },
        [setActiveProject, setActiveTask, tasks],
    );

    const handleProjectOpenChange = useCallback(
        (projectId: string, open: boolean) => {
            const nextCollapsedProjectIds = updateCollapsedProjectIds(
                useUIStore.getState().collapsedProjectIds,
                projectId,
                !open,
            );
            setProjectCollapsed(projectId, !open);
            void updateSettings({
                layout: {
                    panels: {
                        collapsedProjectIds: nextCollapsedProjectIds,
                    },
                },
            });
        },
        [setProjectCollapsed, updateSettings],
    );

    return (
        <>
            <div className="border-border flex min-h-9 items-center justify-between gap-2 border-b px-1.5 py-1.5">
                <div className="flex flex-1 items-center justify-end gap-1">
                    {showArchive ? (
                        <span className="text-muted-foreground px-1 text-xs font-medium">
                            Archived Tasks
                        </span>
                    ) : (
                        <>
                            <NewTaskControl tooltipSide="bottom" />
                            <Button
                                variant="ghost"
                                size="xs"
                                onClick={() => handleOpenProjectDialog()}
                                className="[-webkit-app-region:no-drag]"
                            >
                                <Plus className="h-4 w-4" />
                                Project
                            </Button>
                        </>
                    )}
                </div>
            </div>
            <div className="flex-1 overflow-x-hidden overflow-y-auto py-1.5">
                {!showArchive && projects.length === 0 && (
                    <div className="text-muted-foreground p-3 text-sm">
                        <div className="mb-2">No projects yet.</div>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleOpenProjectDialog()}
                            className="text-accent text-sm [-webkit-app-region:no-drag]"
                        >
                            Add Project
                        </Button>
                    </div>
                )}
                {showArchive && displayTasks.length === 0 && (
                    <div className="text-muted-foreground p-3 text-sm">No archived tasks.</div>
                )}
                {visibleProjects.map((project, index) => {
                    const projectTasks = tasksByProject.get(project.id) ?? [];
                    const projectOpen = !collapsedProjectIds.includes(project.id);
                    return (
                        <div key={project.id}>
                            {index > 0 && <NoDragSpacer />}
                            <ProjectGroup
                                project={project}
                                tasks={projectTasks}
                                activeTaskId={activeTaskId}
                                isActive={!activeTaskId && activeProjectId === project.id}
                                diffStats={diffStatsByProject[project.id]}
                                diffStatsByTask={diffStatsByProject}
                                onProjectClick={handleProjectClick}
                                onTaskClick={handleTaskClick}
                                archived={showArchive}
                                compact={compactSidebar}
                                open={projectOpen}
                                onOpenChange={(open) => handleProjectOpenChange(project.id, open)}
                            />
                        </div>
                    );
                })}
            </div>
            <Separator />
            <div className="flex items-center justify-between px-1.5 py-1.5">
                <div className="flex items-center">
                    {updateStatus.status === "checking" && (
                        <Button
                            variant="ghost"
                            size="icon-xs"
                            disabled
                            aria-label="Checking for updates"
                            tooltip="Checking for updates…"
                            tooltipSide="right"
                            className="text-muted-foreground [-webkit-app-region:no-drag]"
                        >
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        </Button>
                    )}
                    {updateStatus.status === "downloading" && (
                        <Button
                            variant="ghost"
                            size="icon-xs"
                            disabled
                            aria-label="Downloading update"
                            tooltip={`Downloading v${updateStatus.version ?? ""}…`}
                            tooltipSide="right"
                            className="text-muted-foreground [-webkit-app-region:no-drag]"
                        >
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        </Button>
                    )}
                    {updateStatus.status === "ready" && (
                        <Button
                            variant="ghost"
                            size="icon-xs"
                            onClick={() => setUpdateDialogOpen(true)}
                            aria-label="Update available"
                            tooltip={`v${updateStatus.version ?? ""} available — click to update`}
                            tooltipSide="right"
                            className="text-accent [-webkit-app-region:no-drag]"
                        >
                            <ArrowDownToLine className="h-3.5 w-3.5" />
                        </Button>
                    )}
                </div>
                <div className="flex items-center">
                    <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={toggleFlowManagement}
                        aria-label="Flows"
                        tooltip="Flows"
                        tooltipSide="bottom"
                        className="text-muted-foreground [-webkit-app-region:no-drag]"
                    >
                        <Workflow className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={toggleAppearance}
                        aria-label="Appearance"
                        tooltip="Appearance"
                        tooltipSide="bottom"
                        className="text-muted-foreground [-webkit-app-region:no-drag]"
                    >
                        <Palette className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={openSettings}
                        aria-label="Settings"
                        tooltip="Settings"
                        tooltipSide="bottom"
                        className="text-muted-foreground [-webkit-app-region:no-drag]"
                    >
                        <Settings2 className="h-3.5 w-3.5" />
                    </Button>
                </div>
            </div>
            <NewProjectDialog
                open={newProjectOpen}
                onOpenChange={handleProjectDialogChange}
                onSubmit={(path) => void handleProjectSubmit(path)}
                error={projectError}
            />
            <AlertDialog open={updateDialogOpen} onOpenChange={setUpdateDialogOpen}>
                <AlertDialogContent size="sm">
                    <AlertDialogHeader>
                        <AlertDialogTitle>Update Available</AlertDialogTitle>
                        <AlertDialogDescription>
                            Taskflow v{updateStatus.version} is ready to install. The app will
                            restart to apply the update.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel size="sm">Later</AlertDialogCancel>
                        <AlertDialogAction
                            size="sm"
                            onClick={() => window.taskflow?.quitAndInstallUpdate()}
                        >
                            Restart Now
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
}
