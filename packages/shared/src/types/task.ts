export type SessionStatus = "working" | "attention";

export interface SessionRef {
    id: string;
    type: "claude" | "codex" | "shell";
    label: string;
    createdAt: string;
}

export interface TaskWorktree {
    enabled: boolean;
    path: string | null;
    branch: string | null;
}

export interface Task {
    id: string;
    projectId: string;
    title: string;
    description: string;
    notes: string;
    worktree: TaskWorktree;
    sessions: SessionRef[];
    createdAt: string;
    status: "active" | "archived";
    archivedAt: string | null;
}

export type TaskLogEntryType = "info" | "commit" | "warning" | "error";

export interface TaskLogEntry {
    id: string;
    sessionId: string;
    timestamp: string;
    type: TaskLogEntryType;
    message: string;
    meta?: Record<string, string>;
}
