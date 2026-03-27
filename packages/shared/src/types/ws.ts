import type { Notification } from "./notification";
import type { LinkedProject, Project } from "./project";
import type { SessionRef, SessionStatus, Task, TaskLogEntry, TaskWorktree } from "./task";
import type { FileNode, FileChangeEvent } from "./file";
import type { GitStatusResult, GitDiffResult, GitFileStatus, ChangeStats } from "./git";
import type { SystemInfo } from "./system";
import type { AgentLaunchOptions, AgentAvailability } from "./agent";
import type { ThemeRecord, ThemeSource } from "./theme";

// Base message types
export interface WsRequest<T = unknown> {
    correlationId: string;
    type: string;
    payload: T;
}

export interface WsResponse<T = unknown> {
    correlationId: string;
    type: string;
    payload: T;
    error?: string;
}

export interface WsEvent<T = unknown> {
    type: string;
    payload: T;
}

// Project messages
export interface ProjectListResponse {
    projects: Project[];
}

export interface ProjectAddPayload {
    name?: string;
    path: string;
}

export interface ProjectRemovePayload {
    id: string;
}

export interface ProjectUpdatePayload {
    id: string;
    name?: string;
    path?: string;
    defaultInitCommand?: string;
    prompt?: string;
    linkedProjects?: LinkedProject[];
    hidden?: boolean;
}

export interface ProjectForkPayload {
    projectId: string;
    branch: string;
    folderName?: string;
}

export interface ProjectForkResponse {
    project: Project;
    targetPath: string;
    branch: string;
}

// Task messages
export interface TaskListPayload {
    projectId?: string;
}

export interface TaskListResponse {
    tasks: Task[];
}

export interface TaskCreatePayload {
    projectId: string;
    parentId?: string;
    title?: string;
    description: string;
    worktree?: boolean;
    initCommand?: string;
}

export interface TaskUpdatePayload {
    id: string;
    title?: string;
    description?: string;
    notes?: string;
    worktree?: TaskWorktree;
    pinned?: boolean;
}

export interface TaskArchivePayload {
    id: string;
}

export interface TaskUnarchivePayload {
    id: string;
}

export interface TaskDeletePayload {
    id: string;
    deleteWorktree?: boolean;
}

// Task log messages
export interface TaskLogListPayload {
    taskId: string;
}

export interface TaskLogListResponse {
    entries: TaskLogEntry[];
}

export interface TaskLogAddedEvent {
    taskId: string;
    entry: TaskLogEntry;
}

// Session messages
export interface SessionCreatePayload {
    taskId?: string;
    projectId?: string;
    master?: boolean;
    type: "claude" | "codex" | "opencode" | "gemini" | "cursor" | "shell" | "editor";
    label?: string;
    prompt?: string;
    shell?: string; // full path, e.g. "/bin/zsh" — required when type is 'shell'
    cwd?: string; // override working directory for the session
    cols?: number;
    rows?: number;
    agentOptions?: AgentLaunchOptions;
    editorId?: string;
    filePath?: string;
    line?: number;
}

export interface SessionCreateResponse {
    sessionId: string;
}

export interface SessionClosePayload {
    sessionId: string;
}

export interface SessionRenamePayload {
    sessionId: string;
    label: string;
}

export interface SessionInputPayload {
    sessionId: string;
    data: string;
}

export interface SessionStatusEvent {
    sessionId: string;
    status: SessionStatus;
}

export interface SessionExitedEvent {
    sessionId: string;
    exitCode: number;
}

// Terminal events
export interface TerminalOutputEvent {
    sessionId: string;
    data: string;
    sequence: number;
}

export interface TerminalResizePayload {
    sessionId: string;
    cols: number;
    rows: number;
}

export interface SessionHistoryPayload {
    taskId?: string;
    projectId?: string;
    master?: boolean;
    sessionId: string;
}

export interface SessionHistoryResponse {
    data: string;
    lastSequence: number;
}

export interface SessionSnapshotPayload {
    sessionId: string;
}

export interface SessionSnapshotResponse {
    snapshot: string | null;
    lastSequence: number;
    cursorHidden: boolean;
}

// Shell detection
export interface ShellInfo {
    name: string;
    path: string;
}

export interface ShellListResponse {
    shells: ShellInfo[];
    systemShellPath: string | null;
}

// Runtime detection
export interface RuntimeInfo {
    name: string;
    path: string;
    version: string;
}

export interface RuntimeListResponse {
    runtimes: RuntimeInfo[];
}

export interface AgentListResponse {
    agents: AgentAvailability[];
}

// File messages
export interface FileTreePayload {
    path: string;
}

export interface FileTreeResponse {
    tree: FileNode;
    gitignorePatterns: string[];
}

export interface FileListDirPayload {
    path: string;
}

export interface FileListDirResponse {
    entries: FileNode[];
    gitignorePatterns: string[];
}

export interface FileReadPayload {
    path: string;
}

export interface FileReadResponse {
    content: string;
}

export interface FileWatchPayload {
    path: string;
}

export interface FileUnwatchPayload {
    path: string;
}

export interface FileWritePayload {
    path: string;
    content: string;
}

export interface FileStatPayload {
    path: string;
}

export interface FileStatResponse {
    exists: boolean;
    isDirectory: boolean;
}

export interface FileRenamePayload {
    oldPath: string;
    newPath: string;
}

export interface FilePathPayload {
    path: string;
}

export interface FileMkdirPayload {
    path: string;
}

export type FileChangedEvent = FileChangeEvent;

// Git messages
export interface GitStatusPayload {
    path: string;
}

export interface GitStatusResponse {
    status: GitStatusResult;
}

export interface GitDiffPayload {
    path: string;
}

export interface GitDiffResponse {
    diff: GitDiffResult;
}

export interface GitDiffFilePayload {
    repoPath: string;
    filePath: string;
}

export interface GitDiffFileResponse {
    staged?: string;
    unstaged?: string;
}

export interface GitRevertFilePayload {
    repoPath: string;
    filePath: string;
    status: GitFileStatus["status"];
    previousPath?: string;
}

export interface GitWorktreeCreatePayload {
    repoPath: string;
    branch: string;
    path: string;
}

export interface GitStagePayload {
    repoPath: string;
    filePath?: string;
}

export interface GitUnstagePayload {
    repoPath: string;
    filePath?: string;
}

export interface GitCommitPayload {
    path: string;
    message: string;
    push: boolean;
    includeUnstaged?: boolean;
}

export interface GitCommitResult {
    hash: string;
    message: string;
}

export interface GitGenerateCommitMsgPayload {
    path: string;
    includeUnstaged?: boolean;
}

export interface GitPullPayload {
    path: string;
}

export interface GitFetchPayload {
    path: string;
}

export interface GitPushPayload {
    path: string;
}

export interface GitCreatePrPayload {
    path: string;
    title: string;
    body?: string;
    taskId?: string;
}

export interface GitCheckPrPayload {
    path: string;
    branch: string;
}

export interface ChangeStatsEvent {
    targetId: string;
    stats: ChangeStats | null;
}

export interface GitCreatePrResult {
    url: string;
    number: number;
}

// Scripts messages
export interface ScriptsListPayload {
    path: string;
}

export type PackageManager = "bun" | "yarn" | "npm";

export interface ScriptsListResponse {
    scripts: Record<string, string>;
    packageManager: PackageManager;
}

// Agent commands messages
export interface AgentCommandsListPayload {
    path: string;
}

export interface AgentCommand {
    name: string;
    source: "project" | "user";
}

export interface AgentCommandsListResponse {
    commands: AgentCommand[];
}

// Browser messages
export interface BrowserOpenPayload {
    taskId?: string;
    projectId?: string;
    master?: boolean;
    url: string;
    label?: string;
}

export interface MasterSessionsListResponse {
    sessions: SessionRef[];
}

// Theme messages
export interface ThemeListResponse {
    themes: ThemeRecord[];
}

export interface ThemeImportPayload {
    theme: ThemeSource;
}

export interface ThemeImportFilePayload {
    path: string;
}

export interface ThemeImportResponse {
    themes: ThemeRecord[];
    importedThemeId: string;
}

export interface ThemeImportScanResponse {
    apps: Array<{ app: string; themes: ThemeSource[] }>;
}

export interface ThemeDeletePayload {
    id: string;
}

// Cursor rules messages
export interface CursorRulesCheckPayload {
    cwd: string;
}

export interface CursorRulesCheckResponse {
    status: "missing" | "present";
}

export interface CursorRulesEnsurePayload {
    cwd: string;
}

// System messages
export type SystemInfoResponse = SystemInfo;

// Notification messages — request payloads
export interface NotificationMarkReadPayload {
    id: string;
}

export interface NotificationDeletePayload {
    id?: string;
    all?: boolean;
}

// Notification messages — response/event types
export interface NotificationListResponse {
    notifications: Notification[];
}

export interface NotificationCreatedEvent {
    notification: Notification;
}

export interface NotificationUpdatedEvent {
    notification: Notification;
}

export interface NotificationDeletedEvent {
    id?: string;
    all?: boolean;
}

// Remote Agent messages
export interface RemoteAgentStatusPayload {
    running: boolean;
    sessionId?: string;
}

// TypeScript resolution
export interface TsResolveTsconfigPayload {
    filePath: string;
}

export interface TsResolveTsconfigResponse {
    tsconfigPath: string | null;
    compilerOptions: Record<string, unknown>;
}

export interface TsResolveImportPayload {
    sourceFilePath: string;
    importSpecifier: string;
}

export interface TsResolveImportResponse {
    resolvedPath: string | null;
}
