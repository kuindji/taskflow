interface ClaudeLaunchOptions {
    type: "claude";
    fullAccess?: boolean;
    worktree?: boolean;
    model?: "opus" | "sonnet" | "haiku";
}

interface CodexLaunchOptions {
    type: "codex";
    fullAccess?: boolean;
}

type AgentLaunchOptions = ClaudeLaunchOptions | CodexLaunchOptions;

export type { ClaudeLaunchOptions, CodexLaunchOptions, AgentLaunchOptions };
