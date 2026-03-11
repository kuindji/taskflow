import type { Project } from './project';
import type { Task } from './task';
import type { FileNode, FileChangeEvent } from './file';
import type { GitStatusResult, GitDiffResult, GitFileStatus } from './git';
import type { SystemInfo } from './system';

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
  name: string;
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
  title?: string;
  description: string;
  worktree?: boolean;
}

export interface TaskUpdatePayload {
  id: string;
  title?: string;
  description?: string;
  notes?: string;
}

export interface TaskArchivePayload {
  id: string;
}

export interface TaskDeletePayload {
  id: string;
}

// Session messages
export interface SessionCreatePayload {
  taskId: string;
  type: 'claude' | 'codex' | 'shell';
  label?: string;
  prompt?: string;
  shell?: string; // full path, e.g. "/bin/zsh" — required when type is 'shell'
}

export interface SessionCreateResponse {
  sessionId: string;
}

export interface SessionClosePayload {
  sessionId: string;
}

export interface SessionInputPayload {
  sessionId: string;
  data: string;
}

export interface SessionExitedEvent {
  sessionId: string;
  exitCode: number;
}

// Terminal events
export interface TerminalOutputEvent {
  sessionId: string;
  data: string;
}

export interface TerminalResizePayload {
  sessionId: string;
  cols: number;
  rows: number;
}

// Shell detection
export interface ShellInfo {
  name: string;
  path: string;
}

// File messages
export interface FileTreePayload {
  path: string;
}

export interface FileTreeResponse {
  tree: FileNode;
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

export interface FileChangedEvent extends FileChangeEvent {}

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
  diff: string;
}

export interface GitRevertFilePayload {
  repoPath: string;
  filePath: string;
  status: GitFileStatus['status'];
  previousPath?: string;
}

export interface GitWorktreeCreatePayload {
  repoPath: string;
  branch: string;
  path: string;
}

// Browser messages
export interface BrowserOpenPayload {
  taskId: string;
  url: string;
  label?: string;
}

// System messages
export interface SystemInfoResponse extends SystemInfo {}
