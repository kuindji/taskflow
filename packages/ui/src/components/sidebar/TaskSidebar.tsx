import { useEffect, useMemo, useState, useCallback } from "react";
import type { Task } from "@taskflow/shared";
import { useProjectStore } from "@/stores/project-store";
import { useTaskStore } from "@/stores/task-store";
import { useSessionStore } from "@/stores/session-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useUIStore } from "@/stores/ui-store";
import { useDiffStore } from "@/stores/diff-store";
import { useThemeStore } from "@/stores/theme-store";
import { useWsStatus } from "@/providers/ws-context";
import { ProjectGroup } from "./ProjectGroup";
import { NewProjectDialog } from "./NewProjectDialog";
import { NewTaskControl } from "./NewTaskControl";
import { Plus, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";

export function TaskSidebar() {
    const { connected } = useWsStatus();
    const { projects, fetchProjects, addProject } = useProjectStore();
    const { tasks, activeTaskId, fetchTasks, setActiveTask } = useTaskStore();
    const archivedTasks = useTaskStore((s) => s.archivedTasks);
    const showArchive = useTaskStore((s) => s.showArchive);
    const setShowArchive = useTaskStore((s) => s.setShowArchive);
    const activeProjectId = useUIStore((s) => s.activeProjectId);
    const setActiveProject = useUIStore((s) => s.setActiveProject);
    const syncWithTasks = useSessionStore((s) => s.syncWithTasks);
    const syncWithProjects = useSessionStore((s) => s.syncWithProjects);
    const fetchSettings = useSettingsStore((s) => s.fetchSettings);
    const compactSidebar = useSettingsStore(
        (s) => s.settings?.layout?.panels?.compactSidebar ?? false,
    );
    const toggleSettings = useUIStore((s) => s.toggleSettings);
    const fetchThemes = useThemeStore((s) => s.fetchThemes);
    const [newProjectOpen, setNewProjectOpen] = useState(false);
    const [projectError, setProjectError] = useState<string | null>(null);
    const diffStatsByProject = useDiffStore((s) => s.statsByProject);
    const startPolling = useDiffStore((s) => s.startPolling);

    useEffect(() => {
        if (!connected) return;
        void fetchProjects();
        void fetchTasks();

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
                                className="text-muted-foreground [-webkit-app-region:no-drag]"
                            >
                                <Plus className="h-4 w-4" />
                                Project
                            </Button>
                        </>
                    )}
                </div>
            </div>
            <ScrollArea className="flex-1 py-1 [&_[data-slot=scroll-area-viewport]]:!overflow-x-hidden [&_[data-slot=scroll-area-viewport]]:!overflow-y-auto [&_[data-slot=scroll-area-viewport]>div]:!block">
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
                {visibleProjects.map((project) => {
                    const projectTasks = tasksByProject.get(project.id) ?? [];
                    return (
                        <ProjectGroup
                            key={project.id}
                            project={project}
                            tasks={projectTasks}
                            activeTaskId={activeTaskId}
                            isActive={!activeTaskId && activeProjectId === project.id}
                            diffStats={diffStatsByProject[project.id]}
                            onProjectClick={handleProjectClick}
                            onTaskClick={handleTaskClick}
                            archived={showArchive}
                            compact={compactSidebar}
                        />
                    );
                })}
            </ScrollArea>
            <Separator />
            <div className="flex items-center justify-end px-1.5 py-1.5">
                <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={toggleSettings}
                    aria-label="Settings"
                    tooltip="Settings"
                    tooltipSide="bottom"
                    className="text-muted-foreground [-webkit-app-region:no-drag]"
                >
                    <Settings2 className="h-3.5 w-3.5" />
                </Button>
            </div>
            <NewProjectDialog
                open={newProjectOpen}
                onOpenChange={handleProjectDialogChange}
                onSubmit={(path) => void handleProjectSubmit(path)}
                error={projectError}
            />
        </>
    );
}
