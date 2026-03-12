import { useEffect, useMemo } from "react";
import { useSessionStore } from "@/stores/session-store";
import type { Tab } from "@/stores/session-store";
import { useActiveWorkspace } from "@/hooks/useActiveWorkspace";
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

    const visibleTabs = useMemo(
        () => (workspace.scope === "task" ? tabs.filter((tab) => tab.type !== "changes") : tabs),
        [tabs, workspace.scope],
    );

    const activeTab = visibleTabs.find((t) => t.id === activeTabId) ?? visibleTabs[0];

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
            );
        }
    };

    const handleRunTab = async (type: "claude" | "codex") => {
        if (workspace.scope !== "task" || !workspace.task) return;
        await createSession(
            { taskId: workspace.task.id },
            type,
            undefined,
            workspace.task.description || undefined,
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
