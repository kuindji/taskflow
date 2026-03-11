import { useEffect, useMemo, useState, useCallback } from "react";
import type { Task } from "@taskflow/shared";
import { useProjectStore } from "@/stores/project-store";
import { useTaskStore } from "@/stores/task-store";
import { useSessionStore } from "@/stores/session-store";
import { useWsStatus } from "@/providers/ws-context";
import { ProjectGroup } from "./ProjectGroup";
import { NewTaskDialog } from "./NewTaskDialog";
import { NewProjectDialog } from "./NewProjectDialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Plus } from "lucide-react";

export function TaskSidebar() {
    const { connected } = useWsStatus();
    const { projects, fetchProjects, addProject, updateProject } = useProjectStore();
    const { tasks, activeTaskId, fetchTasks, setActiveTask, createTask } = useTaskStore();
    const syncWithTasks = useSessionStore((s) => s.syncWithTasks);
    const [newTaskOpen, setNewTaskOpen] = useState(false);
    const [newProjectOpen, setNewProjectOpen] = useState(false);
    const [projectError, setProjectError] = useState<string | null>(null);
    const [openTaskAfterProject, setOpenTaskAfterProject] = useState(false);

    useEffect(() => {
        if (!connected) return;
        void fetchProjects();
        void fetchTasks();
    }, [connected, fetchProjects, fetchTasks]);

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

    const handleOpenProjectDialog = useCallback((thenOpenTask = false) => {
        setProjectError(null);
        setOpenTaskAfterProject(thenOpenTask);
        setNewProjectOpen(true);
    }, []);

    const handleProjectSubmit = useCallback(
        async (path: string) => {
            try {
                setProjectError(null);
                await addProject(path);
                setNewProjectOpen(false);
                if (openTaskAfterProject) {
                    setNewTaskOpen(true);
                }
            } catch (err) {
                setProjectError(err instanceof Error ? err.message : "Failed to add project");
            }
        },
        [addProject, openTaskAfterProject],
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

    const handleNewTask = () => {
        if (projects.length === 0) {
            handleOpenProjectDialog(true);
            return;
        }
        setNewTaskOpen(true);
    };

    const defaultProjectId = activeTaskId
        ? (tasks.find((t) => t.id === activeTaskId)?.projectId ?? projects[0]?.id)
        : projects[0]?.id;

    const handleCreateTask = async (data: {
        projectId: string;
        title?: string;
        description: string;
        worktree: boolean;
    }) => {
        try {
            const task = await createTask(data);
            setActiveTask(task.id);
        } catch (err) {
            console.error("Failed to create task:", err);
        }
    };

    return (
        <>
            <div className="border-border flex border-b px-1.5 py-1.5">
                <Button
                    variant="ghost"
                    size="xs"
                    onClick={handleNewTask}
                    className="text-muted-foreground text-sm"
                >
                    <Plus className="h-4 w-4" />
                    New Task
                </Button>
            </div>
            <ScrollArea className="flex-1 py-1">
                {projects.length === 0 && (
                    <div className="text-muted-foreground p-3 text-sm">
                        <div className="mb-2">No projects yet.</div>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleOpenProjectDialog()}
                            className="text-accent text-sm"
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
                    className="text-muted-foreground text-sm"
                >
                    Add Project
                </Button>
                <Button variant="ghost" size="xs" className="text-muted-foreground text-sm">
                    Settings
                </Button>
            </div>
            <NewProjectDialog
                open={newProjectOpen}
                onOpenChange={handleProjectDialogChange}
                onSubmit={(path) => void handleProjectSubmit(path)}
                error={projectError}
            />
            <NewTaskDialog
                open={newTaskOpen}
                onOpenChange={setNewTaskOpen}
                projects={projects}
                defaultProjectId={defaultProjectId}
                onSubmit={(data) => void handleCreateTask(data)}
            />
        </>
    );
}
