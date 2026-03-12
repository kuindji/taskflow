import { useEffect, useMemo, useState, useCallback } from "react";
import type { Task } from "@taskflow/shared";
import { useProjectStore } from "@/stores/project-store";
import { useTaskStore } from "@/stores/task-store";
import { useSessionStore } from "@/stores/session-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useUIStore } from "@/stores/ui-store";
import { useDiffStore } from "@/stores/diff-store";
import { useWsStatus } from "@/providers/ws-context";
import { ProjectGroup } from "./ProjectGroup";
import { NewProjectDialog } from "./NewProjectDialog";
import { NewTaskControl } from "./NewTaskControl";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

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
    const toggleSettings = useUIStore((s) => s.toggleSettings);
    const [newProjectOpen, setNewProjectOpen] = useState(false);
    const [projectError, setProjectError] = useState<string | null>(null);
    const diffStatsByProject = useDiffStore((s) => s.statsByProject);
    const startPolling = useDiffStore((s) => s.startPolling);

    useEffect(() => {
        if (!connected) return;
        void fetchProjects();
        void fetchTasks();
        void fetchSettings();
    }, [connected, fetchProjects, fetchTasks, fetchSettings]);

    useEffect(() => {
        syncWithTasks(tasks);
    }, [tasks, syncWithTasks]);

    useEffect(() => {
        syncWithProjects(projects);
    }, [projects, syncWithProjects]);

    useEffect(() => {
        if (!connected || projects.length === 0) return;
        return startPolling(projects);
    }, [connected, startPolling, projects]);

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
                            <NewTaskControl />
                            <Button
                                variant="ghost"
                                size="xs"
                                onClick={() => handleOpenProjectDialog()}
                                className="text-muted-foreground text-sm [-webkit-app-region:no-drag]"
                            >
                                <Plus className="h-4 w-4" />
                                Project
                            </Button>
                        </>
                    )}
                </div>
            </div>
            <ScrollArea className="flex-1 py-1">
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
                    <div className="text-muted-foreground p-3 text-sm">
                        No archived tasks.
                    </div>
                )}
                {projects.map((project) => {
                    const projectTasks = tasksByProject.get(project.id) ?? [];
                    if (showArchive && projectTasks.length === 0) return null;
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
                        />
                    );
                })}
            </ScrollArea>
            <Separator />
            <div className="flex items-center justify-between px-1.5 py-1.5">
                <div className="flex items-center gap-1.5 [-webkit-app-region:no-drag]">
                    <Switch
                        id="archive-toggle"
                        checked={showArchive}
                        onCheckedChange={setShowArchive}
                        className="scale-75"
                    />
                    <Label
                        htmlFor="archive-toggle"
                        className="text-muted-foreground cursor-pointer whitespace-nowrap text-sm tracking-normal normal-case"
                    >
                        Show archive
                    </Label>
                </div>
                <Button
                    variant="ghost"
                    size="xs"
                    onClick={toggleSettings}
                    className="text-muted-foreground text-sm [-webkit-app-region:no-drag]"
                >
                    Settings
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
