type AgentType = "claude" | "codex";

interface ClaudeLaunchOptions {
    type: Extract<AgentType, "claude">;
    fullAccess?: boolean;
    model?: "opus" | "sonnet" | "haiku";
}

interface CodexLaunchOptions {
    type: Extract<AgentType, "codex">;
    fullAccess?: boolean;
}

type AgentLaunchOptions = ClaudeLaunchOptions | CodexLaunchOptions;

export type { AgentType, ClaudeLaunchOptions, CodexLaunchOptions, AgentLaunchOptions };
