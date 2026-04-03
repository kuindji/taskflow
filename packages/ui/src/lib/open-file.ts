import { useSessionStore } from "@/stores/session-store";
import { useSettingsStore } from "@/stores/settings-store";
import { sendRequest } from "@/hooks/useWebSocket";
import { MSG } from "@taskflow/shared";
import type { EditorInfo, SystemInfoResponse } from "@taskflow/shared";
import { setPendingLine } from "@/components/panes/editor-dirty-state";

/** Module-level cache of detected editors for synchronous availability checks. */
let cachedEditors: EditorInfo[] = [];
let fetchPromise: Promise<void> | null = null;

function ensureEditorsCached(): Promise<void> {
    if (cachedEditors.length > 0) return Promise.resolve();
    if (!fetchPromise) {
        fetchPromise = sendRequest<SystemInfoResponse>(MSG.SYSTEM_INFO, {})
            .then(
                (info) => {
                    cachedEditors = info.editors;
                },
                () => {},
            )
            .finally(() => {
                fetchPromise = null;
            });
    }
    return fetchPromise;
}

async function openFileInApp(
    filePath: string,
    workspaceKey: string | null,
    owner?: { taskId?: string; projectId?: string },
    line?: number,
): Promise<void> {
    if (!workspaceKey) return;

    await ensureEditorsCached();

    const store = useSessionStore.getState();
    const settings = useSettingsStore.getState().settings;
    const internalEditor = settings?.editor.internalEditor ?? "monaco";
    const editorAvailable = cachedEditors.some(
        (e) => e.id === internalEditor && e.type === "internal",
    );

    if (internalEditor === "monaco" || !editorAvailable) {
        // Monaco editor path
        if (line !== undefined) {
            setPendingLine(filePath, line);
        }
        const existingTabs = store.tabsByWorkspace[workspaceKey] ?? [];
        const existing = existingTabs.find(
            (t) => t.type === "editor" && t.filePath === filePath && !t.sessionId,
        );
        if (existing) {
            store.setActiveTab(workspaceKey, existing.id);
            // Notify already-mounted editor to navigate to the line
            if (line !== undefined) {
                window.dispatchEvent(
                    new CustomEvent("editor-navigate", {
                        detail: { filePath, line },
                    }),
                );
            }
            return;
        }
        const label = filePath.replace(/\\/g, "/").split("/").pop() ?? filePath;
        store.addTab(workspaceKey, {
            id: crypto.randomUUID(),
            type: "editor",
            label,
            filePath,
        });
    } else if (owner) {
        // CLI editor: spawn terminal session
        const basename = filePath.replace(/\\/g, "/").split("/").pop() ?? filePath;
        const label = `${internalEditor}: ${basename}`;
        void store.createSession(owner, "editor", label, undefined, undefined, undefined, {
            editorId: internalEditor,
            filePath,
            line,
        });
    }
}

export { openFileInApp };
