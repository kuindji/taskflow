import { useCallback, useEffect, useState } from "react";
import type {
    ActionDefinition,
    AgentCommand,
    AgentLaunchOptions,
    FileStatResponse,
    FlowInputDefinition,
} from "@taskflow/shared";
import { DEFAULT_TERMINAL_SHELL, MSG } from "@taskflow/shared";
import { useSessionStore } from "@/stores/session-store";
import { useActiveWorkspace } from "@/hooks/useActiveWorkspace";
import { useTaskStore } from "@/stores/task-store";
import { useUIStore } from "@/stores/ui-store";
import { sendRequest } from "@/hooks/useWebSocket";
import { TaskHeader } from "./TaskHeader";
import { SplitContainer } from "./SplitContainer";
import { FlowInputDialog } from "@/components/flows/FlowInputDialog";
import { getShellSessionLabel } from "@/lib/terminal-shells";
import { runInShell } from "@/lib/run-in-shell";
import { useFlowStore } from "@/stores/flow-store";
import { useSettingsStore } from "@/stores/settings-store";
import useIsElectron from "@/hooks/useIsElectron";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2 } from "lucide-react";

import { useSessionSync } from "./hooks/useSessionSync";
import { useWorkspaceKeyboardShortcuts } from "./hooks/useWorkspaceKeyboardShortcuts";
import { useWorkspaceTabOps } from "./hooks/useWorkspaceTabOps";

function getFocusedWorkspaceKey(baseKey: string): string {
    const split = useUIStore.getState().splitByWorkspace[baseKey];
    if (split?.open && split.activePane === "right") {
        return `${baseKey}:right`;
    }
    return baseKey;
}

export function Workspace() {
    const isElectron = useIsElectron();
    const workspace = useActiveWorkspace();
    const createSession = useSessionStore((s) => s.createSession);
    const addTab = useSessionStore((s) => s.addTab);
    const updateTask = useTaskStore((s) => s.updateTask);
    const deleteTask = useTaskStore((s) => s.deleteTask);
    const setFocusedPanel = useUIStore((s) => s.setFocusedPanel);
    const toggleFlowManagement = useUIStore((s) => s.toggleFlowManagement);
    const [worktreeMissingDialogOpen, setWorktreeMissingDialogOpen] = useState(false);
    const [flowInputState, setFlowInputState] = useState<{
        flowId: string;
        flowName: string;
        inputs: FlowInputDefinition[];
        owner: { taskId?: string; projectId?: string; flowId: string };
    } | null>(null);
    const configuredShell = useSettingsStore(
        (s) => s.settings?.terminal.defaultShell ?? DEFAULT_TERMINAL_SHELL,
    );
    const defaultRuntime = useSettingsStore((s) => s.settings?.general.defaultRuntime ?? "bun");

    const {
        scripts,
        agentCommands,
        defaultShellPath,
        flowRunsReady,
        flowDefinitions,
        standaloneActions,
        activeFlowRun,
        hasScripts,
    } = useSessionSync(workspace);

    const {
        handleCloseActiveTab,
        handleOpenNewTask,
        handleOpenDefaultTerminal,
        handleOpenDefaultAgent,
    } = useWorkspaceTabOps({
        workspace,
        defaultShellPath,
        configuredShell,
    });

    useWorkspaceKeyboardShortcuts({
        handleCloseActiveTab,
        handleOpenNewTask,
        handleOpenDefaultTerminal,
        handleOpenDefaultAgent,
        isElectron,
        workspaceKey: workspace.workspaceKey,
    });

    const taskId = workspace.scope === "task" ? workspace.task?.id : undefined;

    const worktreePending =
        workspace.scope === "task" &&
        workspace.task?.worktree.enabled &&
        !workspace.task.worktree.path;

    // Validate worktree existence when task is activated
    useEffect(() => {
        if (
            workspace.scope !== "task" ||
            !workspace.task?.worktree.enabled ||
            !workspace.task.worktree.path
        ) {
            return;
        }

        let cancelled = false;
        sendRequest<FileStatResponse>(MSG.FILE_STAT, { path: workspace.task.worktree.path })
            .then(({ exists }) => {
                if (!cancelled && !exists) {
                    setWorktreeMissingDialogOpen(true);
                }
            })
            .catch(() => {
                // Ignore errors — worktree path might just not exist yet
            });

        return () => {
            cancelled = true;
        };
    }, [
        workspace.scope,
        workspace.task?.id,
        workspace.task?.worktree.enabled,
        workspace.task?.worktree.path,
    ]);

    const handleWorktreeReset = useCallback(() => {
        if (!workspace.task) return;
        void updateTask(workspace.task.id, {
            worktree: { enabled: false, path: null, branch: null, pr: null },
        });
        setWorktreeMissingDialogOpen(false);
    }, [workspace.task, updateTask]);

    const handleWorktreeDeleteTask = useCallback(() => {
        if (!workspace.task) return;
        void deleteTask(workspace.task.id);
        setWorktreeMissingDialogOpen(false);
    }, [workspace.task, deleteTask]);

    const canShowGitControls =
        !!workspace.project &&
        (workspace.scope !== "task" ||
            !workspace.task?.worktree.enabled ||
            !!workspace.task.worktree.path);

    if (!workspace.scope) {
        return (
            <>
                {isElectron && <TaskHeader />}
                <div className="text-muted-foreground flex flex-1 items-center justify-center text-sm">
                    Select a task or project from the sidebar
                </div>
            </>
        );
    }

    const handleNewTab = async (
        type: "claude" | "codex" | "opencode" | "pi" | "kimi" | "browser" | "shell",
        shellPath?: string,
        agentOptions?: AgentLaunchOptions,
    ) => {
        if (!workspace.workspaceKey) return;
        if (type === "browser") {
            setFocusedPanel("workspace");
            addTab(getFocusedWorkspaceKey(workspace.workspaceKey), {
                id: crypto.randomUUID(),
                type: "browser",
                label: "New Tab",
                url: "about:blank",
            });
        } else if (type === "shell" && shellPath) {
            setFocusedPanel("workspace");
            await createSession(
                workspace.scope === "task"
                    ? { taskId: workspace.task.id }
                    : workspace.scope === "project"
                      ? { projectId: workspace.project.id }
                      : { master: true as const },
                "shell",
                getShellSessionLabel(shellPath),
                undefined,
                shellPath,
                undefined,
                undefined,
                undefined,
                getFocusedWorkspaceKey(workspace.workspaceKey),
            );
        } else {
            setFocusedPanel("workspace");
            await createSession(
                workspace.scope === "task"
                    ? { taskId: workspace.task.id }
                    : workspace.scope === "project"
                      ? { projectId: workspace.project.id }
                      : { master: true as const },
                type,
                undefined,
                undefined,
                undefined,
                agentOptions,
                undefined,
                undefined,
                getFocusedWorkspaceKey(workspace.workspaceKey),
            );
        }
    };

    const handleRunAgentCommand = async (command: AgentCommand) => {
        if (!workspace.workspaceKey) return;
        const owner =
            workspace.scope === "task"
                ? { taskId: workspace.task.id }
                : workspace.scope === "project"
                  ? { projectId: workspace.project.id }
                  : { master: true as const };
        setFocusedPanel("workspace");
        await createSession(
            owner,
            "claude",
            command.name,
            `/${command.name}`,
            undefined,
            undefined,
            undefined,
            undefined,
            getFocusedWorkspaceKey(workspace.workspaceKey),
        );
    };

    const handleRunAction = async (action: ActionDefinition) => {
        if (!workspace.workspaceKey) return;
        const owner =
            workspace.scope === "task"
                ? { taskId: workspace.task.id }
                : workspace.scope === "project"
                  ? { projectId: workspace.project.id }
                  : { master: true as const };
        setFocusedPanel("workspace");
        if (action.sessionType === "shell") {
            await runInShell({
                owner,
                configuredShell,
                label: action.name,
                command: action.prompt ? `${action.prompt}\r` : undefined,
                targetWorkspaceKey: getFocusedWorkspaceKey(workspace.workspaceKey),
            });
        } else {
            await createSession(
                owner,
                action.sessionType,
                action.name,
                action.prompt,
                undefined,
                action.agentOptions,
                undefined,
                undefined,
                getFocusedWorkspaceKey(workspace.workspaceKey),
            );
        }
    };

    const handleStartFlow = (flowId: string) => {
        const owner = taskId
            ? { taskId, flowId }
            : workspace.project
              ? { projectId: workspace.project.id, flowId }
              : workspace.scope === "master"
                ? { master: true as const, flowId }
                : null;
        if (!owner) return;

        const flow = useFlowStore.getState().flows.find((f) => f.id === flowId);
        if (flow?.inputs && flow.inputs.length > 0) {
            setFlowInputState({
                flowId,
                flowName: flow.name,
                inputs: flow.inputs,
                owner,
            });
            return;
        }

        void useFlowStore.getState().startFlow(owner);
    };

    if (workspace.scope === "master") {
        return (
            <>
                <SplitContainer
                    workspaceKey={workspace.workspaceKey}
                    projectPath={workspace.workingDir}
                    onNewTab={handleNewTab}
                    onRunTab={() => {}}
                    onRunScript={() => {}}
                    onRunAction={handleRunAction}
                    onRunAgentCommand={handleRunAgentCommand}
                    onStartFlow={handleStartFlow}
                    onManageFlows={toggleFlowManagement}
                    scripts={{}}
                    defaultRuntime={defaultRuntime}
                    flows={flowRunsReady ? flowDefinitions : []}
                    standaloneActions={standaloneActions}
                    agentCommands={agentCommands}
                    activeFlowRun={activeFlowRun ?? null}
                    showRunButton={
                        agentCommands.length > 0 ||
                        standaloneActions.length > 0 ||
                        (flowRunsReady && flowDefinitions.length > 0)
                    }
                    showAgentOptions={false}
                    allowSessionTabs={true}
                    isElectron={isElectron}
                />
            </>
        );
    }

    const openSingletonTab = (type: "changes" | "history", label: string) => {
        if (!workspace.workspaceKey) return;
        const store = useSessionStore.getState();
        const rightKey = `${workspace.workspaceKey}:right`;
        const allTabs = [
            ...(store.tabsByWorkspace[workspace.workspaceKey] ?? []),
            ...(store.tabsByWorkspace[rightKey] ?? []),
        ];
        const existingTab = allTabs.find((tab) => tab.type === type);
        if (existingTab) {
            const rightTabs = store.tabsByWorkspace[rightKey] ?? [];
            if (rightTabs.some((t) => t.id === existingTab.id)) {
                store.setActiveTab(rightKey, existingTab.id);
            } else {
                store.setActiveTab(workspace.workspaceKey, existingTab.id);
            }
            return;
        }
        const split = useUIStore.getState().splitByWorkspace[workspace.workspaceKey];
        const targetKey =
            split?.open && split.activePane === "right" ? rightKey : workspace.workspaceKey;
        store.addTab(targetKey, { id: crypto.randomUUID(), type, label });
    };

    const handleDiffTab = () => openSingletonTab("changes", "Changes");
    const handleHistoryTab = () => openSingletonTab("history", "History");

    const handleRunTab = async (
        type: "claude" | "codex" | "opencode" | "pi" | "kimi",
        agentOptions?: AgentLaunchOptions,
    ) => {
        if (workspace.scope !== "task" || !workspace.task) return;
        setFocusedPanel("workspace");
        await createSession(
            { taskId: workspace.task.id },
            type,
            undefined,
            workspace.task.description || undefined,
            undefined,
            agentOptions,
            undefined,
            undefined,
            getFocusedWorkspaceKey(workspace.workspaceKey),
        );
    };

    const handleFlowInputSubmit = (values: Record<string, string>) => {
        if (!flowInputState) return;
        void useFlowStore.getState().startFlow({
            ...flowInputState.owner,
            inputValues: values,
        });
        setFlowInputState(null);
    };

    const handleRunScript = async (scriptName: string) => {
        if (!workspace.workspaceKey) return;
        const owner =
            workspace.scope === "task"
                ? { taskId: workspace.task.id }
                : { projectId: workspace.project.id };
        setFocusedPanel("workspace");
        await runInShell({
            owner,
            configuredShell,
            label: scriptName,
            command: `${defaultRuntime} run ${scriptName}\r`,
            targetWorkspaceKey: getFocusedWorkspaceKey(workspace.workspaceKey),
        });
    };

    return (
        <>
            <TaskHeader
                task={workspace.task ?? undefined}
                project={workspace.project}
                onDiff={canShowGitControls ? handleDiffTab : undefined}
                onHistory={canShowGitControls ? handleHistoryTab : undefined}
            />
            {worktreePending ? (
                <div className="text-muted-foreground flex flex-1 flex-col items-center justify-center gap-2 text-sm">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    Setting up worktree...
                </div>
            ) : (
                <SplitContainer
                    workspaceKey={workspace.workspaceKey}
                    projectPath={workspace.workingDir}
                    onNewTab={handleNewTab}
                    onRunTab={handleRunTab}
                    onRunScript={handleRunScript}
                    onRunAction={handleRunAction}
                    onRunAgentCommand={handleRunAgentCommand}
                    onStartFlow={handleStartFlow}
                    onManageFlows={toggleFlowManagement}
                    scripts={scripts}
                    defaultRuntime={defaultRuntime}
                    flows={flowRunsReady ? flowDefinitions : []}
                    standaloneActions={standaloneActions}
                    agentCommands={agentCommands}
                    activeFlowRun={activeFlowRun ?? null}
                    showRunButton={
                        workspace.scope === "task" ||
                        hasScripts ||
                        standaloneActions.length > 0 ||
                        agentCommands.length > 0 ||
                        (flowRunsReady && flowDefinitions.length > 0)
                    }
                    showAgentOptions={workspace.scope === "task"}
                    allowSessionTabs={true}
                    isElectron={isElectron}
                />
            )}
            {flowInputState && (
                <FlowInputDialog
                    key={flowInputState.flowId}
                    open
                    flowName={flowInputState.flowName}
                    inputs={flowInputState.inputs}
                    onSubmit={handleFlowInputSubmit}
                    onCancel={() => setFlowInputState(null)}
                />
            )}
            <AlertDialog
                open={worktreeMissingDialogOpen}
                onOpenChange={setWorktreeMissingDialogOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Worktree not found</AlertDialogTitle>
                        <AlertDialogDescription>
                            The worktree directory for this task no longer exists
                            {workspace.task?.worktree.branch && (
                                <> (branch: {workspace.task.worktree.branch})</>
                            )}
                            . It may have been removed externally.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogAction
                            onClick={handleWorktreeDeleteTask}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                            Delete task
                        </AlertDialogAction>
                        <AlertDialogCancel onClick={handleWorktreeReset}>
                            Reset to project root
                        </AlertDialogCancel>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
}
