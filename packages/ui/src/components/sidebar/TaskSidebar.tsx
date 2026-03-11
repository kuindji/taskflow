import { useEffect, useMemo, useState, useCallback } from "react";
import type { Task } from "@taskflow/shared";
import { useProjectStore } from "@/stores/project-store";
import { useTaskStore } from "@/stores/task-store";
import { useSessionStore } from "@/stores/session-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useUIStore } from "@/stores/ui-store";
import { useWsStatus } from "@/providers/ws-context";
import { ProjectGroup } from "./ProjectGroup";
import { NewProjectDialog } from "./NewProjectDialog";
import { NewTaskControl } from "./NewTaskControl";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";

export function TaskSidebar() {
    const { connected } = useWsStatus();
    const { projects, fetchProjects, addProject, updateProject } = useProjectStore();
    const { tasks, activeTaskId, fetchTasks, setActiveTask } = useTaskStore();
    const syncWithTasks = useSessionStore((s) => s.syncWithTasks);
    const fetchSettings = useSettingsStore((s) => s.fetchSettings);
    const toggleSettings = useUIStore((s) => s.toggleSettings);
    const [newProjectOpen, setNewProjectOpen] = useState(false);
    const [projectError, setProjectError] = useState<string | null>(null);

    useEffect(() => {
        if (!connected) return;
        void fetchProjects();
        void fetchTasks();
        void fetchSettings();
    }, [connected, fetchProjects, fetchTasks, fetchSettings]);

    useEffect(() => {
        syncWithTasks(tasks);
    }, [tasks, syncWithTasks]);

    const tasksByProject = useMemo(() => {
        const map = new Map<string, Task[]>();
        for (const task of tasks) {
            const list = map.get(task.projectId) ?? [];
            list.push(task);
            map.set(task.projectId, list);
        }
        return map;
    }, [tasks]);

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

    const handleRenameProject = useCallback(
        async (id: string, name: string) => {
            try {
                await updateProject(id, name);
            } catch (err) {
                console.error("Failed to rename project:", err);
            }
        },
        [updateProject],
    );

    return (
        <>
            <div className="border-border flex justify-end border-b px-1.5 py-1.5">
                <NewTaskControl />
            </div>
            <ScrollArea className="flex-1 py-1">
                {projects.length === 0 && (
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
                {projects.map((project) => (
                    <ProjectGroup
                        key={project.id}
                        project={project}
                        tasks={tasksByProject.get(project.id) ?? []}
                        activeTaskId={activeTaskId}
                        onTaskClick={setActiveTask}
                        onRename={handleRenameProject}
                    />
                ))}
            </ScrollArea>
            <Separator />
            <div className="flex justify-between px-1.5 py-1.5">
                <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => handleOpenProjectDialog()}
                    className="text-muted-foreground text-sm [-webkit-app-region:no-drag]"
                >
                    Add Project
                </Button>
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
