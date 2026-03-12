/// <reference types="vite/client" />

interface TaskflowBridge {
    getBackendPort(): Promise<number>;
    selectProjectDirectory(): Promise<string | null>;
    openExternalUrl(url: string): Promise<void>;
    openExternalFile(filePath: string, opts?: { line?: number; col?: number; editor?: string }): Promise<string>;
    onCloseTab(callback: () => void): () => void;
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
