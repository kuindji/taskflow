import { useCallback, useEffect, useMemo, useState } from "react";
import type {
    ActionDefinition,
    AgentLaunchOptions,
    CursorRulesCheckResponse,
    ScriptsListResponse,
    ShellListResponse,
} from "@taskflow/shared";
import { DEFAULT_TERMINAL_SHELL, MSG } from "@taskflow/shared";
import { useSessionStore, isSessionExited } from "@/stores/session-store";
import type { Tab } from "@/stores/session-store";
import { useActiveWorkspace } from "@/hooks/useActiveWorkspace";
import { useTaskStore } from "@/stores/task-store";
import { useTaskCreationStore } from "@/stores/task-creation-store";
import { useUIStore } from "@/stores/ui-store";
import { sendRequest } from "@/hooks/useWebSocket";
import { TaskHeader } from "./TaskHeader";
import { TabBar } from "./TabBar";
import { TabContent } from "./TabContent";

import { destroyTerminal } from "@/components/panes/TerminalPane";
import { isEditorDirty, clearEditorDirty } from "@/components/panes/editor-dirty-state";
import { confirm } from "@/stores/dialog-store";
import { getShellSessionLabel, resolveTerminalShellPath } from "@/lib/terminal-shells";
import { useFlowStore, filterByProject } from "@/stores/flow-store";
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

const emptyTabs: Tab[] = [];
const emptyScripts: Record<string, string> = {};

export function Workspace() {
    const isElectron = useIsElectron();
    const workspace = useActiveWorkspace();
    const tabs = useSessionStore((s) =>
        workspace.workspaceKey
            ? (s.tabsByWorkspace[workspace.workspaceKey] ?? emptyTabs)
            : emptyTabs,
    );
    const activeTabId = useSessionStore((s) =>
        workspace.workspaceKey ? (s.activeTabByWorkspace[workspace.workspaceKey] ?? "") : "",
    );
    const setActiveTab = useSessionStore((s) => s.setActiveTab);
    const closeTab = useSessionStore((s) => s.closeTab);
    const createSession = useSessionStore((s) => s.createSession);
    const addTab = useSessionStore((s) => s.addTab);
    const sendInput = useSessionStore((s) => s.sendInput);
    const renameTab = useSessionStore((s) => s.renameTab);
    const setActiveTask = useTaskStore((s) => s.setActiveTask);
    const updateTask = useTaskStore((s) => s.updateTask);
    const deleteTask = useTaskStore((s) => s.deleteTask);
    const requestNewTask = useTaskCreationStore((s) => s.requestNewTask);
    const setActiveProject = useUIStore((s) => s.setActiveProject);
    const openSettings = useUIStore((s) => s.openSettings);
    const toggleFileExplorer = useUIStore((s) => s.toggleFileExplorer);
    const toggleTaskInfo = useUIStore((s) => s.toggleTaskInfo);
    const [worktreeMissingDialogOpen, setWorktreeMissingDialogOpen] = useState(false);
    const [cursorRulesDialog, setCursorRulesDialog] = useState<{
        pending: true;
        type: "new" | "run";
        agentOptions?: AgentLaunchOptions;
    } | null>(null);
    const [scripts, setScripts] = useState<Record<string, string>>(emptyScripts);
    const [defaultShellPath, setDefaultShellPath] = useState<string | null>(null);
    const [flowRunsHydratedOwnerId, setFlowRunsHydratedOwnerId] = useState<string | null>(null);
    const configuredShell = useSettingsStore(
        (s) => s.settings?.terminal.defaultShell ?? DEFAULT_TERMINAL_SHELL,
    );
    const defaultRuntime = useSettingsStore((s) => s.settings?.general.defaultRuntime ?? "bun");
    const toggleFlowManagement = useUIStore((s) => s.toggleFlowManagement);
    const taskId = workspace.scope === "task" ? workspace.task?.id : undefined;
    const ownerId = taskId ?? workspace.project?.id;
    const activeFlowRun = useFlowStore((s) => (ownerId ? s.activeRuns[ownerId] : undefined));
    const allFlows = useFlowStore((s) => s.flows);
    const allActions = useFlowStore((s) => s.actions);
    const currentProjectId = workspace.project?.id ?? null;
    const flowDefinitions = useMemo(
        () => filterByProject(allFlows, currentProjectId),
        [allFlows, currentProjectId],
    );
    const standaloneActions = useMemo(
        () => filterByProject(allActions, currentProjectId).filter((a) => a.standalone),
        [allActions, currentProjectId],
    );

    useEffect(() => {
        // Fetch flow/action definitions so the Run menu can show them
        const store = useFlowStore.getState();
        void store.fetchFlows();
        void store.fetchActions();
    }, [workspace.project?.id]);

    useEffect(() => {
        if (!ownerId) {
            setFlowRunsHydratedOwnerId(null);
            return;
        }

        let cancelled = false;
        setFlowRunsHydratedOwnerId(null);
        void useFlowStore
            .getState()
            .fetchFlowRuns(ownerId)
            .then(() => {
                if (!cancelled) {
                    setFlowRunsHydratedOwnerId(ownerId);
                }
            })
            .catch(() => {
                // Keep the start control hidden until we can confirm the current owner state.
            });

        return () => {
            cancelled = true;
        };
    }, [ownerId]);

    const flowRunsReady = flowRunsHydratedOwnerId === ownerId;

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
        sendRequest<{ exists: boolean }>(MSG.FILE_STAT, { path: workspace.task.worktree.path })
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

    useEffect(() => {
        if (!workspace.workingDir) {
            setScripts(emptyScripts);
            return;
        }
        let cancelled = false;
        sendRequest<ScriptsListResponse>(MSG.SCRIPTS_LIST, { path: workspace.workingDir })
            .then((res) => {
                if (cancelled) return;
                setScripts(res.scripts);
            })
            .catch(() => {
                if (!cancelled) setScripts(emptyScripts);
            });
        return () => {
            cancelled = true;
        };
    }, [workspace.workingDir]);

    useEffect(() => {
        sendRequest<ShellListResponse>(MSG.SHELLS_LIST, {}).then(
            (res) =>
                setDefaultShellPath(
                    resolveTerminalShellPath(res.shells, res.systemShellPath, configuredShell),
                ),
            () => setDefaultShellPath(null),
        );
    }, [configuredShell]);

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

    const hasScripts = Object.keys(scripts).length > 0;

    const canShowGitControls =
        !!workspace.project &&
        (workspace.scope !== "task" ||
            !workspace.task?.worktree.enabled ||
            !!workspace.task.worktree.path);

    const visibleTabs = tabs;

    const activeTab = visibleTabs.find((t) => t.id === activeTabId) ?? visibleTabs[0];

    const handleCloseActiveTab = useCallback(() => {
        if (activeTab && workspace.workspaceKey) {
            if (activeTab.sessionId) destroyTerminal(activeTab.sessionId);
            void closeTab(workspace.workspaceKey, activeTab.id);
        } else if (workspace.scope === "task") {
            setActiveTask(null);
        } else if (workspace.scope === "project") {
            setActiveProject(null);
        }
    }, [
        activeTab,
        workspace.workspaceKey,
        workspace.scope,
        closeTab,
        setActiveTask,
        setActiveProject,
    ]);

    const handleOpenNewTask = useCallback(() => {
        requestNewTask();
    }, [requestNewTask]);

    const handleOpenDefaultTerminal = useCallback(async () => {
        if (workspace.scope !== "task" && workspace.scope !== "project") {
            return;
        }

        let shell = defaultShellPath;
        if (!shell) {
            const res = await sendRequest<ShellListResponse>(MSG.SHELLS_LIST, {});
            shell = resolveTerminalShellPath(res.shells, res.systemShellPath, configuredShell);
        }
        if (!shell) return;

        const owner =
            workspace.scope === "task"
                ? { taskId: workspace.task.id }
                : { projectId: workspace.project.id };
        await createSession(owner, "shell", getShellSessionLabel(shell), undefined, shell);
    }, [
        configuredShell,
        createSession,
        defaultShellPath,
        workspace.project,
        workspace.scope,
        workspace.task,
    ]);

    useEffect(() => {
        const cleanupFns: Array<() => void> = [];
        const onCloseTab = isElectron ? window.taskflow?.onCloseTab : undefined;
        const onNewTask = isElectron ? window.taskflow?.onNewTask : undefined;
        const onNewTerminal = isElectron ? window.taskflow?.onNewTerminal : undefined;
        const onOpenSettings = isElectron ? window.taskflow?.onOpenSettings : undefined;

        if (onCloseTab) {
            cleanupFns.push(onCloseTab(handleCloseActiveTab));
        }
        if (onNewTask) {
            cleanupFns.push(onNewTask(handleOpenNewTask));
        }
        if (onNewTerminal) {
            cleanupFns.push(onNewTerminal(() => void handleOpenDefaultTerminal()));
        }
        if (onOpenSettings) {
            cleanupFns.push(onOpenSettings(openSettings));
        }

        const needsCloseTabFallback = !onCloseTab;
        const needsNewTaskFallback = !onNewTask;
        const needsNewTerminalFallback = !onNewTerminal;
        const needsFileExplorerFallback = !window.taskflow?.onToggleFileExplorer;
        const needsTaskInfoFallback = !window.taskflow?.onToggleTaskInfo;

        const onKeyDown = (e: KeyboardEvent) => {
            if (!(e.metaKey || e.ctrlKey)) return;

            if (needsCloseTabFallback && e.key.toLowerCase() === "w") {
                e.preventDefault();
                handleCloseActiveTab();
                return;
            }

            if (needsNewTaskFallback && e.key.toLowerCase() === "n") {
                e.preventDefault();
                handleOpenNewTask();
                return;
            }

            if (needsNewTerminalFallback && e.key.toLowerCase() === "t") {
                e.preventDefault();
                void handleOpenDefaultTerminal();
                return;
            }

            if (needsFileExplorerFallback && e.key.toLowerCase() === "e") {
                e.preventDefault();
                toggleFileExplorer();
                return;
            }

            if (needsTaskInfoFallback && e.key.toLowerCase() === "i") {
                e.preventDefault();
                toggleTaskInfo();
            }
        };

        if (
            needsCloseTabFallback ||
            needsNewTaskFallback ||
            needsNewTerminalFallback ||
            needsFileExplorerFallback ||
            needsTaskInfoFallback
        ) {
            window.addEventListener("keydown", onKeyDown);
        }

        return () => {
            cleanupFns.forEach((cleanup) => cleanup());
            if (
                needsCloseTabFallback ||
                needsNewTaskFallback ||
                needsNewTerminalFallback ||
                needsFileExplorerFallback ||
                needsTaskInfoFallback
            ) {
                window.removeEventListener("keydown", onKeyDown);
            }
        };
    }, [
        isElectron,
        handleCloseActiveTab,
        handleOpenDefaultTerminal,
        handleOpenNewTask,
        openSettings,
        toggleFileExplorer,
        toggleTaskInfo,
    ]);

    useEffect(() => {
        if (!workspace.workspaceKey || !activeTab || activeTab.id === activeTabId) {
            return;
        }
        setActiveTab(workspace.workspaceKey, activeTab.id);
    }, [activeTab, activeTabId, setActiveTab, workspace.workspaceKey]);

    if (!workspace.scope || !workspace.project) {
        return (
            <>
                {isElectron && <TaskHeader />}
                <div className="text-muted-foreground flex flex-1 items-center justify-center text-sm">
                    Select a task or project from the sidebar
                </div>
            </>
        );
    }

    const handleDiffTab = () => {
        if (!workspace.workspaceKey) return;
        const existingChangesTab = tabs.find((tab) => tab.type === "changes");
        if (existingChangesTab) {
            setActiveTab(workspace.workspaceKey, existingChangesTab.id);
            return;
        }
        addTab(workspace.workspaceKey, {
            id: crypto.randomUUID(),
            type: "changes",
            label: "Changes",
        });
    };

    const handleNewTab = async (
        type: "claude" | "codex" | "opencode" | "gemini" | "cursor" | "browser" | "shell",
        shellPath?: string,
        agentOptions?: AgentLaunchOptions,
        skipCursorRulesCheck?: boolean,
    ) => {
        if (!workspace.workspaceKey) return;
        if (type === "cursor" && workspace.workingDir && !skipCursorRulesCheck) {
            const { status } = await sendRequest<CursorRulesCheckResponse>(
                MSG.CURSOR_RULES_CHECK,
                { cwd: workspace.workingDir },
            );
            if (status === "missing") {
                setCursorRulesDialog({ pending: true, type: "new", agentOptions });
                return;
            }
        }
        if (type === "browser") {
            addTab(workspace.workspaceKey, {
                id: crypto.randomUUID(),
                type: "browser",
                label: "New Tab",
                url: "about:blank",
            });
        } else if (type === "shell" && shellPath) {
            await createSession(
                workspace.scope === "task"
                    ? { taskId: workspace.task.id }
                    : { projectId: workspace.project.id },
                "shell",
                getShellSessionLabel(shellPath),
                undefined,
                shellPath,
            );
        } else {
            await createSession(
                workspace.scope === "task"
                    ? { taskId: workspace.task.id }
                    : { projectId: workspace.project.id },
                type,
                undefined,
                undefined,
                undefined,
                agentOptions,
            );
        }
    };

    const handleRunTab = async (
        type: "claude" | "codex" | "opencode" | "gemini" | "cursor",
        agentOptions?: AgentLaunchOptions,
        skipCursorRulesCheck?: boolean,
    ) => {
        if (workspace.scope !== "task" || !workspace.task) return;
        if (type === "cursor" && workspace.workingDir && !skipCursorRulesCheck) {
            const { status } = await sendRequest<CursorRulesCheckResponse>(
                MSG.CURSOR_RULES_CHECK,
                { cwd: workspace.workingDir },
            );
            if (status === "missing") {
                setCursorRulesDialog({ pending: true, type: "run", agentOptions });
                return;
            }
        }
        await createSession(
            { taskId: workspace.task.id },
            type,
            undefined,
            workspace.task.description || undefined,
            undefined,
            agentOptions,
        );
    };

    const handleRunAction = async (action: ActionDefinition) => {
        const owner =
            workspace.scope === "task"
                ? { taskId: workspace.task.id }
                : { projectId: workspace.project.id };
        await createSession(
            owner,
            action.sessionType,
            action.name,
            action.prompt,
            undefined,
            action.sessionType !== "shell" ? action.agentOptions : undefined,
        );
    };

    const handleStartFlow = (flowId: string) => {
        const owner = taskId
            ? { taskId, flowId }
            : workspace.project
              ? { projectId: workspace.project.id, flowId }
              : null;
        if (!owner) return;
        void useFlowStore.getState().startFlow(owner);
    };

    const handleRunScript = async (scriptName: string) => {
        if (!workspace.workspaceKey) return;
        let shell = defaultShellPath;
        if (!shell) {
            const res = await sendRequest<ShellListResponse>(MSG.SHELLS_LIST, {});
            shell = resolveTerminalShellPath(res.shells, res.systemShellPath, configuredShell);
        }
        if (!shell) return;
        const owner =
            workspace.scope === "task"
                ? { taskId: workspace.task.id }
                : { projectId: workspace.project.id };
        const sessionId = await createSession(owner, "shell", scriptName, undefined, shell);
        sendInput(sessionId, `${defaultRuntime} run ${scriptName}\r`);
    };

    return (
        <>
            <TaskHeader
                task={workspace.task ?? undefined}
                project={workspace.project}
                onDiff={canShowGitControls ? handleDiffTab : undefined}
            />
            {worktreePending ? (
                <div className="text-muted-foreground flex flex-1 flex-col items-center justify-center gap-2 text-sm">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    Setting up worktree...
                </div>
            ) : (
                <>
                    <TabBar
                        tabs={visibleTabs}
                        activeTabId={activeTab?.id ?? ""}
                        onTabClick={(id) =>
                            workspace.workspaceKey && setActiveTab(workspace.workspaceKey, id)
                        }
                        onTabClose={(id) => {
                            if (!workspace.workspaceKey) return;
                            const tab = visibleTabs.find((t) => t.id === id);

                            const doClose = () => {
                                if (tab?.filePath) clearEditorDirty(tab.filePath);
                                if (tab?.sessionId) destroyTerminal(tab.sessionId);
                                void closeTab(workspace.workspaceKey, id);
                            };

                            if (tab?.type === "editor" && tab.filePath && isEditorDirty(tab.filePath)) {
                                void confirm({
                                    title: "Unsaved Changes",
                                    description: `"${tab.filePath.split("/").pop()}" has unsaved changes that will be lost.`,
                                    confirmLabel: "Close Without Saving",
                                    cancelLabel: "Cancel",
                                    variant: "destructive",
                                    onConfirm: async () => doClose(),
                                });
                                return;
                            }

                            if (
                                tab?.type === "editor" &&
                                tab.sessionId &&
                                !isSessionExited(tab.sessionId)
                            ) {
                                void confirm({
                                    title: "Editor Still Running",
                                    description: `"${tab.label}" is still running. Unsaved changes will be lost.`,
                                    confirmLabel: "Close Editor",
                                    cancelLabel: "Cancel",
                                    variant: "destructive",
                                    onConfirm: async () => doClose(),
                                });
                                return;
                            }

                            doClose();
                        }}
                        onTabRename={(id, newLabel) => {
                            if (workspace.workspaceKey) {
                                renameTab(workspace.workspaceKey, id, newLabel);
                            }
                        }}
                        onNewTab={handleNewTab}
                        onRunTab={handleRunTab}
                        onRunScript={handleRunScript}
                        onRunAction={handleRunAction}
                        onStartFlow={handleStartFlow}
                        onManageFlows={toggleFlowManagement}
                        scripts={scripts}
                        defaultRuntime={defaultRuntime}
                        flows={flowRunsReady ? flowDefinitions : []}
                        standaloneActions={standaloneActions}
                        activeFlowRun={activeFlowRun ?? null}
                        showRunButton={
                            workspace.scope === "task" ||
                            hasScripts ||
                            standaloneActions.length > 0 ||
                            (flowRunsReady && flowDefinitions.length > 0)
                        }
                        showAgentOptions={workspace.scope === "task"}
                        allowSessionTabs={true}
                    />
                    <TabContent tabs={visibleTabs} activeTabId={activeTab?.id ?? ""} />
                </>
            )}
            <AlertDialog
                open={cursorRulesDialog !== null}
                onOpenChange={(open) => {
                    if (!open) setCursorRulesDialog(null);
                }}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Cursor Rules Setup</AlertDialogTitle>
                        <AlertDialogDescription>
                            Taskflow needs to create a rules file at{" "}
                            <code>.cursor/rules/taskflow.mdc</code> in your project directory so
                            the Cursor agent can use taskflow-cli. This file will be added to
                            your project.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() => {
                                const dialog = cursorRulesDialog;
                                setCursorRulesDialog(null);
                                if (!dialog || !workspace.workingDir) return;
                                void (async () => {
                                    await sendRequest(MSG.CURSOR_RULES_ENSURE, {
                                        cwd: workspace.workingDir,
                                    });
                                    if (dialog.type === "run") {
                                        await handleRunTab("cursor", dialog.agentOptions, true);
                                    } else {
                                        await handleNewTab(
                                            "cursor",
                                            undefined,
                                            dialog.agentOptions,
                                            true,
                                        );
                                    }
                                })();
                            }}
                        >
                            Create Rules File
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
            <AlertDialog
                open={worktreeMissingDialogOpen}
                onOpenChange={setWorktreeMissingDialogOpen}
            >
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
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
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
