import { Suspense, lazy, useCallback } from "react";
import { useSessionStore } from "@/stores/session-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useActiveWorkspace } from "@/hooks/useActiveWorkspace";
import { EditorPane } from "@/components/panes/EditorPane";
import { MarkdownToolbar } from "@/components/panes/markdown/MarkdownToolbar";
import { ensureEditorsCached, getInternalEditorId } from "@/lib/open-file";

interface MarkdownPaneProps {
    filePath: string;
    mode: "preview" | "edit";
    tabId: string;
    workspaceKey: string;
}

const LazyMarkdownPane = lazy(() => import("./MarkdownPaneImpl"));

function MarkdownPane({ filePath, mode, tabId, workspaceKey }: MarkdownPaneProps) {
    const workspace = useActiveWorkspace();
    const internalEditor = useSettingsStore((s) => s.settings?.editor.internalEditor ?? "monaco");

    const handleToggleMode = useCallback(async () => {
        const store = useSessionStore.getState();
        if (mode === "edit") {
            store.setTabMode(workspaceKey, tabId, "preview");
            return;
        }
        // The editor list is fetched over the WebSocket, which may not have been
        // open when this module loaded. Awaiting here (a user click, so latency
        // is fine) is what makes the CLI-editor branch reliable on first use.
        await ensureEditorsCached();
        // A configured, available CLI editor opens in a terminal session and the
        // markdown tab stays in preview — matching how non-markdown files behave.
        const cliEditorId = getInternalEditorId(internalEditor);
        if (cliEditorId) {
            const owner =
                workspace.scope === "task"
                    ? { taskId: workspace.task.id }
                    : workspace.scope === "project"
                      ? { projectId: workspace.project.id }
                      : undefined;
            if (owner) {
                const label = filePath.split("/").pop() ?? filePath;
                void store.createSession(
                    owner,
                    "editor",
                    `${cliEditorId}: ${label}`,
                    undefined,
                    undefined,
                    undefined,
                    { editorId: cliEditorId, filePath },
                );
                return;
            }
        }
        store.setTabMode(workspaceKey, tabId, "edit");
    }, [filePath, internalEditor, mode, tabId, workspace, workspaceKey]);

    return (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <MarkdownToolbar mode={mode} onToggleMode={() => void handleToggleMode()} />
            {mode === "edit" ? (
                <EditorPane filePath={filePath} />
            ) : (
                <Suspense
                    fallback={
                        <div className="text-muted-foreground flex flex-1 items-center justify-center">
                            Loading preview...
                        </div>
                    }>
                    <LazyMarkdownPane filePath={filePath} />
                </Suspense>
            )}
        </div>
    );
}

export { MarkdownPane };
