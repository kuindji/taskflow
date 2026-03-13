import { useCallback, useEffect, useMemo, useState } from "react";
import type { AgentLaunchOptions, ScriptsListResponse, ShellListResponse } from "@taskflow/shared";
import { DEFAULT_TERMINAL_SHELL, MSG } from "@taskflow/shared";
import { useSessionStore } from "@/stores/session-store";
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
import { resolveTerminalShellPath } from "@/lib/terminal-shells";
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
    const { setActiveTab, closeTab, createSession, addTab, sendInput, renameTab } =
        useSessionStore();
    const setActiveTask = useTaskStore((s) => s.setActiveTask);
    const updateTask = useTaskStore((s) => s.updateTask);
    const deleteTask = useTaskStore((s) => s.deleteTask);
    const requestNewTask = useTaskCreationStore((s) => s.requestNewTask);
    const setActiveProject = useUIStore((s) => s.setActiveProject);
    const [worktreeMissingDialogOpen, setWorktreeMissingDialogOpen] = useState(false);
    const [scripts, setScripts] = useState<Record<string, string>>(emptyScripts);
    const [defaultShellPath, setDefaultShellPath] = useState<string | null>(null);
    const configuredShell = useSettingsStore(
        (s) => s.settings?.terminal.defaultShell ?? DEFAULT_TERMINAL_SHELL,
    );
    const defaultRuntime = useSettingsStore((s) => s.settings?.general.defaultRuntime ?? "bun");

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
            worktree: { enabled: false, path: null, branch: null },
        });
        setWorktreeMissingDialogOpen(false);
    }, [workspace.task, updateTask]);

    const handleWorktreeDeleteTask = useCallback(() => {
        if (!workspace.task) return;
        void deleteTask(workspace.task.id);
        setWorktreeMissingDialogOpen(false);
    }, [workspace.task, deleteTask]);

    const hasScripts = useMemo(() => Object.keys(scripts).length > 0, [scripts]);

    const visibleTabs = useMemo(
        () => (workspace.scope === "task" ? tabs.filter((tab) => tab.type !== "changes") : tabs),
        [tabs, workspace.scope],
    );

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

    useEffect(() => {
        const cleanupFns: Array<() => void> = [];
        const onCloseTab = isElectron ? window.taskflow?.onCloseTab : undefined;
        const onNewTask = isElectron ? window.taskflow?.onNewTask : undefined;

        if (onCloseTab) {
            cleanupFns.push(onCloseTab(handleCloseActiveTab));
        }
        if (onNewTask) {
            cleanupFns.push(onNewTask(handleOpenNewTask));
        }

        const needsCloseTabFallback = !onCloseTab;
        const needsNewTaskFallback = !onNewTask;

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
            }
        };

        if (needsCloseTabFallback || needsNewTaskFallback) {
            window.addEventListener("keydown", onKeyDown);
        }

        return () => {
            cleanupFns.forEach((cleanup) => cleanup());
            if (needsCloseTabFallback || needsNewTaskFallback) {
                window.removeEventListener("keydown", onKeyDown);
            }
        };
    }, [isElectron, handleCloseActiveTab, handleOpenNewTask]);

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
        type: "claude" | "codex" | "browser" | "shell",
        shellPath?: string,
        agentOptions?: AgentLaunchOptions,
    ) => {
        if (!workspace.workspaceKey) return;
        if (type === "browser") {
            addTab(workspace.workspaceKey, {
                id: crypto.randomUUID(),
                type: "browser",
                label: "New Tab",
                url: "about:blank",
            });
        } else if (type === "shell" && shellPath) {
            const shellName = shellPath.split("/").pop() ?? "shell";
            await createSession(
                workspace.scope === "task"
                    ? { taskId: workspace.task.id }
                    : { projectId: workspace.project.id },
                "shell",
                shellName,
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

    const handleRunTab = async (type: "claude" | "codex", agentOptions?: AgentLaunchOptions) => {
        if (workspace.scope !== "task" || !workspace.task) return;
        await createSession(
            { taskId: workspace.task.id },
            type,
            undefined,
            workspace.task.description || undefined,
            undefined,
            agentOptions,
        );
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
                onDiff={workspace.scope === "project" ? handleDiffTab : undefined}
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
                            if (tab?.sessionId) destroyTerminal(tab.sessionId);
                            void closeTab(workspace.workspaceKey, id);
                        }}
                        onTabRename={(id, newLabel) => {
                            if (workspace.workspaceKey) {
                                renameTab(workspace.workspaceKey, id, newLabel);
                            }
                        }}
                        onNewTab={handleNewTab}
                        onRunTab={handleRunTab}
                        onRunScript={handleRunScript}
                        scripts={scripts}
                        defaultRuntime={defaultRuntime}
                        showRunButton={workspace.scope === "task" || hasScripts}
                        showAgentOptions={workspace.scope === "task"}
                        allowSessionTabs={true}
                    />
                    <TabContent tabs={visibleTabs} activeTabId={activeTab?.id ?? ""} />
                </>
            )}
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
