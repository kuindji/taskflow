type AgentType = "claude" | "codex" | "gemini" | "cursor";

interface ClaudeLaunchOptions {
    type: Extract<AgentType, "claude">;
    fullAccess?: boolean;
    model?: "opus" | "sonnet" | "haiku";
}

interface CodexLaunchOptions {
    type: Extract<AgentType, "codex">;
    fullAccess?: boolean;
}

interface GeminiLaunchOptions {
    type: Extract<AgentType, "gemini">;
    fullAccess?: boolean;
    model?: "auto" | "pro" | "flash" | "flash-lite";
}

interface CursorLaunchOptions {
    type: Extract<AgentType, "cursor">;
    fullAccess?: boolean;
    model?: string;
}

type AgentLaunchOptions = ClaudeLaunchOptions | CodexLaunchOptions | GeminiLaunchOptions | CursorLaunchOptions;

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
    GeminiLaunchOptions,
    CursorLaunchOptions,
    AgentLaunchOptions,
    AgentAvailability,
};
