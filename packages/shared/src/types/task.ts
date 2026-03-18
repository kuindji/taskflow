export type SessionStatus = "working" | "attention" | "initializing";

export interface SessionRef {
    id: string;
    type: "claude" | "codex" | "opencode" | "gemini" | "cursor" | "shell" | "editor";
    label: string;
    createdAt: string;
    instance?: string;
}

export interface TaskWorktreePr {
    number: number;
    url: string;
}

export interface TaskWorktree {
    enabled: boolean;
    path: string | null;
    branch: string | null;
    pr: TaskWorktreePr | null;
}

export interface Task {
    id: string;
    projectId: string;
    parentId?: string;
    title: string;
    description: string;
    notes: string;
    worktree: TaskWorktree;
    sessions: SessionRef[];
    createdAt: string;
    status: "active" | "archived";
    archivedAt: string | null;
    pinned: boolean;
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
