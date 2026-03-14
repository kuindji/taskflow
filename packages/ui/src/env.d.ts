/// <reference types="vite/client" />

interface TaskflowBridge {
    getBackendPort(): Promise<number>;
    selectProjectDirectory(): Promise<string | null>;
    openExternalUrl(url: string): Promise<void>;
    openExternalFile(
        filePath: string,
        opts?: { line?: number; col?: number; editor?: string },
    ): Promise<string>;
    showItemInFolder(filePath: string): void;
    onNewTask(callback: () => void): () => void;
    onNewTerminal(callback: () => void): () => void;
    onCloseTab(callback: () => void): () => void;
    onOpenSettings(callback: () => void): () => void;
    onToggleArchive(callback: () => void): () => void;
    sendArchiveState(showArchive: boolean): void;
    onToggleCompactSidebar(callback: () => void): () => void;
    sendCompactSidebarState(compact: boolean): void;
    onToggleFileExplorer(callback: () => void): () => void;
    sendFileExplorerState(open: boolean): void;
    onToggleTaskInfo(callback: () => void): () => void;
    sendTaskInfoState(open: boolean): void;
    onUpdateStatus(
        callback: (payload: { status: string; version?: string }) => void,
    ): () => void;
    quitAndInstallUpdate(): void;
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
                },
                WebviewElement
            >;
        }
    }
}

export {};
