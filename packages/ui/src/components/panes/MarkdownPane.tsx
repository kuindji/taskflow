import { Suspense, lazy, useCallback, useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useSessionStore } from "@/stores/session-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useActiveWorkspace, workspaceBackendId } from "@/hooks/useActiveWorkspace";
import { EditorPane } from "@/components/panes/EditorPane";
import { MarkdownToolbar } from "@/components/panes/markdown/MarkdownToolbar";
import { persistWikiRail } from "@/components/panes/markdown/wiki-rail-settings";
import { useUIStore } from "@/stores/ui-store";
import { useWikiRoot } from "@/hooks/useWikiRoot";
import { useIsLocalBackend } from "@/hooks/useIsLocalBackend";
import { fetchObsidianState, openInObsidian } from "@/lib/wiki/open-in-obsidian";
import type { ObsidianState } from "@taskflow/shared";
import { getInternalEditorId } from "@/lib/open-file";

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
    const wikiRoot = useWikiRoot();
    const wikiRailOpen = useUIStore((s) => s.wikiRailOpen);
    const inWiki = wikiRoot !== null && filePath.startsWith(`${wikiRoot}/`);
    const showRailToggle = mode === "preview" && inWiki;
    const [obsidian, setObsidian] = useState<ObsidianState | null>(null);
    const backendId = workspaceBackendId(workspaceKey);
    // Obsidian opens on this machine: a remote machine's wiki offers no button.
    const isLocal = useIsLocalBackend(backendId);

    useEffect(() => {
        if (!inWiki || wikiRoot === null || !backendId || !isLocal) {
            setObsidian(null);
            return;
        }
        let cancelled = false;
        void fetchObsidianState(backendId, wikiRoot).then(
            (state) => {
                if (!cancelled) setObsidian(state);
            },
            () => {},
        );
        return () => {
            cancelled = true;
        };
    }, [backendId, inWiki, isLocal, wikiRoot]);

    const canOpenInObsidian = obsidian?.installed === true && obsidian.vault === "registered";
    const handleOpenInObsidian = useCallback(() => {
        openInObsidian(filePath);
    }, [filePath]);

    const handleToggleRail = useCallback(() => {
        useUIStore.getState().toggleWikiRail();
        persistWikiRail();
    }, []);

    const historyState = useSessionStore(
        useShallow((s) => {
            const tab = s.tabsByWorkspace[workspaceKey]?.find((t) => t.id === tabId);
            const length = tab?.history?.length ?? 0;
            const index = tab?.historyIndex ?? 0;
            return { canGoBack: index > 0, canGoForward: index < length - 1 };
        }),
    );

    const handleBack = useCallback(() => {
        useSessionStore.getState().stepTabHistory(workspaceKey, tabId, -1);
    }, [tabId, workspaceKey]);

    const handleForward = useCallback(() => {
        useSessionStore.getState().stepTabHistory(workspaceKey, tabId, 1);
    }, [tabId, workspaceKey]);

    const handleToggleMode = useCallback(async () => {
        const store = useSessionStore.getState();
        if (mode === "edit") {
            store.setTabMode(workspaceKey, tabId, "preview");
            return;
        }
        // A configured CLI editor detected on the file's machine opens in a
        // terminal session and the markdown tab stays in preview — matching how
        // non-markdown files behave. The editor list is fetched on first use;
        // a user click, so the latency is fine.
        const cliEditorId = await getInternalEditorId(
            workspaceBackendId(workspaceKey),
            internalEditor,
        );
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
            <MarkdownToolbar
                mode={mode}
                canGoBack={historyState.canGoBack}
                canGoForward={historyState.canGoForward}
                onBack={handleBack}
                onForward={handleForward}
                onToggleMode={() => void handleToggleMode()}
                showRailToggle={showRailToggle}
                railOpen={wikiRailOpen}
                onToggleRail={handleToggleRail}
                canOpenInObsidian={canOpenInObsidian}
                onOpenInObsidian={handleOpenInObsidian}
            />
            {mode === "edit" ? (
                <EditorPane filePath={filePath} />
            ) : (
                <Suspense
                    fallback={
                        <div className="text-muted-foreground flex flex-1 items-center justify-center">
                            Loading preview...
                        </div>
                    }>
                    <LazyMarkdownPane
                        filePath={filePath}
                        tabId={tabId}
                        workspaceKey={workspaceKey}
                    />
                </Suspense>
            )}
        </div>
    );
}

export { MarkdownPane };
