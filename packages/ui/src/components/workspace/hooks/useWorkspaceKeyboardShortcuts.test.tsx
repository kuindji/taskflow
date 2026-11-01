import { afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { setPrimary } from "@/lib/connection-registry";
import { MASTER_WORKSPACE_KEY, useActiveWorkspace } from "@/hooks/useActiveWorkspace";
import { setEditorDirty } from "@/components/panes/editor-dirty-state";
import { useDialogStore } from "@/stores/dialog-store";
import { useMarkdownInputStore } from "@/stores/markdown-input-store";
import { useSessionStore, type Tab } from "@/stores/session-store";
import { useUIStore } from "@/stores/ui-store";
import { useWorkspaceTabOps } from "./useWorkspaceTabOps";
import { useWorkspaceKeyboardShortcuts } from "./useWorkspaceKeyboardShortcuts";

const BACKEND = "workspace-shortcuts";
const RIGHT_KEY = `${MASTER_WORKSPACE_KEY}:right`;

function Harness() {
    const workspace = useActiveWorkspace();
    const ops = useWorkspaceTabOps({ workspace, defaultShellPath: null, configuredShell: "" });
    useWorkspaceKeyboardShortcuts({
        ...ops,
        isElectron: false,
        workspaceKey: workspace.workspaceKey,
    });
    return null;
}

let root: Root | null = null;

function press(key: string, code: string, shiftKey = false) {
    act(() => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key, code, metaKey: true, shiftKey }));
    });
}

function setTabs(left: Tab[], right: Tab[] = []) {
    useSessionStore.setState({
        tabsByWorkspace: { [MASTER_WORKSPACE_KEY]: left, [RIGHT_KEY]: right },
        activeTabByWorkspace: {
            [MASTER_WORKSPACE_KEY]: left[0]?.id ?? "",
            [RIGHT_KEY]: right[0]?.id ?? "",
        },
    });
}

function tabIds(key: string): string[] {
    return (useSessionStore.getState().tabsByWorkspace[key] ?? []).map((t) => t.id);
}

beforeAll(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
});

beforeEach(() => {
    setPrimary(BACKEND);
    useUIStore.setState({ masterWorkspaceActive: true, splitByWorkspace: {} });
    useDialogStore.getState().dismiss();
    useDialogStore.setState({ queue: [] });
    useMarkdownInputStore.setState({ editors: {} });
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root?.render(<Harness />));
});

afterEach(() => {
    act(() => root?.unmount());
    root = null;
    useDialogStore.getState().dismiss();
    useUIStore.setState({ masterWorkspaceActive: false, splitByWorkspace: {} });
});

describe("close tab shortcut", () => {
    it("asks before closing an editor tab with unsaved edits", () => {
        const path = "/repo/notes.ts";
        setEditorDirty(BACKEND, path, true);
        setTabs([{ id: "ed", type: "editor", label: "notes.ts", filePath: path }]);

        press("w", "KeyW");

        expect(useDialogStore.getState().open).toBe(true);
        expect(useDialogStore.getState().title).toBe("Unsaved Changes");
        expect(tabIds(MASTER_WORKSPACE_KEY)).toEqual(["ed"]);
        setEditorDirty(BACKEND, path, false);
    });

    it("asks before killing a CLI editor that is still running", () => {
        setTabs([{ id: "vim", type: "editor", label: "vim", sessionId: "vim-session" }]);

        press("w", "KeyW");

        expect(useDialogStore.getState().open).toBe(true);
        expect(useDialogStore.getState().title).toBe("Editor Still Running");
        expect(tabIds(MASTER_WORKSPACE_KEY)).toEqual(["vim"]);
    });
});

describe("markdown input shortcut", () => {
    it("opens the editor of the focused right pane's session", () => {
        setTabs(
            [{ id: "left", type: "claude", label: "Left", sessionId: "s-left" }],
            [{ id: "right", type: "claude", label: "Right", sessionId: "s-right" }],
        );
        useUIStore.setState({
            splitByWorkspace: {
                [MASTER_WORKSPACE_KEY]: { open: true, activePane: "right", ratio: 0.5 },
            },
        });

        press("E", "KeyE", true);

        const editors = useMarkdownInputStore.getState().editors;
        expect(editors["s-right"]?.isOpen).toBe(true);
        expect(editors["s-left"]?.isOpen ?? false).toBe(false);
    });
});
