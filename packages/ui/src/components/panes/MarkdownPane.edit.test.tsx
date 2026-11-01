import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MSG } from "@taskflow/shared";
import { closeConnection, openConnection, setPrimary } from "@/lib/connection-registry";
import { settingsWith } from "@/lib/test-settings";
import { startTestServer, type TestServer } from "@/lib/test-ws-server";
import { useSessionStore } from "@/stores/session-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useUIStore } from "@/stores/ui-store";
import { MarkdownPane } from "./MarkdownPane";

// @ts-expect-error react act env flag, no upstream type for this global
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PATH = "/home/me/notes.md";

let server: TestServer;
let container: HTMLDivElement;
let root: Root;

beforeAll(async () => {
    server = startTestServer("local", (type) => {
        if (type === MSG.SYSTEM_INFO) {
            return { editors: [{ id: "nvim", name: "Neovim", type: "internal" }] };
        }
        if (type === MSG.SESSION_CREATE) return { sessionId: "editor-1" };
        return {};
    });
    await openConnection("local", server.origin);
    setPrimary("local");
});

afterAll(() => {
    closeConnection("local", "detach");
    server.stop();
});

beforeEach(() => {
    server.received.length = 0;
    useSettingsStore.setState({ settings: settingsWith("nvim") });
    useUIStore.setState({ masterWorkspaceActive: true });
    useSessionStore.setState({
        tabsByWorkspace: {
            master: [
                { id: "t", type: "markdown", label: "notes.md", filePath: PATH, mode: "preview" },
            ],
        },
        activeTabByWorkspace: { master: "t" },
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
    useUIStore.setState({ masterWorkspaceActive: false });
});

function sessionCreates() {
    return server.received.filter((r) => r.type === MSG.SESSION_CREATE).map((r) => r.payload);
}

test("Edit in Master opens the configured CLI editor in a Master session", async () => {
    act(() => {
        root.render(
            <MarkdownPane filePath={PATH} mode="preview" tabId="t" workspaceKey="master" />,
        );
    });
    const edit = container.querySelector<HTMLButtonElement>('button[aria-label="Edit"]');
    expect(edit).not.toBeNull();

    await act(async () => {
        edit?.click();
        for (let i = 0; i < 100 && sessionCreates().length === 0; i++) {
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
    });

    expect(sessionCreates()).toEqual([
        expect.objectContaining({ master: true, type: "editor", filePath: PATH }),
    ]);
    expect(useSessionStore.getState().tabsByWorkspace.master?.[0]?.mode).toBe("preview");
});
