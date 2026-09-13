import { useSessionStore } from "@/stores/session-store";
import { useSettingsStore } from "@/stores/settings-store";
import { sendRequest } from "@/lib/connection-registry";
import { MSG } from "@taskflow/shared";
import type { EditorInfo, SystemInfoResponse } from "@taskflow/shared";
import { setPendingLine } from "@/components/panes/editor-dirty-state";
import { planFileOpen } from "@/lib/open-file-plan";
import { createPerBackendCache } from "@/lib/per-backend-cache";
import { workspaceBackendId } from "@/hooks/useActiveWorkspace";

/** Each machine's detected editors: a CLI editor runs on the machine that owns the file. */
const editorCache = createPerBackendCache(
    (backendId) =>
        sendRequest<SystemInfoResponse>(backendId, MSG.SYSTEM_INFO, {}).then(
            (info) => info.editors,
        ),
    "editor-cache",
);

/** Empty when the machine cannot be asked, so the file opens in Monaco. */
function detectedEditors(backendId: string | null): Promise<EditorInfo[]> {
    if (!backendId) return Promise.resolve([]);
    return editorCache.get(backendId).catch(() => []);
}

function isInternalEditorAvailable(editors: EditorInfo[], internalEditor: string): boolean {
    return editors.some((e) => e.id === internalEditor && e.type === "internal");
}

/**
 * Returns the configured internal editor id when it is a CLI editor detected on
 * `backendId`, or null when Monaco should be used.
 */
async function getInternalEditorId(
    backendId: string | null,
    internalEditor: string,
): Promise<string | null> {
    if (internalEditor === "monaco") return null;
    const editors = await detectedEditors(backendId);
    return isInternalEditorAvailable(editors, internalEditor) ? internalEditor : null;
}

async function openFileInApp(
    filePath: string,
    workspaceKey: string | null,
    owner?: { taskId?: string; projectId?: string },
    line?: number,
): Promise<void> {
    if (!workspaceKey) return;

    const editors = await detectedEditors(workspaceBackendId(workspaceKey));

    const store = useSessionStore.getState();
    const settings = useSettingsStore.getState().settings;
    const internalEditor = settings?.editor.internalEditor ?? "monaco";
    const editorAvailable = isInternalEditorAvailable(editors, internalEditor);
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

export { getInternalEditorId, openFileInApp };
