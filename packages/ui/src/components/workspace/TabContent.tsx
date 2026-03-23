import { Activity } from "react";
import type { Tab } from "@/stores/session-store";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { TerminalPane } from "@/components/panes/TerminalPane";
import { EditorPane } from "@/components/panes/EditorPane";
import { ChangesPane } from "@/components/panes/ChangesPane";
import { BrowserPane } from "@/components/panes/BrowserPane";
import { MarkdownPane } from "@/components/panes/MarkdownPane";
import { useActiveWorkspace } from "@/hooks/useActiveWorkspace";
import { cn } from "@/lib/utils";

interface TabContentProps {
    tabs: Tab[];
    activeTabId: string;
}

/** Tab types that stay mounted when inactive (never display:none) */
function isAlwaysMounted(tab: Tab): boolean {
    if (tab.type === "editor" && tab.sessionId) return true;
    return (
        tab.type === "claude" ||
        tab.type === "codex" ||
        tab.type === "opencode" ||
        tab.type === "gemini" ||
        tab.type === "cursor" ||
        tab.type === "shell" ||
        tab.type === "browser"
    );
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
                    case "opencode":
                    case "gemini":
                    case "cursor":
                    case "shell":
                        label = `${tab.type} terminal`;
                        pane = tab.sessionId ? (
                            <TerminalPane
                                taskId={workspace.task?.id}
                                projectId={workspace.task ? undefined : workspace.project?.id}
                                master={workspace.scope === "master" ? true : undefined}
                                sessionId={tab.sessionId}
                                visible={isActive}
                            />
                        ) : (
                            <div className="text-muted-foreground p-3">Session not found</div>
                        );
                        break;

                    case "editor":
                        label = tab.filePath?.split("/").pop() ?? "Editor";
                        if (tab.sessionId) {
                            // CLI editor running in terminal
                            pane = (
                                <TerminalPane
                                    taskId={workspace.task?.id}
                                    projectId={workspace.task ? undefined : workspace.project?.id}
                                    master={workspace.scope === "master" ? true : undefined}
                                    sessionId={tab.sessionId}
                                    visible={isActive}
                                />
                            );
                            break;
                        }
                        // Monaco editor (no sessionId)
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

                    case "markdown":
                        label = tab.filePath?.split("/").pop() ?? "Preview";
                        if (!isActive) return null;
                        pane = tab.filePath ? (
                            <MarkdownPane filePath={tab.filePath} />
                        ) : (
                            <div className="text-muted-foreground p-3">No file specified</div>
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
                // with offscreen placement instead of visibility:hidden. Moving inactive
                // tabs to left:-9999em lets xterm.js's internal IntersectionObserver
                // correctly detect the terminal as not visible and pause rendering.
                // Keep width fixed instead of using inset-0 while hidden, otherwise
                // left:-9999em plus right:0 creates an enormous layer that can still
                // paint over the visible pane.
                // When brought back (left:0), the ResizeObserver fires naturally and
                // xterm resumes without stale viewport state.
                if (isAlwaysMounted(tab)) {
                    // Browser tabs use React <Activity> to hide via display:none,
                    // preserving webview DOM and page state across tab switches.
                    // Terminal tabs use off-screen positioning so xterm.js's
                    // IntersectionObserver correctly detects visibility.
                    if (tab.type === "browser") {
                        return (
                            <ErrorBoundary key={tab.id} fallbackLabel={label}>
                                <Activity mode={isActive ? "visible" : "hidden"}>
                                    <div className="absolute inset-0 z-10 flex">{pane}</div>
                                </Activity>
                            </ErrorBoundary>
                        );
                    }

                    return (
                        <ErrorBoundary key={tab.id} fallbackLabel={label}>
                            <div
                                className={cn(
                                    "absolute top-0 bottom-0 flex w-full",
                                    isActive
                                        ? "left-0 z-10"
                                        : "pointer-events-none -left-[9999em] z-0",
                                )}>
                                {pane}
                            </div>
                        </ErrorBoundary>
                    );
                }

                // Unmount-on-hide tabs (editor, changes) use normal flex layout
                return (
                    <ErrorBoundary key={tab.id} fallbackLabel={label}>
                    <div className="flex min-h-0 min-w-0 flex-1">{pane}</div>
                </ErrorBoundary>
            );
        })}
        </div>
    );
}

export { TabContent };
