import type { Tab } from "@/stores/session-store";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { TerminalPane } from "@/components/panes/TerminalPane";
import { EditorPane } from "@/components/panes/EditorPane";
import { ChangesPane } from "@/components/panes/ChangesPane";
import { BrowserPane } from "@/components/panes/BrowserPane";
import { useActiveWorkspace } from "@/hooks/useActiveWorkspace";
import { cn } from "@/lib/utils";

interface TabContentProps {
    tabs: Tab[];
    activeTabId: string;
}

/** Tab types that stay mounted when inactive */
function isAlwaysMounted(type: Tab["type"]): boolean {
    return type === "browser";
}

function TabContent({ tabs, activeTabId }: TabContentProps) {
    const workspace = useActiveWorkspace();

    if (tabs.length === 0) {
        return (
            <div className="flex flex-1 overflow-hidden rounded-md">
                <div className="text-muted-foreground flex flex-1 items-center justify-center">
                    No active tab. Create a session with +
                </div>
            </div>
        );
    }

    return (
        <div className="relative flex flex-1 overflow-hidden rounded-md">
            {tabs.map((tab) => {
                const isActive = tab.id === activeTabId;

                let pane: React.ReactNode;
                let label: string;

                switch (tab.type) {
                    case "claude":
                    case "codex":
                    case "gemini":
                    case "shell":
                        label = `${tab.type} terminal`;
                        // Terminal panes unmount when inactive and restore from
                        // backend snapshots on remount, freeing GPU contexts.
                        if (!isActive) return null;
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
                            <div className="text-muted-foreground p-3">
                                Repository not available
                            </div>
                        );
                        break;

                    case "browser":
                        label = "Browser";
                        pane = <BrowserPane initialUrl={tab.url ?? "about:blank"} />;
                        break;

                    default:
                        return null;
                }

                // Always-mounted tabs (browser) use absolute positioning with offscreen
                // placement. Terminal tabs now unmount when inactive to free GPU contexts
                // and restore from backend snapshots on remount.
                if (isAlwaysMounted(tab.type)) {
                    return (
                        <ErrorBoundary key={tab.id} fallbackLabel={label}>
                            <div
                                className={cn(
                                    "absolute inset-0 flex",
                                    isActive ? "z-10" : "pointer-events-none z-0 -left-[9999em]",
                                )}
                            >
                                {pane}
                            </div>
                        </ErrorBoundary>
                    );
                }

                // Unmount-on-hide tabs (editor, changes) use normal flex layout
                return (
                    <ErrorBoundary key={tab.id} fallbackLabel={label}>
                        <div className="flex flex-1">{pane}</div>
                    </ErrorBoundary>
                );
            })}
        </div>
    );
}

export { TabContent };
