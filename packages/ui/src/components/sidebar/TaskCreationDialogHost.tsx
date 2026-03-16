import { useCallback, useEffect, useRef } from "react";
import type { AgentLaunchOptions } from "@taskflow/shared";
import { useProjectStore } from "@/stores/project-store";
import { useSessionStore } from "@/stores/session-store";
import { useTaskStore } from "@/stores/task-store";
import { useFlowStore } from "@/stores/flow-store";
import { useTaskCreationStore } from "@/stores/task-creation-store";
import { useUIStore } from "@/stores/ui-store";
import { NewProjectDialog } from "./NewProjectDialog";
import { NewTaskDialog } from "./NewTaskDialog";

interface PendingSession {
    taskId: string;
    type: "claude" | "codex" | "opencode";
    description: string;
    agentOptions?: AgentLaunchOptions;
}

interface PendingFlow {
    taskId: string;
    flowId: string;
}

export function TaskCreationDialogHost() {
    const { projects, addProject } = useProjectStore();
    const { tasks, activeTaskId, setActiveTask, createTask } = useTaskStore();
    const flowDefinitions = useFlowStore((s) => s.flows);
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
    const pendingFlowRef = useRef<PendingFlow | null>(null);

    const defaultProjectId = activeTaskId
        ? (tasks.find((task) => task.id === activeTaskId)?.projectId ?? projects[0]?.id)
        : (activeProjectId ?? projects[0]?.id);

    // Watch for worktree readiness and start deferred session or flow
    useEffect(() => {
        const pendingSession = pendingSessionRef.current;
        if (pendingSession) {
            const task = tasks.find((t) => t.id === pendingSession.taskId);
            if (!task) {
                pendingSessionRef.current = null;
            } else if (!task.worktree.enabled || task.worktree.path) {
                pendingSessionRef.current = null;
                void createSession(
                    { taskId: pendingSession.taskId },
                    pendingSession.type,
                    undefined,
                    pendingSession.description,
                    undefined,
                    pendingSession.agentOptions,
                );
            }
        }

        const pendingFlow = pendingFlowRef.current;
        if (pendingFlow) {
            const task = tasks.find((t) => t.id === pendingFlow.taskId);
            if (!task) {
                pendingFlowRef.current = null;
            } else if (!task.worktree.enabled || task.worktree.path) {
                pendingFlowRef.current = null;
                void useFlowStore
                    .getState()
                    .startFlow({ taskId: pendingFlow.taskId, flowId: pendingFlow.flowId });
            }
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
            startWith?: "claude" | "codex" | "opencode";
            agentOptions?: AgentLaunchOptions;
            startWithFlowId?: string;
        }) => {
            try {
                const task = await createTask(data);
                setActiveProject(task.projectId);
                setActiveTask(task.id);
                if (data.startWithFlowId) {
                    if (data.worktree && !data.parentId) {
                        pendingFlowRef.current = {
                            taskId: task.id,
                            flowId: data.startWithFlowId,
                        };
                    } else {
                        void useFlowStore
                            .getState()
                            .startFlow({ taskId: task.id, flowId: data.startWithFlowId });
                    }
                } else if (data.startWith) {
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
                flows={flowDefinitions}
                defaultProjectId={defaultProjectId}
                parentId={parentTaskId}
                onSubmit={(data) => void handleCreateTask(data)}
            />
        </>
    );
}
