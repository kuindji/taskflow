import type { Tab } from "@/stores/session-store";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { TerminalPane } from "@/components/panes/TerminalPane";
import { EditorPane } from "@/components/panes/EditorPane";
import { ChangesPane } from "@/components/panes/ChangesPane";
import { BrowserPane } from "@/components/panes/BrowserPane";
import { useActiveWorkspace } from "@/hooks/useActiveWorkspace";

interface TabContentProps {
    tabs: Tab[];
    activeTabId: string;
}

function TabContent({ tabs, activeTabId }: TabContentProps) {
    const workspace = useActiveWorkspace();

    if (tabs.length === 0) {
        return (
            <div className="m-1.5 flex flex-1 overflow-hidden rounded-md border border-border/30">
                <div className="text-muted-foreground flex flex-1 items-center justify-center">
                    No active tab. Create a session with +
                </div>
            </div>
        );
    }

    return (
        <div className="m-1.5 flex flex-1 overflow-hidden rounded-md border border-border/30">
            {tabs.map((tab) => {
                const isActive = tab.id === activeTabId;

                let pane: React.ReactNode;
                let label: string;

                switch (tab.type) {
                    case "claude":
                    case "codex":
                    case "shell":
                        label = `${tab.type} terminal`;
                        // Terminal panes are always mounted but hidden when inactive
                        // so PTY output is buffered and state is preserved across tab switches
                        pane = tab.sessionId ? (
                            <TerminalPane
                                taskId={workspace.task?.id}
                                projectId={workspace.task ? undefined : workspace.project?.id}
                                sessionId={tab.sessionId}
                                visible={isActive}
                            />
                        ) : (
                            <div className="text-muted-foreground p-3">Session not found</div>
                        );
                        break;

                    case "editor":
                        label = tab.filePath?.split("/").pop() ?? "Editor";
                        if (!isActive) return null;
                        pane = tab.filePath ? (
                            <EditorPane filePath={tab.filePath} />
                        ) : (
                            <div className="text-muted-foreground p-3">No file specified</div>
                        );
                        break;

                    case "changes":
                        label = "Changes";
                        if (!isActive) return null;
                        pane = workspace.workingDir ? (
                            <ChangesPane repoPath={workspace.workingDir} />
                        ) : (
                            <div className="text-muted-foreground p-3">Repository not available</div>
                        );
                        break;

                    case "browser":
                        label = "Browser";
                        pane = <BrowserPane initialUrl={tab.url ?? "about:blank"} />;
                        break;

                    default:
                        return null;
                }

                return (
                    <ErrorBoundary key={tab.id} fallbackLabel={label}>
                        <div className="flex-1" style={{ display: isActive ? "flex" : "none" }}>{pane}</div>
                    </ErrorBoundary>
                );
            })}
        </div>
    );
}

export { TabContent };
