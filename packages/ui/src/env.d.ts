/// <reference types="vite/client" />

import type { BackendRecord, MenuEntry, TunnelFailure } from "@taskflow/shared";

interface NativeMenuItem {
    id?: string;
    label?: string;
    enabled?: boolean;
    checked?: boolean;
    type?: "normal" | "separator" | "submenu" | "checkbox" | "label";
    submenu?: NativeMenuItem[];
}

interface NativeMenuPosition {
    x: number;
    y: number;
}

interface TaskflowBridge {
    getBackendPort(): Promise<number>;
    selectProjectDirectory(): Promise<string | null>;
    selectThemeFile(): Promise<string | null>;
    selectFile(): Promise<string | null>;
    openExternalUrl(url: string): Promise<void>;
    openExternalFile(
        filePath: string,
        opts?: { line?: number; col?: number; editor?: string },
    ): Promise<string>;
    showItemInFolder(filePath: string): void;
    onNewTask(callback: () => void): () => void;
    onNewTerminal(callback: () => void): () => void;
    onNewAgent(callback: () => void): () => void;
    onCloseTab(callback: () => void): () => void;
    onOpenSettings(callback: () => void): () => void;
    onOpenKeyboardShortcuts(callback: () => void): () => void;
    onOpenCommandPalette(callback: () => void): () => void;
    onOpenAgentOperationsHelp(callback: () => void): () => void;
    onOpenAppearance(callback: () => void): () => void;
    onOpenFlows(callback: () => void): () => void;
    onOpenSchedules(callback: () => void): () => void;
    onToggleArchive(callback: () => void): () => void;
    sendArchiveState(showArchive: boolean): void;
    onToggleArchivedProjects(callback: () => void): () => void;
    sendArchivedProjectsState(showArchivedProjects: boolean): void;
    onToggleCompactSidebar(callback: () => void): () => void;
    sendCompactSidebarState(compact: boolean): void;
    onToggleFileExplorer(callback: () => void): () => void;
    sendFileExplorerState(open: boolean): void;
    onToggleTaskInfo(callback: () => void): () => void;
    sendTaskInfoState(open: boolean): void;
    onToggleSearchPanel(callback: () => void): () => void;
    onToggleMarkdownInput(callback: () => void): () => void;
    onToggleSplit(callback: () => void): () => void;
    onToggleWordWrap(callback: () => void): () => void;
    sendWordWrapState(enabled: boolean): void;
    sendConfirmBeforeExitState(enabled: boolean): void;
    onFocusPanelLeft(callback: () => void): () => void;
    onFocusPanelRight(callback: () => void): () => void;
    onWindowFocusChanged(callback: (focused: boolean) => void): () => void;
    getWindowFullscreen(): Promise<boolean>;
    onWindowFullscreenChanged(callback: (fullscreen: boolean) => void): () => void;
    onUpdateStatus(callback: (payload: { status: string; version?: string }) => void): () => void;
    quitAndInstallUpdate(): void;
    sendTrayState(status: string | null): void;
    getPathForFile(file: File): string;
    /** `url` is a file artifact's raw route on the backend that owns the run. */
    saveArtifact(opts: {
        url?: string;
        text?: string;
        defaultName?: string;
    }): Promise<{ success: boolean; error?: string }>;
    showNativeMenu(items: NativeMenuItem[], position: NativeMenuPosition): Promise<string | null>;
    onNotificationClicked(
        callback: (payload: {
            id: string;
            /** The machine that raised the notification. */
            backendId: string;
            projectId: string;
            sessionId: string;
            taskId?: string;
        }) => void,
    ): () => void;
    listBackends(): Promise<MenuEntry[]>;
    getAttached(): Promise<{ id: string; origin: string; isLocal: boolean }[]>;
    attachBackend(
        id: string,
    ): Promise<{ ok: true; origin: string } | { ok: false; failure: TunnelFailure }>;
    detachBackend(id: string): Promise<void>;
    confirmBackend(
        id: string,
        info: { backendUid: string; protocolVersion: number },
    ): Promise<{ id: string; merged: boolean }>;
    probeBackends(): Promise<void>;
    addBackend(input: {
        host: string;
        user?: string;
        sshPort?: number;
        port?: number;
        instanceId?: string;
    }): Promise<BackendRecord>;
    addDiscoveredBackend(entryId: string): Promise<BackendRecord | null>;
    updateBackend(
        id: string,
        patch: { displayName?: string; user?: string; sshPort?: number },
    ): Promise<{ ok: boolean; reason?: string }>;
    removeBackend(id: string): Promise<{ ok: boolean; reason?: string }>;
    trustBackendHost(id: string): Promise<{ ok: boolean; reason?: string }>;
    getHostFingerprint(
        id: string,
    ): Promise<{ ok: true; fingerprint: string } | { ok: false; reason: string }>;
    onBackendsChanged(cb: () => void): () => void;
    onBackendDropped(cb: (id: string, failure: TunnelFailure) => void): () => void;
    onBackendSeen(cb: (id: string) => void): () => void;
    attachedRecordIds(): Promise<string[]>;
}

declare global {
    interface FontData {
        family: string;
        fullName: string;
        postscriptName: string;
        style: string;
    }

    interface WebviewElement extends HTMLElement {
        src: string;
        partition: string;
        useragent: string;
        getURL(): string;
        goBack(): void;
        goForward(): void;
        reload(): void;
        canGoBack(): boolean;
    }

    interface Window {
        taskflow?: TaskflowBridge;
        queryLocalFonts(): Promise<FontData[]>;
    }

    namespace JSX {
        interface IntrinsicElements {
            webview: React.DetailedHTMLProps<
                React.HTMLAttributes<WebviewElement> & {
                    src?: string;
                    partition?: string;
                    useragent?: string;
                },
                WebviewElement
            >;
        }
    }
}

export {};
