export type BrowserTabScope =
    | { kind: "task"; taskId: string }
    | { kind: "project"; projectId: string }
    | { kind: "master" };

export interface BrowserTab {
    id: string;
    scope: BrowserTabScope;
    label: string;
    url: string;
    title?: string;
    parentId?: string;
    createdAt: string;
    loaded: boolean;
    agentConnections: number;
}

export interface BrowserTabListResponse {
    tabs: BrowserTab[];
    hostAvailable: boolean;
}

export interface BrowserTabOpenPayload {
    scope: BrowserTabScope;
    url: string;
    label?: string;
}

export interface BrowserTabClosePayload {
    id: string;
}

export interface BrowserHostHeartbeat {
    controlUrl: string;
    debugPort: number;
    loaded: {
        tabId: string;
        targetId: string;
        url: string;
        title?: string;
        parentId?: string;
    }[];
    appTargetIds: string[];
}

export type BrowserHostEvent =
    | { type: "navigated"; tabId: string; url: string; title?: string }
    | { type: "child-opened"; tabId: string; parentId: string; url: string; targetId: string }
    | { type: "closed"; tabId: string };
