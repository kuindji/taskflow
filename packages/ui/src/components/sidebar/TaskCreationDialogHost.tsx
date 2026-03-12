import { useCallback } from "react";
import type { AgentLaunchOptions } from "@taskflow/shared";
import { useProjectStore } from "@/stores/project-store";
import { useSessionStore } from "@/stores/session-store";
import { useTaskStore } from "@/stores/task-store";
import { useTaskCreationStore } from "@/stores/task-creation-store";
import { useUIStore } from "@/stores/ui-store";
import { NewProjectDialog } from "./NewProjectDialog";
import { NewTaskDialog } from "./NewTaskDialog";

export function TaskCreationDialogHost() {
    const { projects, addProject } = useProjectStore();
    const { tasks, activeTaskId, setActiveTask, createTask } = useTaskStore();
    const activeProjectId = useUIStore((s) => s.activeProjectId);
    const setActiveProject = useUIStore((s) => s.setActiveProject);
    const createSession = useSessionStore((s) => s.createSession);
    const {
        newTaskOpen,
        newProjectOpen,
        projectError,
        setNewTaskOpen,
        setNewProjectOpen,
        setProjectError,
        handleProjectCreated,
    } = useTaskCreationStore();

    const defaultProjectId = activeTaskId
        ? (tasks.find((task) => task.id === activeTaskId)?.projectId ?? projects[0]?.id)
        : (activeProjectId ?? projects[0]?.id);

    const handleProjectSubmit = useCallback(
        async (path: string) => {
            try {
                setProjectError(null);
                await addProject(path);
                handleProjectCreated();
            } catch (err) {
                setProjectError(err instanceof Error ? err.message : "Failed to add project");
            }
        },
        [addProject, handleProjectCreated, setProjectError],
    );

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
            <NewProjectDialog
                open={newProjectOpen}
                onOpenChange={setNewProjectOpen}
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
