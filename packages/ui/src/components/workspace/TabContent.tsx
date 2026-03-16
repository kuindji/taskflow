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

/** Tab types that stay mounted when inactive (never display:none) */
function isAlwaysMounted(type: Tab["type"]): boolean {
    return type === "claude" || type === "codex" || type === "gemini" || type === "shell" || type === "browser";
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
                    case "shell":
                        label = `${tab.type} terminal`;
                        // Terminal panes are always mounted and use visibility+absolute
                        // positioning instead of display:none so xterm.js always has
                        // valid DOM measurements for its scroll viewport.
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

                // Always-mounted tabs (terminals, browser) use absolute positioning
                // with visibility toggle instead of display:none. This ensures xterm's
                // viewport always has valid DOM dimensions for scroll calculations.
                if (isAlwaysMounted(tab.type)) {
                    return (
                        <ErrorBoundary key={tab.id} fallbackLabel={label}>
                            <div
                                className={cn(
                                    "absolute inset-0 flex",
                                    isActive ? "visible z-10" : "pointer-events-none invisible z-0",
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
