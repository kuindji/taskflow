import { useCallback, useEffect, useMemo } from "react";
import type { AgentLaunchOptions } from "@taskflow/shared";
import { useSessionStore } from "@/stores/session-store";
import type { Tab } from "@/stores/session-store";
import { useActiveWorkspace } from "@/hooks/useActiveWorkspace";
import { useTaskStore } from "@/stores/task-store";
import { useTaskCreationStore } from "@/stores/task-creation-store";
import { useUIStore } from "@/stores/ui-store";
import { TaskHeader } from "./TaskHeader";
import { TabBar } from "./TabBar";
import { TabContent } from "./TabContent";
import { destroyTerminal } from "@/components/panes/TerminalPane";
import useIsElectron from "@/hooks/useIsElectron";

const emptyTabs: Tab[] = [];

export function Workspace() {
    const isElectron = useIsElectron();
    const workspace = useActiveWorkspace();
    const tabs = useSessionStore((s) =>
        workspace.workspaceKey ? (s.tabsByWorkspace[workspace.workspaceKey] ?? emptyTabs) : emptyTabs,
    );
    const activeTabId = useSessionStore((s) =>
        workspace.workspaceKey ? (s.activeTabByWorkspace[workspace.workspaceKey] ?? "") : "",
    );
    const { setActiveTab, closeTab, createSession, addTab } = useSessionStore();
    const setActiveTask = useTaskStore((s) => s.setActiveTask);
    const requestNewTask = useTaskCreationStore((s) => s.requestNewTask);
    const setActiveProject = useUIStore((s) => s.setActiveProject);

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
    }, [activeTab, workspace.workspaceKey, workspace.scope, closeTab, setActiveTask, setActiveProject]);

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

    return (
        <>
            <TaskHeader
                task={workspace.task ?? undefined}
                project={workspace.project}
                onDiff={workspace.scope === "project" ? handleDiffTab : undefined}
            />
            <TabBar
                tabs={visibleTabs}
                activeTabId={activeTab?.id ?? ""}
                onTabClick={(id) => workspace.workspaceKey && setActiveTab(workspace.workspaceKey, id)}
                onTabClose={(id) => {
                    if (!workspace.workspaceKey) return;
                    const tab = visibleTabs.find((t) => t.id === id);
                    if (tab?.sessionId) destroyTerminal(tab.sessionId);
                    void closeTab(workspace.workspaceKey, id);
                }}
                onNewTab={handleNewTab}
                onRunTab={handleRunTab}
                showRunButton={workspace.scope === "task"}
                allowSessionTabs={true}
            />
            <TabContent tabs={visibleTabs} activeTabId={activeTab?.id ?? ""} />
        </>
    );
}
