import { useSessionStore } from "@/stores/session-store";
import { useSettingsStore } from "@/stores/settings-store";
import { sendRequest } from "@/hooks/useWebSocket";
import { MSG } from "@taskflow/shared";
import type { EditorInfo, SystemInfoResponse } from "@taskflow/shared";
import { setPendingLine } from "@/components/panes/editor-dirty-state";
import { planFileOpen } from "@/lib/open-file-plan";

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

/**
 * Returns the configured internal editor id when it is a detected CLI editor,
 * or null when Monaco should be used. Reads the editor cache synchronously —
 * callers must `await ensureEditorsCached()` first.
 */
function getInternalEditorId(internalEditor: string): string | null {
    if (internalEditor === "monaco") return null;
    const available = cachedEditors.some((e) => e.id === internalEditor && e.type === "internal");
    return available ? internalEditor : null;
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
    const plan = planFileOpen({ filePath, line, internalEditor, editorAvailable });
    const label = filePath.replace(/\\/g, "/").split("/").pop() ?? filePath;

    if (plan.kind === "cli-editor") {
        if (!owner) return;
        void store.createSession(
            owner,
            "editor",
            `${internalEditor}: ${label}`,
            undefined,
            undefined,
            undefined,
            { editorId: internalEditor, filePath, line: plan.line },
        );
        return;
    }

    const tabType = plan.kind === "markdown" ? "markdown" : "editor";
    const existingTabs = store.tabsByWorkspace[workspaceKey] ?? [];
    const existing = existingTabs.find(
        (t) => t.type === tabType && t.filePath === filePath && !t.sessionId,
    );

    if (plan.line !== undefined) {
        setPendingLine(filePath, plan.line);
    }

    if (existing) {
        if (plan.kind === "markdown") {
            store.setTabMode(workspaceKey, existing.id, plan.mode);
        }
        store.setActiveTab(workspaceKey, existing.id);
        if (plan.line !== undefined) {
            window.dispatchEvent(
                new CustomEvent("editor-navigate", { detail: { filePath, line: plan.line } }),
            );
        }
        return;
    }

    store.addTab(workspaceKey, {
        id: crypto.randomUUID(),
        type: tabType,
        label,
        filePath,
        ...(plan.kind === "markdown" && {
            mode: plan.mode,
            history: [filePath],
            historyIndex: 0,
        }),
    });
}

export { ensureEditorsCached, getInternalEditorId, openFileInApp };
