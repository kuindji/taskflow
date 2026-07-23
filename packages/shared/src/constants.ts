import type { MarkdownWidth } from "./types/settings";

// WebSocket message types
export const MSG = {
    // Projects
    PROJECT_LIST: "project:list",
    PROJECT_ADD: "project:add",
    PROJECT_REMOVE: "project:remove",
    PROJECT_UPDATE: "project:update",
    PROJECT_FORK: "project:fork",
    PROJECT_CREATED: "project:created",
    PROJECT_REMOVED: "project:removed",
    PROJECT_UPDATED: "project:updated",
    PROJECT_REORDER: "project:reorder",
    PROJECT_REORDERED: "project:reordered",

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

    // Attributes
    ATTR_CREATE: "attr:create",
    ATTR_UPDATE: "attr:update",
    ATTR_DELETE: "attr:delete",

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
    AGENT_COMMANDS_LIST: "agent-commands:list",
    CODEX_MODELS: "codex:models",
    OPENCODE_MODELS: "opencode:models",
    PI_MODELS: "pi:models",
    KIMI_MODELS: "kimi:models",

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

    // TypeScript resolution
    TS_RESOLVE_TSCONFIG: "ts:resolve-tsconfig",
    TS_RESOLVE_IMPORT: "ts:resolve-import",

    // Search
    SEARCH_QUERY: "search:query",
    SEARCH_CANCEL: "search:cancel",
    SEARCH_REPLACE: "search:replace",
    SEARCH_REPLACE_ALL: "search:replace-all",

    // Git
    GIT_STATUS: "git:status",
    GIT_DIFF: "git:diff",
    GIT_DIFF_FILE: "git:diff-file",
    GIT_DIFF_FILE_CONTENT: "git:diff-file-content",
    GIT_REVERT_FILE: "git:revert-file",
    GIT_STAGE: "git:stage",
    GIT_UNSTAGE: "git:unstage",
    GIT_WORKTREE_CREATE: "git:worktree-create",
    GIT_COMMIT: "git:commit",
    GIT_PULL: "git:pull",
    GIT_FETCH: "git:fetch",
    GIT_PUSH: "git:push",
    GIT_GENERATE_COMMIT_MSG: "git:generate-commit-msg",
    GIT_CREATE_PR: "git:create-pr",
    GIT_CHECK_PR: "git:check-pr",
    GIT_LOG: "git:log",
    GIT_COMMIT_FILES: "git:commit-files",
    GIT_COMMIT_DIFF_FILE: "git:commit-diff-file",
    GIT_CHANGE_STATS: "git:change-stats",

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

    // Schedules
    SCHEDULE_LIST: "schedule:list",
    SCHEDULE_CREATE: "schedule:create",
    SCHEDULE_UPDATE: "schedule:update",
    SCHEDULE_DELETE: "schedule:delete",
    SCHEDULE_TRIGGER: "schedule:trigger",
    SCHEDULE_UPDATED: "schedule:updated",

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

    // Notifications
    NOTIFICATION_LIST: "notification:list",
    NOTIFICATION_CREATED: "notification:created",
    NOTIFICATION_UPDATED: "notification:updated",
    NOTIFICATION_DELETED: "notification:deleted",

    // Master workspace
    MASTER_SESSIONS_LIST: "master:sessions-list",

    // Remote Agent
    REMOTE_AGENT_START: "remote-agent:start",
    REMOTE_AGENT_STOP: "remote-agent:stop",
    REMOTE_AGENT_STATUS: "remote-agent:status",
    REMOTE_AGENT_STATUS_CHANGED: "remote-agent:status-changed",

    // Connectivity
    CONNECTIVITY_STATUS: "connectivity:status",
    CONNECTIVITY_RECHECK: "connectivity:recheck",
    CONNECTIVITY_STATUS_CHANGED: "connectivity:status-changed",

    // System
    SYSTEM_INFO: "system:info",
} as const;

export const DEFAULT_THEME_ID = "catppuccin-mocha";

// Archive expiry (safe to import in browser)
export const ARCHIVE_EXPIRY_DAYS = 30;

export const DEFAULT_GENERAL_FONT_FAMILY = '"CaskaydiaCove Nerd Font Mono", monospace';
export const DEFAULT_GENERAL_FONT_SIZE = 13;

export const DEFAULT_TERMINAL_FONT_FAMILY =
    '"CaskaydiaCove Nerd Font Mono", "SFMono-Regular", Menlo, Monaco, Consolas, "Liberation Mono", monospace';
export const DEFAULT_TERMINAL_FONT_SIZE = 18;
export const DEFAULT_TERMINAL_SHELL = "system";

export const DEFAULT_EDITOR_FONT_FAMILY =
    '"JetBrainsMono Nerd Font", "JetBrains Mono", Menlo, Monaco, monospace';
export const DEFAULT_EDITOR_FONT_SIZE = 18;
export const DEFAULT_EDITOR_WORD_WRAP = true;

export const DEFAULT_EDITOR_MARKDOWN_WIDTH: MarkdownWidth = "medium";

export const ALL_MARKDOWN_WIDTHS: readonly MarkdownWidth[] = ["narrow", "medium", "wide", "full"];

export const MARKDOWN_WIDTH_LABELS: Record<MarkdownWidth, string> = {
    narrow: "Narrow",
    medium: "Medium",
    wide: "Wide",
    full: "Full width",
};

/**
 * Reading measure for markdown prose. 74ch is the default: at 88ch the long
 * bullets in real wiki content start orphaning two or three words onto a
 * second line, which is the specific failure this caps.
 */
export function markdownWidthCss(width: MarkdownWidth): string {
    switch (width) {
        case "narrow":
            return "62ch";
        case "medium":
            return "74ch";
        case "wide":
            return "88ch";
        case "full":
            return "none";
    }
}

/** Shared scrollback line count — must match between frontend xterm and backend headless xterm. */
export const TERMINAL_SCROLLBACK = 50_000;

// NOTE: Config paths (CONFIG_DIR, PROJECTS_FILE, etc.) live in
// packages/backend/src/config.ts — not here, because process.env.HOME
// is unavailable in the browser renderer.
