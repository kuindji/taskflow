import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentLaunchOptions, FlowDefinition, Task } from "@taskflow/shared";
import type { Scoped } from "@/lib/backend-scope";
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
import { FlowInputDialog } from "@/components/flows/FlowInputDialog";
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
    // A new task whose flow has inputs waits for them before it starts.
    const [flowInput, setFlowInput] = useState<{
        task: Scoped<Task>;
        flow: Scoped<FlowDefinition>;
        deferred: boolean;
    } | null>(null);
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

    const runReadyStarts = useCallback(
        (current: Scoped<Task>[]) => {
            for (const { task, start } of takeReadyStarts(pendingStartsRef.current, current)) {
                if (start.kind === "flow") {
                    void useFlowStore.getState().startFlow(task.backendId, {
                        taskId: task.id,
                        flowId: start.flowId,
                        inputValues: start.inputValues,
                    });
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
        },
        [createSession],
    );

    // Watch for worktree readiness and start deferred session or flow
    useEffect(() => {
        runReadyStarts(tasks);
    }, [tasks, runReadyStarts]);

    const startTaskFlow = useCallback(
        (
            task: Scoped<Task>,
            flowId: string,
            deferred: boolean,
            inputValues?: Record<string, string>,
        ) => {
            if (deferred) {
                pendingStartsRef.current.set(task.id, { kind: "flow", flowId, inputValues });
            } else {
                void useFlowStore
                    .getState()
                    .startFlow(task.backendId, { taskId: task.id, flowId, inputValues });
            }
        },
        [],
    );

    const handleFlowInputSubmit = useCallback(
        (values: Record<string, string>) => {
            if (!flowInput) return;
            startTaskFlow(flowInput.task, flowInput.flow.id, flowInput.deferred, values);
            // The worktree may have become ready while the inputs were asked.
            if (flowInput.deferred) runReadyStarts(useTaskStore.getState().tasks);
            setFlowInput(null);
        },
        [flowInput, startTaskFlow, runReadyStarts],
    );

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
                    const deferred = data.worktree && !data.parentId;
                    const flow = useFlowStore
                        .getState()
                        .flows.find(
                            (f) => f.backendId === task.backendId && f.id === data.startWithFlowId,
                        );
                    if (flow?.inputs && flow.inputs.length > 0) {
                        setFlowInput({ task, flow, deferred });
                    } else {
                        startTaskFlow(task, data.startWithFlowId, deferred);
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
        [
            createSession,
            createTask,
            projects,
            tasks,
            setActiveProject,
            setActiveTask,
            startTaskFlow,
        ],
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
            {flowInput && (
                <FlowInputDialog
                    open
                    backendId={flowInput.task.backendId}
                    flowName={flowInput.flow.name}
                    inputs={flowInput.flow.inputs ?? []}
                    onSubmit={handleFlowInputSubmit}
                    onCancel={() => setFlowInput(null)}
                />
            )}
        </>
    );
}
