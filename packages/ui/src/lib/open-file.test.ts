import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { MSG } from "@taskflow/shared";
import type { AppSettings, SessionRef, Task } from "@taskflow/shared";
import type { ILink } from "@xterm/xterm";
import { createFilePathLinkProvider } from "@/components/panes/terminal/terminal-link-provider";
import { closeConnection, openConnection, setPrimary } from "@/lib/connection-registry";
import { createTerminalWithText } from "@/lib/test-headless-terminal";
import { startTestServer } from "@/lib/test-ws-server";
import type { TestServer } from "@/lib/test-ws-server";
import { useSessionStore } from "@/stores/session-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useTaskStore } from "@/stores/task-store";
import { openFileInApp } from "./open-file";

const target: Task = {
    id: "target",
    projectId: "p1",
    title: "Target",
    description: "",
    notes: "",
    worktree: { enabled: true, path: "/repo/.worktrees/target", branch: "task/target", pr: null },
    sessions: [],
    attributes: [],
    createdAt: "2026-10-03T00:00:00.000Z",
    status: "active",
    archivedAt: null,
    pinned: false,
};

function editorRef(id: string): SessionRef {
    return {
        id,
        type: "editor",
        label: "nvim: a.ts",
        createdAt: "2026-10-03T00:00:00.000Z",
        state: "live",
    };
}

function settingsWith(internalEditor: string): AppSettings {
    return {
        general: {
            fontFamily: "",
            fontSize: 13,
            defaultAgent: "claude",
            defaultRuntime: "bun",
            favoriteAgents: [],
            confirmBeforeExit: false,
        },
        terminal: { fontFamily: "", fontSize: 13, defaultShell: "" },
        editor: {
            fontFamily: "",
            fontSize: 13,
            wordWrap: false,
            internalEditor,
            externalEditor: "system",
            markdownWidth: "medium",
        },
        layout: {
            window: { width: 1400, height: 900, isMaximized: false },
            panels: {
                sidebarWidth: 220,
                fileExplorerWidth: 220,
                taskInfoWidth: 220,
                flowPanelWidth: 220,
                compactSidebar: false,
                collapsedProjectIds: [],
                wikiRailOpen: false,
                wikiRailWidth: 220,
            },
        },
        claude: {
            defaultModel: "default",
            defaultEffort: "default",
            permissionMode: "default",
            accounts: [],
            defaultAccount: "default",
        },
        codex: {
            defaultModel: "",
            defaultReasoningEffort: "default",
            sandbox: "workspace-write",
            approvalPolicy: "on-request",
            dangerouslyBypassApprovalsAndSandbox: false,
            accounts: [],
            defaultAccount: "default",
        },
        opencode: { defaultModel: "", autoApprove: false },
        pi: { defaultModel: "", thinking: "off", tools: "" },
        kimi: { defaultModel: "", permissionMode: "manual" },
        appearance: { theme: "" },
        remoteAgent: { autoStart: false, appName: "", headless: false, permissionMode: "default" },
        network: { discoverable: false, displayName: "" },
    };
}

let server: TestServer;
let created = 0;
const editorRefs: SessionRef[] = [];

beforeAll(async () => {
    server = startTestServer("local", (type) => {
        if (type === MSG.SYSTEM_INFO) {
            return { editors: [{ id: "nvim", name: "Neovim", type: "internal" }] };
        }
        if (type === MSG.SESSION_CREATE) {
            const id = `editor-${++created}`;
            editorRefs.push(editorRef(id));
            return { sessionId: id };
        }
        if (type === MSG.TASK_LIST) return { tasks: [{ ...target, sessions: [...editorRefs] }] };
        if (type === MSG.FILE_STAT) return { exists: true, isDirectory: false };
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
    useSessionStore.setState({ tabsByWorkspace: {}, activeTabByWorkspace: {} });
    useSettingsStore.setState({ settings: settingsWith("nvim") });
    useTaskStore.setState({ tasks: [{ ...target, backendId: "local" }] });
});

function sessionCreates() {
    return server.received.filter((r) => r.type === MSG.SESSION_CREATE).map((r) => r.payload);
}

/** Link activation `void`s its work; wait for the request it ends in. */
async function untilSessionCreate(): Promise<void> {
    for (let i = 0; i < 100 && sessionCreates().length === 0; i++) {
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
}

describe("openFileInApp with a CLI editor", () => {
    it("opens a file from Master in a Master editor session", async () => {
        await openFileInApp("/repo/src/a.ts", "master", { master: true }, 3);

        expect(sessionCreates()).toEqual([
            expect.objectContaining({ master: true, type: "editor", filePath: "/repo/src/a.ts" }),
        ]);
        expect(useSessionStore.getState().tabsByWorkspace.master?.map((t) => t.sessionId)).toEqual([
            "editor-1",
        ]);
    });

    it("puts the editor session in the pane the link was clicked in, and keeps it there", async () => {
        await openFileInApp("/repo/src/a.ts", "task:target:right", { taskId: "target" });
        useSessionStore.getState().syncWithTasks("local", useTaskStore.getState().tasks);

        const tabs = useSessionStore.getState().tabsByWorkspace;
        expect(tabs["task:target:right"]?.map((t) => t.sessionId)).toEqual(["editor-2"]);
        expect((tabs["task:target"] ?? []).map((t) => t.sessionId)).not.toContain("editor-2");
    });

    it("opens a bare filename link from a Master session", async () => {
        useSessionStore.setState({
            tabsByWorkspace: {
                master: [
                    { id: "s1", type: "claude", label: "Claude", sessionId: "s1", cwd: "/repo" },
                ],
            },
        });
        const term = await createTerminalWithText("see a.ts here", 40);
        const provider = createFilePathLinkProvider(term, "s1", undefined, undefined, true);
        const links = await new Promise<ILink[] | undefined>((resolve) =>
            provider.provideLinks(1, resolve),
        );
        const link = links?.find((l) => l.text === "a.ts");
        expect(link).toBeDefined();

        link?.activate(new MouseEvent("click"), "a.ts");
        await untilSessionCreate();

        expect(sessionCreates()).toEqual([
            expect.objectContaining({ master: true, type: "editor", filePath: "/repo/a.ts" }),
        ]);
    });
});
