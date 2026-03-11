import { useTaskStore } from "@/stores/task-store";
import { useProjectStore } from "@/stores/project-store";
import { useSessionStore } from "@/stores/session-store";
import type { Tab } from "@/stores/session-store";
import { TaskHeader } from "./TaskHeader";
import { TabBar } from "./TabBar";
import { TabContent } from "./TabContent";
import { destroyTerminal } from "@/components/panes/TerminalPane";
import useIsElectron from "@/hooks/useIsElectron";

const emptyTabs: Tab[] = [];

export function Workspace() {
    const isElectron = useIsElectron();
    const task = useTaskStore((s) => s.tasks.find((t) => t.id === s.activeTaskId));
    const project = useProjectStore((s) => s.projects.find((p) => p.id === task?.projectId));
    const tabs = useSessionStore((s) => (task ? (s.tabsByTask[task.id] ?? emptyTabs) : emptyTabs));
    const activeTabId = useSessionStore((s) => (task ? (s.activeTabByTask[task.id] ?? "") : ""));
    const { setActiveTab, closeTab, createSession, addTab } = useSessionStore();

    if (!task) {
        return (
            <>
                {isElectron && <TaskHeader />}
                <div className="text-muted-foreground flex flex-1 items-center justify-center text-sm">
                    Select a task from the sidebar
                </div>
            </>
        );
    }

    const activeTab = tabs.find((t) => t.id === activeTabId);

    const handleNewTab = async (
        type: "claude" | "codex" | "changes" | "browser" | "shell",
        shellPath?: string,
    ) => {
        if (type === "browser") {
            addTab(task.id, {
                id: crypto.randomUUID(),
                type: "browser",
                label: "New Tab",
                url: "about:blank",
            });
        } else if (type === "changes") {
            const existingChangesTab = tabs.find((tab) => tab.type === "changes");
            if (existingChangesTab) {
                setActiveTab(task.id, existingChangesTab.id);
                return;
            }
            addTab(task.id, { id: crypto.randomUUID(), type: "changes", label: "Changes" });
        } else if (type === "shell" && shellPath) {
            const shellName = shellPath.split("/").pop() ?? "shell";
            await createSession(task.id, "shell", shellName, undefined, shellPath);
        } else {
            await createSession(task.id, type);
        }
    };

    const handleRunTab = async (type: "claude" | "codex") => {
        await createSession(task.id, type, undefined, task.description || undefined);
    };

    return (
        <>
            <TaskHeader task={task} project={project} />
            <TabBar
                tabs={tabs}
                activeTabId={activeTab?.id ?? ""}
                onTabClick={(id) => setActiveTab(task.id, id)}
                onTabClose={(id) => {
                    const tab = tabs.find((t) => t.id === id);
                    if (tab?.sessionId) destroyTerminal(tab.sessionId);
                    void closeTab(task.id, id);
                }}
                onNewTab={handleNewTab}
                onRunTab={handleRunTab}
            />
            <TabContent tabs={tabs} activeTabId={activeTab?.id ?? ""} />
        </>
    );
}
