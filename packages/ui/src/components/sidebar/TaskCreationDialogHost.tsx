import { useCallback, useEffect, useRef } from "react";
import type { AgentLaunchOptions } from "@taskflow/shared";
import { requirePrimary } from "@/stores/backend-store";
import { useProjectStore } from "@/stores/project-store";
import { useSessionStore } from "@/stores/session-store";
import { useTaskStore } from "@/stores/task-store";
import { useFlowStore } from "@/stores/flow-store";
import {
    taskCreationBackend,
    taskCreationFlows,
    useTaskCreationStore,
} from "@/stores/task-creation-store";
import { useUIStore } from "@/stores/ui-store";
import { NewProjectDialog } from "./NewProjectDialog";
import { NewTaskDialog } from "./NewTaskDialog";
import { takeReadyStarts, type PendingTaskStart } from "./pending-task-starts";

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
        preferredProjectId,
        prefill,
        setNewTaskOpen,
        setNewProjectOpen,
        setProjectError,
        handleProjectCreated,
    } = useTaskCreationStore();

    const pendingStartsRef = useRef(new Map<string, PendingTaskStart>());
    const firstActiveProjectId = projects.find((project) => !project.hidden)?.id;

    const flowsFor = useCallback(
        (projectId: string) =>
            taskCreationFlows(
                { projectId, parentId: parentTaskId ?? undefined },
                projects,
                tasks,
                flowDefinitions,
            ),
        [parentTaskId, projects, tasks, flowDefinitions],
    );

    const defaultProjectId =
        preferredProjectId ??
        (activeTaskId
            ? (tasks.find((task) => task.id === activeTaskId)?.projectId ?? firstActiveProjectId)
            : (activeProjectId ?? firstActiveProjectId));

    // Watch for worktree readiness and start deferred session or flow
    useEffect(() => {
        for (const { task, start } of takeReadyStarts(pendingStartsRef.current, tasks)) {
            if (start.kind === "flow") {
                void useFlowStore
                    .getState()
                    .startFlow(task.backendId, { taskId: task.id, flowId: start.flowId });
            } else {
                void createSession(
                    { taskId: task.id },
                    start.type,
                    undefined,
                    start.description,
                    undefined,
                    start.agentOptions,
                );
            }
        }
    }, [tasks, createSession]);

    const handleProjectSubmit = useCallback(
        async (path: string) => {
            try {
                setProjectError(null);
                // Add Project stays on primary; Task 19 gates it per target.
                await addProject(requirePrimary(), path);
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
            startWith?: "claude" | "codex" | "opencode" | "pi" | "kimi";
            agentOptions?: AgentLaunchOptions;
            startWithFlowId?: string;
            initCommand?: string;
        }) => {
            try {
                const task = await createTask(taskCreationBackend(data, projects, tasks), data);
                setActiveProject(task.projectId);
                setActiveTask(task.id);
                if (data.startWithFlowId) {
                    if (data.worktree && !data.parentId) {
                        pendingStartsRef.current.set(task.id, {
                            kind: "flow",
                            flowId: data.startWithFlowId,
                        });
                    } else {
                        void useFlowStore.getState().startFlow(task.backendId, {
                            taskId: task.id,
                            flowId: data.startWithFlowId,
                        });
                    }
                } else if (data.startWith) {
                    if (data.worktree && !data.parentId) {
                        // Defer session start until worktree is ready
                        pendingStartsRef.current.set(task.id, {
                            kind: "session",
                            type: data.startWith,
                            description: data.description,
                            agentOptions: data.agentOptions,
                        });
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
        [createSession, createTask, projects, tasks, setActiveProject, setActiveTask],
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
                flowsFor={flowsFor}
                defaultProjectId={defaultProjectId}
                parentId={parentTaskId}
                prefill={prefill}
                onSubmit={(data) => void handleCreateTask(data)}
            />
        </>
    );
}
