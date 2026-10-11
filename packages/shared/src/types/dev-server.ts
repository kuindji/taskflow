/** A long-running process an agent registered for the user (a dev server). Taskflow only stores it. */
export interface DevServer {
    id: string;
    pid: number;
    label: string;
    /** ISO timestamp. Also the PID-reuse guard: a process that started later is a different one. */
    registeredAt: string;
    projectId: string;
    taskId?: string;
    sessionId?: string;
}

export interface DevServerListResponse {
    devServers: DevServer[];
}

export interface DevServerStopPayload {
    id: string;
}

export type DevServerStopResult = { ok: true } | { ok: false; error: string };
