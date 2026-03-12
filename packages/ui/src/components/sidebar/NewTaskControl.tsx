import { useCallback, useState } from "react";
import type { AgentLaunchOptions } from "@taskflow/shared";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useProjectStore } from "@/stores/project-store";
import { useSessionStore } from "@/stores/session-store";
import { useTaskStore } from "@/stores/task-store";
import { useUIStore } from "@/stores/ui-store";
import { cn } from "@/lib/utils";
import { NewProjectDialog } from "./NewProjectDialog";
import { NewTaskDialog } from "./NewTaskDialog";

interface NewTaskControlProps {
    className?: string;
    iconClassName?: string;
    size?: "xs" | "sm";
}

export function NewTaskControl({
    className,
    iconClassName,
    size = "xs",
}: NewTaskControlProps) {
    const { projects, addProject } = useProjectStore();
    const { tasks, activeTaskId, setActiveTask, createTask } = useTaskStore();
    const activeProjectId = useUIStore((s) => s.activeProjectId);
    const setActiveProject = useUIStore((s) => s.setActiveProject);
    const createSession = useSessionStore((s) => s.createSession);
    const [newTaskOpen, setNewTaskOpen] = useState(false);
    const [newProjectOpen, setNewProjectOpen] = useState(false);
    const [projectError, setProjectError] = useState<string | null>(null);
    const [openTaskAfterProject, setOpenTaskAfterProject] = useState(false);

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

    const handleNewTask = useCallback(() => {
        if (projects.length === 0) {
            handleOpenProjectDialog(true);
            return;
        }
        setNewTaskOpen(true);
    }, [handleOpenProjectDialog, projects.length]);

    const defaultProjectId = activeTaskId
        ? (tasks.find((task) => task.id === activeTaskId)?.projectId ?? projects[0]?.id)
        : (activeProjectId ?? projects[0]?.id);

    const handleCreateTask = useCallback(
        async (data: {
            projectId: string;
            title?: string;
            description: string;
            worktree: boolean;
            startWith?: "claude" | "codex";
            agentOptions?: AgentLaunchOptions;
        }) => {
            try {
                const task = await createTask(data);
                setActiveProject(task.projectId);
                setActiveTask(task.id);
                if (data.startWith) {
                    await createSession(
                        { taskId: task.id },
                        data.startWith,
                        undefined,
                        data.description,
                        undefined,
                        data.agentOptions,
                    );
                }
            } catch (err) {
                console.error("Failed to create task:", err);
            }
        },
        [createSession, createTask, setActiveProject, setActiveTask],
    );

    return (
        <>
            <Button
                variant="ghost"
                size={size}
                onClick={handleNewTask}
                className={cn("text-muted-foreground text-sm [-webkit-app-region:no-drag]", className)}
            >
                <Plus className={cn("h-4 w-4", iconClassName)} />
                New Task
            </Button>
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
