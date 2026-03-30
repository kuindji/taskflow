/// <reference types="vite/client" />

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
    onOpenAgentOperationsHelp(callback: () => void): () => void;
    onOpenAppearance(callback: () => void): () => void;
    onOpenFlows(callback: () => void): () => void;
    onOpenSchedules(callback: () => void): () => void;
    onToggleArchive(callback: () => void): () => void;
    sendArchiveState(showArchive: boolean): void;
    onToggleCompactSidebar(callback: () => void): () => void;
    sendCompactSidebarState(compact: boolean): void;
    onToggleFileExplorer(callback: () => void): () => void;
    sendFileExplorerState(open: boolean): void;
    onToggleTaskInfo(callback: () => void): () => void;
    sendTaskInfoState(open: boolean): void;
    onToggleMarkdownInput(callback: () => void): () => void;
    onToggleWordWrap(callback: () => void): () => void;
    sendWordWrapState(enabled: boolean): void;
    onFocusPanelLeft(callback: () => void): () => void;
    onFocusPanelRight(callback: () => void): () => void;
    onWindowFocusChanged(callback: (focused: boolean) => void): () => void;
    getWindowFullscreen(): Promise<boolean>;
    onWindowFullscreenChanged(callback: (fullscreen: boolean) => void): () => void;
    onUpdateStatus(callback: (payload: { status: string; version?: string }) => void): () => void;
    quitAndInstallUpdate(): void;
    sendTrayState(status: string | null): void;
    getPathForFile(file: File): string;
    saveArtifact(opts: {
        path?: string;
        text?: string;
        defaultName?: string;
    }): Promise<{ success: boolean; error?: string }>;
    showNativeMenu(items: NativeMenuItem[], position: NativeMenuPosition): Promise<string | null>;
    onNotificationClicked(
        callback: (payload: {
            id: string;
            projectId: string;
            sessionId: string;
            taskId?: string;
        }) => void,
    ): () => void;
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
