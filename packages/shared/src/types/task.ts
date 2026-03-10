export interface SessionRef {
  id: string;
  type: 'claude' | 'codex';
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
  status: 'active' | 'archived';
  archivedAt: string | null;
}
