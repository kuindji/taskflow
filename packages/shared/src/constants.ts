// WebSocket message types
export const MSG = {
  // Projects
  PROJECT_LIST: 'project:list',
  PROJECT_ADD: 'project:add',
  PROJECT_REMOVE: 'project:remove',
  PROJECT_UPDATE: 'project:update',

  // Tasks
  TASK_LIST: 'task:list',
  TASK_CREATE: 'task:create',
  TASK_UPDATE: 'task:update',
  TASK_UPDATED: 'task:updated',
  TASK_ARCHIVE: 'task:archive',
  TASK_DELETE: 'task:delete',

  // Sessions
  SESSION_CREATE: 'session:create',
  SESSION_CLOSE: 'session:close',
  SESSION_INPUT: 'session:input',
  SESSION_EXITED: 'session:exited',
  SHELLS_LIST: 'shells:list',

  // Terminal
  TERMINAL_OUTPUT: 'terminal:output',
  TERMINAL_RESIZE: 'terminal:resize',

  // Files
  FILE_TREE: 'file:tree',
  FILE_READ: 'file:read',
  FILE_WRITE: 'file:write',
  FILE_CHANGED: 'file:changed',
  FILE_WATCH: 'file:watch',
  FILE_UNWATCH: 'file:unwatch',

  // Git
  GIT_STATUS: 'git:status',
  GIT_DIFF: 'git:diff',
  GIT_DIFF_FILE: 'git:diff-file',
  GIT_REVERT_FILE: 'git:revert-file',
  GIT_WORKTREE_CREATE: 'git:worktree-create',

  // Browser
  BROWSER_OPEN: 'browser:open',

  // System
  SYSTEM_INFO: 'system:info',
} as const;

// Archive expiry (safe to import in browser)
export const ARCHIVE_EXPIRY_DAYS = 30;

// NOTE: Config paths (CONFIG_DIR, PROJECTS_FILE, etc.) live in
// packages/backend/src/config.ts — not here, because process.env.HOME
// is unavailable in the browser renderer.
