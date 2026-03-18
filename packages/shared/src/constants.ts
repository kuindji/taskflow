// WebSocket message types
export const MSG = {
    // Projects
    PROJECT_LIST: "project:list",
    PROJECT_ADD: "project:add",
    PROJECT_REMOVE: "project:remove",
    PROJECT_UPDATE: "project:update",
    PROJECT_FORK: "project:fork",
    PROJECT_UPDATED: "project:updated",

    // Tasks
    TASK_LIST: "task:list",
    TASK_CREATE: "task:create",
    TASK_UPDATE: "task:update",
    TASK_CREATED: "task:created",
    TASK_UPDATED: "task:updated",
    TASK_ARCHIVE: "task:archive",
    TASK_UNARCHIVE: "task:unarchive",
    TASK_LIST_ARCHIVED: "task:list-archived",
    TASK_DELETE: "task:delete",
    TASK_LOG_LIST: "task:log-list",
    TASK_LOG_ADDED: "task:log-added",

    // Sessions
    SESSION_CREATE: "session:create",
    SESSION_CLOSE: "session:close",
    SESSION_RENAME: "session:rename",
    SESSION_INPUT: "session:input",
    SESSION_STATUS: "session:status",
    SESSION_EXITED: "session:exited",
    SHELLS_LIST: "shells:list",
    SCRIPTS_LIST: "scripts:list",
    RUNTIMES_LIST: "runtimes:list",
    AGENTS_LIST: "agents:list",

    // Terminal
    TERMINAL_OUTPUT: "terminal:output",
    TERMINAL_RESIZE: "terminal:resize",
    SESSION_HISTORY: "session:history",
    SESSION_SNAPSHOT: "session:snapshot",

    // Files
    FILE_TREE: "file:tree",
    FILE_LIST_DIR: "file:list-dir",
    FILE_READ: "file:read",
    FILE_WRITE: "file:write",
    FILE_CHANGED: "file:changed",
    FILE_WATCH: "file:watch",
    FILE_UNWATCH: "file:unwatch",
    FILE_STAT: "file:stat",
    FILE_RENAME: "file:rename",
    FILE_DELETE_FILE: "file:delete",
    FILE_MKDIR: "file:mkdir",
    FILE_OPEN_EXTERNAL: "file:open-external",
    FILE_REVEAL: "file:reveal",

    // Git
    GIT_STATUS: "git:status",
    GIT_DIFF: "git:diff",
    GIT_DIFF_FILE: "git:diff-file",
    GIT_REVERT_FILE: "git:revert-file",
    GIT_STAGE: "git:stage",
    GIT_UNSTAGE: "git:unstage",
    GIT_WORKTREE_CREATE: "git:worktree-create",
    GIT_COMMIT: "git:commit",
    GIT_PUSH: "git:push",
    GIT_GENERATE_COMMIT_MSG: "git:generate-commit-msg",
    GIT_CREATE_PR: "git:create-pr",
    GIT_CHECK_PR: "git:check-pr",

    // Flow definitions
    FLOW_DEFINITIONS_LIST: "flow:definitions-list",
    FLOW_ACTIONS_LIST: "flow:actions-list",
    FLOW_DEFINITION_SAVE: "flow:definition-save",
    FLOW_ACTION_SAVE: "flow:action-save",
    FLOW_DEFINITION_DELETE: "flow:definition-delete",
    FLOW_ACTION_DELETE: "flow:action-delete",

    // Flow execution
    FLOW_START: "flow:start",
    FLOW_STOP: "flow:stop",
    FLOW_PAUSE: "flow:pause",
    FLOW_RESUME: "flow:resume",
    FLOW_SKIP_ACTION: "flow:skip-action",
    FLOW_JUMP_TO_ACTION: "flow:jump-to-action",
    FLOW_RUN_GET: "flow:run-get",
    FLOW_RUNS_LIST: "flow:runs-list",
    FLOW_RUN_UPDATED: "flow:run-updated",

    // Cursor
    CURSOR_RULES_CHECK: "cursor:rules-check",
    CURSOR_RULES_ENSURE: "cursor:rules-ensure",

    // Browser
    BROWSER_OPEN: "browser:open",

    // Settings
    SETTINGS_GET: "settings:get",
    SETTINGS_UPDATE: "settings:update",
    SETTINGS_GET_DATA_DIR: "settings:get-data-dir",
    SETTINGS_UPDATE_DATA_DIR: "settings:update-data-dir",

    // Themes
    THEMES_LIST: "theme:list",
    THEME_IMPORT_SCAN: "theme:import-scan",
    THEME_IMPORT: "theme:import",
    THEME_IMPORT_FILE: "theme:import-file",

    THEME_DELETE: "theme:delete",

    // System
    SYSTEM_INFO: "system:info",
} as const;

export const DEFAULT_THEME_ID = "catppuccin-mocha";

// Archive expiry (safe to import in browser)
export const ARCHIVE_EXPIRY_DAYS = 30;

export const DEFAULT_TERMINAL_FONT_FAMILY =
    '"CaskaydiaCove Nerd Font Mono", "SFMono-Regular", Menlo, Monaco, Consolas, "Liberation Mono", monospace';
export const DEFAULT_TERMINAL_SHELL = "system";

export const DEFAULT_EDITOR_FONT_FAMILY = '"JetBrains Mono", Menlo, Monaco, monospace';
export const DEFAULT_EDITOR_FONT_SIZE = 13;
export const DEFAULT_EDITOR_WORD_WRAP = true;

// NOTE: Config paths (CONFIG_DIR, PROJECTS_FILE, etc.) live in
// packages/backend/src/config.ts — not here, because process.env.HOME
// is unavailable in the browser renderer.
