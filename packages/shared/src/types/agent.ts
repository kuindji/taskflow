type AgentType = "claude" | "codex" | "opencode";

interface ClaudeLaunchOptions {
    type: Extract<AgentType, "claude">;
    fullAccess?: boolean;
    model?: "opus" | "sonnet" | "haiku";
}

interface CodexLaunchOptions {
    type: Extract<AgentType, "codex">;
    fullAccess?: boolean;
}

interface OpenCodeLaunchOptions {
    type: Extract<AgentType, "opencode">;
    fullAccess?: boolean;
    model?: string;
}

type AgentLaunchOptions = ClaudeLaunchOptions | CodexLaunchOptions | OpenCodeLaunchOptions;

interface AgentAvailability {
    type: AgentType;
    available: boolean;
    path: string;
    version: string;
}

export type {
    AgentType,
    ClaudeLaunchOptions,
    CodexLaunchOptions,
    OpenCodeLaunchOptions,
    AgentLaunchOptions,
    AgentAvailability,
};
