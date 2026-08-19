import type { Attribute } from "./attribute";
import type { AgentLaunchOptions } from "./agent";

export type SessionStatus = "working" | "attention" | "initializing";

export interface SessionRef {
    id: string;
    type: "claude" | "codex" | "opencode" | "pi" | "kimi" | "shell" | "editor";
    label: string;
    createdAt: string;
    instance?: string;
    trayExclude?: boolean;
    /** Backend lifetime that most recently owned the live PTY. */
    bootId?: string;
    /** Durable lifecycle state. Missing on legacy records and treated as live. */
    state?: "live" | "interrupted" | "resuming";
    /** Exact conversation identifier used by the agent CLI's resume command. */
    nativeSessionId?: string;
    /** Effective working directory and launch options required to resume safely. */
    cwd?: string;
    agentOptions?: AgentLaunchOptions;
    /** Flow ownership retained across backend restarts. */
    flow?: {
        flowId: string;
        actionEntryId: string;
    };
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
    attributes: Attribute[];
    createdAt: string;
    status: "active" | "archived";
    archivedAt: string | null;
    pinned: boolean;
    initCommand?: string;
}

export type TaskLogEntryType = "info" | "commit" | "warning" | "error" | "file";

export interface TaskLogEntry {
    id: string;
    sessionId: string;
    timestamp: string;
    type: TaskLogEntryType;
    message: string;
    meta?: Record<string, string>;
}
