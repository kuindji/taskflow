import type { DesktopUpdateEvent, DesktopUpdateState } from "@taskflow/shared";

export function createInitialDesktopUpdateState(): DesktopUpdateState {
    return {
        status: "idle",
        availableVersion: null,
        downloadedVersion: null,
        downloadPercent: null,
        checkedAt: null,
        message: null,
        errorContext: null,
        canRetry: false,
    };
}

// Adapted from t3code (MIT, https://github.com/pingdotgg/t3code, 32ecd717): apps/desktop/src/updates/updateMachine.ts
export function reduceDesktopUpdateState(
    state: DesktopUpdateState,
    event: DesktopUpdateEvent,
): DesktopUpdateState {
    const clearError = { message: null, errorContext: null, canRetry: false } as const;
    switch (event.type) {
        case "check-started":
            return {
                ...state,
                ...clearError,
                status: "checking",
                checkedAt: event.checkedAt,
                downloadPercent: state.downloadedVersion !== null ? 100 : null,
            };
        case "check-failed":
            return state.downloadedVersion !== null
                ? {
                      ...state,
                      ...clearError,
                      status: "ready",
                      checkedAt: event.checkedAt,
                      downloadPercent: 100,
                      canRetry: true,
                  }
                : {
                      ...state,
                      status: "error",
                      checkedAt: event.checkedAt,
                      downloadPercent: null,
                      message: event.message,
                      errorContext: "check",
                      canRetry: true,
                  };
        case "update-available": {
            const downloaded = state.downloadedVersion === event.version;
            return {
                ...state,
                ...clearError,
                status: downloaded ? "ready" : "available",
                availableVersion: event.version,
                downloadedVersion: downloaded ? event.version : null,
                downloadPercent: downloaded ? 100 : null,
                checkedAt: event.checkedAt,
                canRetry: downloaded,
            };
        }
        case "no-update":
            return state.downloadedVersion !== null
                ? {
                      ...state,
                      ...clearError,
                      status: "ready",
                      availableVersion: state.downloadedVersion,
                      downloadPercent: 100,
                      checkedAt: event.checkedAt,
                      canRetry: true,
                  }
                : { ...createInitialDesktopUpdateState(), checkedAt: event.checkedAt };
        case "download-started":
            return { ...state, ...clearError, status: "downloading", downloadPercent: 0 };
        case "download-progress":
            return {
                ...state,
                ...clearError,
                status: "downloading",
                downloadPercent: event.percent,
            };
        case "download-completed":
            return {
                ...state,
                ...clearError,
                status: "ready",
                availableVersion: event.version,
                downloadedVersion: event.version,
                downloadPercent: 100,
                canRetry: true,
            };
        case "download-failed":
            return {
                ...state,
                status: state.availableVersion !== null ? "available" : "error",
                downloadPercent: null,
                message: event.message,
                errorContext: "download",
                canRetry: state.availableVersion !== null,
            };
        case "install-started":
            return state.downloadedVersion !== null
                ? { ...state, ...clearError, status: "installing" }
                : state;
        case "install-failed":
            return {
                ...state,
                status: "ready",
                message: event.message,
                errorContext: "install",
                canRetry: true,
            };
    }
}
