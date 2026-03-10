/// <reference types="vite/client" />

interface TaskflowBridge {
  getBackendPort(): Promise<number>;
  selectProjectDirectory(): Promise<string | null>;
}

declare global {
  interface WebviewElement extends HTMLElement {
    src: string;
    goBack(): void;
    goForward(): void;
    reload(): void;
    canGoBack(): boolean;
  }

  interface Window {
    taskflow?: TaskflowBridge;
  }

  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<React.HTMLAttributes<WebviewElement> & {
        src?: string;
      }, WebviewElement>;
    }
  }
}

export {};
