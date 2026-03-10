/// <reference types="vite/client" />

interface TaskflowBridge {
  getBackendPort(): Promise<number>;
  selectProjectDirectory(): Promise<string | null>;
}

declare global {
  interface Window {
    taskflow?: TaskflowBridge;
  }
}

export {};
