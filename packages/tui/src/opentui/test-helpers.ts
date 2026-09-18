import type { AppSettings, Project, Task } from "@taskflow/shared";
import { MSG } from "@taskflow/shared";
import type { NetLike } from "../net/client";

class FakeNet implements NetLike {
    private readonly handlers = new Map<string, Set<(payload: unknown) => void>>();
    private readonly statuses = new Set<(status: { connected: boolean }) => void>();
    clients = 1;
    readonly requests: Array<{ type: string; payload: unknown }> = [];
    readonly responses = new Map<string, unknown>();

    async request<T>(type: string, payload?: unknown): Promise<T> {
        this.requests.push({ type, payload });
        if (type === MSG.SYSTEM_CLIENTS) return { count: this.clients } as T;
        if (this.responses.has(type)) return this.responses.get(type) as T;
        throw new Error(`Unexpected request: ${type}`);
    }

    on(type: string, handler: (payload: unknown) => void): () => void {
        const listeners = this.handlers.get(type) ?? new Set();
        listeners.add(handler);
        this.handlers.set(type, listeners);
        return () => listeners.delete(handler);
    }

    onStatusChange(listener: (status: { connected: boolean }) => void): () => void {
        this.statuses.add(listener);
        return () => this.statuses.delete(listener);
    }

    emit(type: string, payload: unknown): void {
        for (const handler of this.handlers.get(type) ?? []) handler(payload);
    }

    emitStatus(connected: boolean): void {
        for (const listener of this.statuses) listener({ connected });
    }
}

function project(id: string, name: string, sessions = 0): Project {
    return {
        id,
        name,
        path: `/tmp/${id}`,
        sessions: Array.from({ length: sessions }, (_, index) => ({
            id: `${id}-s${String(index)}`,
            type: "shell",
            label: "shell",
            createdAt: "now",
        })),
        attributes: [],
        createdAt: "now",
    };
}

function task(id: string, projectId: string, title: string, sessions = 0): Task {
    return {
        id,
        projectId,
        title,
        description: "",
        notes: "",
        worktree: { enabled: false, path: null, branch: null, pr: null },
        sessions: Array.from({ length: sessions }, (_, index) => ({
            id: `${id}-s${String(index)}`,
            type: "shell",
            label: "shell",
            createdAt: "now",
        })),
        attributes: [],
        createdAt: "now",
        status: "active",
        archivedAt: null,
        pinned: false,
    };
}

function fullSettings(panels: Partial<AppSettings["layout"]["panels"]> = {}): AppSettings {
    return {
        general: {
            fontFamily: "system",
            fontSize: 14,
            defaultAgent: "codex",
            defaultRuntime: "bun",
            favoriteAgents: [],
            confirmBeforeExit: false,
        },
        terminal: { fontFamily: "system", fontSize: 14, defaultShell: "system" },
        editor: {
            fontFamily: "system",
            fontSize: 14,
            wordWrap: true,
            internalEditor: "default",
            externalEditor: "system",
            markdownWidth: "medium",
        },
        layout: {
            window: { width: 1000, height: 700, isMaximized: false },
            panels: {
                sidebarWidth: 240,
                fileExplorerWidth: 240,
                taskInfoWidth: 300,
                flowPanelWidth: 300,
                compactSidebar: false,
                collapsedProjectIds: [],
                wikiRailOpen: false,
                wikiRailWidth: 300,
                ...panels,
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
        appearance: { theme: "default" },
        remoteAgent: {
            autoStart: false,
            appName: "",
            headless: false,
            permissionMode: "default",
        },
        network: { discoverable: true, displayName: "" },
    };
}

export { FakeNet, fullSettings, project, task };
