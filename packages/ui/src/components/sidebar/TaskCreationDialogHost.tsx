import { useCallback, useEffect, useRef } from "react";
import type { AgentLaunchOptions } from "@taskflow/shared";
import { useProjectStore } from "@/stores/project-store";
import { useSessionStore } from "@/stores/session-store";
import { useTaskStore } from "@/stores/task-store";
import { useTaskCreationStore } from "@/stores/task-creation-store";
import { useUIStore } from "@/stores/ui-store";
import { NewProjectDialog } from "./NewProjectDialog";
import { NewTaskDialog } from "./NewTaskDialog";

interface PendingSession {
    taskId: string;
    type: "claude" | "codex";
    description: string;
    agentOptions?: AgentLaunchOptions;
}

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
        parentTaskId,
        setNewTaskOpen,
        setNewProjectOpen,
        setProjectError,
        handleProjectCreated,
    } = useTaskCreationStore();

    const pendingSessionRef = useRef<PendingSession | null>(null);

    const defaultProjectId = activeTaskId
        ? (tasks.find((task) => task.id === activeTaskId)?.projectId ?? projects[0]?.id)
        : (activeProjectId ?? projects[0]?.id);

    // Watch for worktree readiness and start deferred session
    useEffect(() => {
        const pending = pendingSessionRef.current;
        if (!pending) return;

        const task = tasks.find((t) => t.id === pending.taskId);
        if (!task) {
            pendingSessionRef.current = null;
            return;
        }

        if (!task.worktree.enabled || task.worktree.path) {
            pendingSessionRef.current = null;
            void createSession(
                { taskId: pending.taskId },
                pending.type,
                undefined,
                pending.description,
                undefined,
                pending.agentOptions,
            );
        }
    }, [tasks, createSession]);

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
            parentId?: string;
            startWith?: "claude" | "codex";
            agentOptions?: AgentLaunchOptions;
        }) => {
            try {
                const task = await createTask(data);
                setActiveProject(task.projectId);
                setActiveTask(task.id);
                if (data.startWith) {
                    if (data.worktree && !data.parentId) {
                        // Defer session start until worktree is ready
                        pendingSessionRef.current = {
                            taskId: task.id,
                            type: data.startWith,
                            description: data.description,
                            agentOptions: data.agentOptions,
                        };
                    } else {
                        await createSession(
                            { taskId: task.id },
                            data.startWith,
                            undefined,
                            data.description,
                            undefined,
                            data.agentOptions,
                        );
                    }
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
                parentId={parentTaskId}
                onSubmit={(data) => void handleCreateTask(data)}
            />
        </>
    );
}
