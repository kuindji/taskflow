export interface EditorInfo {
    id: string;
    name: string;
    command: string;
    type: "internal" | "external";
    /** Format string for line navigation. Uses {line} and {file} placeholders.
     *  e.g. "+{line}" (vim-style) or "{file}:{line}" (helix-style).
     *  When lineFlag contains {file}, the file path is embedded in the flag
     *  and must NOT be passed as a separate argument. */
    lineFlag?: string;
    /** Extra args always passed, e.g. ["-nw"] for emacs */
    extraArgs?: string[];
}

export interface SystemInfo {
    editors: EditorInfo[];
    homedir: string;
    schedulerEnabled: boolean;
    /** The backend machine's hostname. What the network name setting falls back
     *  to, and the only way the renderer can name the machine it is talking to. */
    hostname: string;
    /** Absent on a backend older than this feature. Treat as incompatible. */
    protocolVersion?: number;
    /** Stable backend identity, confirmed by handshake. The registry rekeys a
     *  provisional record onto this and merges duplicates. Absent on an older
     *  backend, which is refused on protocolVersion first. */
    backendUid?: string;
}

export interface DesktopUpdateState {
    status: "idle" | "checking" | "available" | "downloading" | "ready" | "installing" | "error";
    availableVersion: string | null;
    downloadedVersion: string | null;
    downloadPercent: number | null;
    checkedAt: string | null;
    message: string | null;
    errorContext: "check" | "download" | "install" | null;
    canRetry: boolean;
}

export type DesktopUpdateEvent =
    | { type: "check-started"; checkedAt: string }
    | { type: "check-failed"; checkedAt: string; message: string }
    | { type: "update-available"; version: string; checkedAt: string }
    | { type: "no-update"; checkedAt: string }
    | { type: "download-started" }
    | { type: "download-progress"; percent: number }
    | { type: "download-completed"; version: string }
    | { type: "download-failed"; message: string }
    | { type: "install-started" }
    | { type: "install-failed"; message: string };
